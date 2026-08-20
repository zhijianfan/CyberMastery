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

  const inflightResolves = new WeakMap<BlockRuntimeServices, Map<string, Promise<HostSessionBindingState<B>>>>()
  const resolvedContexts = new WeakMap<HostSessionBindingState<B>, {
    blockID: string
    workspaceID: string | undefined
    invalidateRevision: number
    inflightDispatch?: Promise<void>
    inflightDispatchController?: AbortController
  }>()

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

  function materialize(
    pending: Promise<HostSessionBindingState<B>>,
    blockID: string,
    workspaceID: string | undefined,
  ) {
    return pending.then((resolved): HostSessionBindingState<B> => {
      const next: HostSessionBindingState<B> =
        resolved.status === "bound"
          ? { status: "bound", binding: resolved.binding }
          : { status: "unbound" }
      resolvedContexts.set(next, { blockID, workspaceID, invalidateRevision: -1 })
      return next
    })
  }

  return {
    functionalityID,
    mode: "native",
    async resolve(input) {
      const { block, services, signal } = input
      const workspaceID = services.workspace.id()
      const existing = inflightResolves.get(services)
      const byIdentity = existing ?? new Map<string, Promise<HostSessionBindingState<B>>>()
      if (!existing) inflightResolves.set(services, byIdentity)
      const identity = `${services.workspace.epoch()}\u0000${input.workspaceID}\u0000${block.id}\u0000${functionalityID}`
      const active = byIdentity.get(identity)
      if (active) return materialize(active, block.id, workspaceID)

      const resolvePromise = loadBinding(services, signal, block.id)
        .then((resolved) => {
          if (signal.aborted) throw makeAbortError()
          return resolved
        })
        .catch((error) => {
          if (signal.aborted) throw makeAbortError()
          if (isAbortError(error)) return Promise.reject(error)
          throw normalizeError(error)
        })
        .finally(() => {
          if (byIdentity.get(identity) === resolvePromise) byIdentity.delete(identity)
        })

      byIdentity.set(identity, resolvePromise)
      return materialize(resolvePromise, block.id, workspaceID)
    },

    eventKeys(resolved) {
      const keys: RuntimeEventKey[] = [{ type: CHANGED_EVENT, functionalityID }]
      for (const type of eventTypeList) {
        keys.push({ type })
      }
      const context = resolvedContexts.get(resolved)
      if (!context) return keys

      for (const key of [...keys]) {
        key.blockID = context.blockID
        key.workspaceID = context.workspaceID
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
      const existing = resolvedContexts.get(input.resolved)
      if (workspaceID && parsed.workspaceID && parsed.workspaceID !== workspaceID) return "ignore"
      if (parsed.workspaceID && !workspaceID) return "ignore"
      if (existing?.blockID && parsed.blockID && parsed.blockID !== existing.blockID) return "ignore"
      if (type === CHANGED_EVENT && parsed.functionalityID && parsed.functionalityID !== functionalityID) return "ignore"
      const context = existing ?? {
        blockID: parsed.blockID ?? "",
        workspaceID,
        invalidateRevision: -1,
      }
      if (!existing) resolvedContexts.set(input.resolved, context)

      const parsedRevision = parsed.revision
      const currentRevision = input.resolved.status === "bound" ? revisionOf(input.resolved.binding) : undefined

      if (parsedRevision !== undefined && currentRevision !== undefined && parsedRevision <= currentRevision) {
        return "ignore"
      }

      if (parsedRevision !== undefined && parsedRevision <= context.invalidateRevision) {
        return "ignore"
      }

      if (parsedRevision !== undefined && parsedRevision >= 0) context.invalidateRevision = parsedRevision
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

      const context = resolvedContexts.get(input.resolved)
      if (!context) throw normalizeError({ type: "binding-unavailable" })
      if (context.inflightDispatch) return context.inflightDispatch

      const controller = new AbortController()
      const requestSignal = combineSignals(input.signal, controller.signal)
      context.inflightDispatchController = controller

      const dispatchPromise = reset(binding, input.services, requestSignal)
        .then(() => {
          context.invalidateRevision = -1
        })
        .catch((error) => {
          const normalized = normalizeError(error)

          if (!isStaleBindingError(normalized)) {
            throw normalized
          }

          return getFreshBound(input.resolved, input.services, requestSignal, context.blockID).then(() => {
            throw normalized
          })
        })
        .catch((error) => {
          if (isAbortError(error)) throw error
          throw error
        })
        .finally(() => {
          if (context.inflightDispatchController === controller) {
            context.inflightDispatch = undefined
            context.inflightDispatchController = undefined
          }
          context.invalidateRevision = -1
        })

      context.inflightDispatch = dispatchPromise
      return dispatchPromise
    },

    dispose(resolved) {
      const context = resolvedContexts.get(resolved)
      context?.inflightDispatchController?.abort(makeAbortError())
      resolvedContexts.delete(resolved)
    },
  }
}
