import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  RuntimeEventKey,
} from "../contracts"
import type { ServerEvent } from "@/context/server-sdk"

export type HostSessionBindingState<B> =
  | { status: "unbound" }
  | { status: "bound"; binding: B }

interface HostSessionBindingRegistrationOptions<B, ResetCommand> {
  functionalityID: string
  get: (services: BlockRuntimeServices, signal: AbortSignal) => Promise<HostSessionBindingState<B>>
  ensure: (services: BlockRuntimeServices, signal: AbortSignal) => Promise<B>
  reset: (binding: B, services: BlockRuntimeServices, signal: AbortSignal) => Promise<void>
  normalizeError: (error: unknown) => unknown
  eventTypes: readonly string[]
  validateBinding: (input: unknown) => B | undefined
}

interface EventContext {
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  revision?: number
}

const CHANGED_EVENT = "workspace.functionality.instance.changed" as const

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function isAbortError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  return error.name === "AbortError"
}

function combineSignals(
  left?: AbortSignal,
  right?: AbortSignal,
): AbortSignal {
  if (!left) return right ?? new AbortController().signal
  if (!right) return left

  const controller = new AbortController()
  const onAbort = () => {
    const signal = left.aborted ? left : right
    controller.abort(signal?.reason)
  }
  left.addEventListener("abort", onAbort, { once: true })
  right.addEventListener("abort", onAbort, { once: true })

  if (left.aborted) controller.abort(left.reason)
  if (right.aborted) controller.abort(right.reason)

  return controller.signal
}

function parseEventContext(event: ServerEvent): EventContext | undefined {
  const top = normalizeRecord(event)
  if (!top) return undefined
  const type = asString(top.type) ?? asString(top.name) ?? asString(top.event)
  if (!type) return undefined

  const details = normalizeRecord(top.current)
  const properties = normalizeRecord(top.properties)
  const source = properties ?? details ?? top
  if (!source) return undefined

  return {
    workspaceID: asString(source.workspaceID),
    blockID: asString(source.blockID) ?? asString(source.blockId),
    functionalityID: asString(source.functionalityID),
    revision: asNumber(source.revision),
  }
}

function revisionOf<B>(binding: B): number | undefined {
  return asNumber((binding as { revision?: unknown }).revision)
}

function isStaleBindingError(error: unknown): boolean {
  const details = normalizeRecord(error)
  return details?.type === "stale-binding"
}

export function createHostSessionBindingRegistration<B, ResetCommand>({
  functionalityID,
  get,
  ensure,
  reset,
  normalizeError,
  eventTypes,
  validateBinding,
}: HostSessionBindingRegistrationOptions<B, ResetCommand>): BlockRuntimeRegistration<
  HostSessionBindingState<B>,
  B | undefined,
  ResetCommand
> {
  const eventTypeList = [CHANGED_EVENT, ...eventTypes]

  let trackedBlockID: string | undefined
  let trackedWorkspaceEpoch: number | undefined
  let trackedWorkspaceID: string | undefined
  let inflightResolve: Promise<HostSessionBindingState<B>> | undefined
  let inflightResolveController: AbortController | undefined
  let inflightDispatch: Promise<void> | undefined
  let inflightDispatchController: AbortController | undefined
  let invalidateQueued = false
  let invalidateRevision = -1

  function resetInvalidationState() {
    invalidateQueued = false
    invalidateRevision = -1
  }

  async function loadBinding(
    services: BlockRuntimeServices,
    signal: AbortSignal,
    blockID: string,
  ): Promise<HostSessionBindingState<B>> {
    const workspaceID = services.workspace.id()
    if (!workspaceID) throw new Error("missing workspace")

    const getResult = await get(services, signal)
    if (signal.aborted) {
      throw makeAbortError()
    }

    if (getResult.status === "bound") {
      const binding = validateBinding(getResult.binding)
      if (!binding) throw new Error("Invalid binding payload")
      return { status: "bound", binding }
    }

    await services.workspace.awaitDescriptorPersisted(blockID, signal)

    const ensured = await ensure(services, signal)
    const binding = validateBinding(ensured)
    if (!binding) throw new Error("Invalid ensured binding")
    return { status: "bound", binding }
  }

  function readWorkspaceEpoch(services: BlockRuntimeServices): number {
    return services.workspace.epoch()
  }

  async function getFreshBound(
    resolved: HostSessionBindingState<B>,
    services: BlockRuntimeServices,
    signal: AbortSignal,
    blockID: string,
  ) {
    const candidate = await loadBinding(services, signal, blockID)
    return validateBinding(candidate.status === "bound" ? candidate.binding : undefined)
      ? candidate
      : resolved
  }

  return {
    functionalityID,
    mode: "native",
    async resolve(input) {
      const { block, services, signal } = input
      const workspaceID = services.workspace.id()

      if (!inflightResolve || !trackedBlockID || trackedBlockID !== block.id) {
        trackedBlockID = block.id
      }

      if (workspaceID) trackedWorkspaceID = workspaceID

      const currentEpoch = readWorkspaceEpoch(services)
      if (trackedWorkspaceEpoch !== currentEpoch) {
        resetInvalidationState()
        trackedWorkspaceEpoch = currentEpoch
      }

      if (inflightResolve) {
        return inflightResolve
      }

      const controller = new AbortController()
      const requestSignal = combineSignals(signal, controller.signal)
      inflightResolveController = controller

      const resolvePromise = loadBinding(services, requestSignal, block.id)
        .then((resolved) => {
          if (requestSignal.aborted) {
            throw makeAbortError()
          }
          if (!trackedBlockID) {
            trackedBlockID = block.id
          }
          return resolved
        })
        .catch((error) => {
          if (requestSignal.aborted) {
            throw makeAbortError()
          }
          if (isAbortError(error)) return Promise.reject(error)
          throw normalizeError(error)
        })
        .finally(() => {
          if (inflightResolveController === controller) {
            inflightResolve = undefined
            inflightResolveController = undefined
            resetInvalidationState()
          }
        })

      inflightResolve = resolvePromise
      return resolvePromise
    },

    eventKeys() {
      const keys: RuntimeEventKey[] = [{ type: CHANGED_EVENT, functionalityID }]
      for (const type of eventTypeList) {
        keys.push({ type })
      }
      if (!trackedBlockID) return keys

      for (const key of [...keys]) {
        key.blockID = trackedBlockID
        key.workspaceID = trackedWorkspaceID
      }
      return keys
    },

    onEvent(input) {
      const parsed = parseEventContext(input.event)
      if (!parsed) return "ignore"

      const type = asString(
        normalizeRecord(input.event)?.type ?? normalizeRecord(input.event)?.name ?? normalizeRecord(input.event)?.event,
      )
      if (!type) return "ignore"

      if (eventTypeList.every((entry) => entry !== type)) return "ignore"

      const workspaceID = input.services.workspace.id()
      if (workspaceID && parsed.workspaceID && parsed.workspaceID !== workspaceID) return "ignore"
      if (parsed.workspaceID && !workspaceID) return "ignore"
      if (trackedBlockID && parsed.blockID && parsed.blockID !== trackedBlockID) return "ignore"
      if (type === CHANGED_EVENT && parsed.functionalityID && parsed.functionalityID !== functionalityID) return "ignore"

      const parsedRevision = parsed.revision
      const currentRevision = input.resolved.status === "bound" ? revisionOf(input.resolved.binding) : undefined

      if (parsedRevision !== undefined && currentRevision !== undefined && parsedRevision <= currentRevision) {
        return "ignore"
      }

      if (parsedRevision !== undefined && parsedRevision <= invalidateRevision) {
        return "ignore"
      }

      if (invalidateQueued) return "ignore"

      invalidateQueued = true
      invalidateRevision =
        parsedRevision !== undefined && parsedRevision >= 0 ? parsedRevision : invalidateRevision
      return "invalidate"

    },

    select(input): B | undefined {
      return input.resolved.status === "bound" ? validateBinding(input.resolved.binding) : undefined
    },

    async dispatch(input) {
      const binding =
        input.resolved.status === "bound" && validateBinding(input.resolved.binding)
          ? input.resolved.binding
          : undefined

      if (!binding) {
        throw normalizeError({ type: "binding-unavailable" })
      }

      if (inflightDispatch) {
        return inflightDispatch
      }

      const controller = new AbortController()
      const requestSignal = combineSignals(input.signal, controller.signal)
      inflightDispatchController = controller

      const blockID = trackedBlockID
      if (!blockID) {
        throw normalizeError({ type: "binding-unavailable" })
      }

      const dispatchPromise = reset(binding, input.services, requestSignal)
        .then(() => {
          resetInvalidationState()
        })
        .catch((error) => {
          const normalized = normalizeError(error)

          if (!isStaleBindingError(normalized)) {
            throw normalized
          }

          return getFreshBound(input.resolved, input.services, requestSignal, blockID).then(() => {
            throw normalized
          })
        })
        .catch((error) => {
          if (isAbortError(error)) throw error
          throw error
        })
        .finally(() => {
          if (inflightDispatchController === controller) {
            inflightDispatch = undefined
            inflightDispatchController = undefined
          }
          resetInvalidationState()
        })

      inflightDispatch = dispatchPromise
      return dispatchPromise
    },

    dispose() {
      trackedWorkspaceID = undefined
      invalidateQueued = false
      invalidateRevision = -1
      if (inflightResolveController) {
        inflightResolveController.abort(makeAbortError())
      }
      if (inflightDispatchController) {
        inflightDispatchController.abort(makeAbortError())
      }
      inflightResolve = undefined
      inflightDispatch = undefined
      inflightResolveController = undefined
      inflightDispatchController = undefined
    },
  }
}
