import { createContext, createEffect, createSignal, onCleanup, untrack, useContext, type JSX } from "solid-js"
import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
  RuntimeBlockHandle,
  RuntimeStatus,
} from "./contracts"
import { useBlockRuntimeServices } from "./provider"

export const BlockRuntimeHandleContext = createContext<RuntimeBlockHandle>()

export function useBlockRuntimeHandle(): RuntimeBlockHandle | undefined {
  return useContext(BlockRuntimeHandleContext)
}

function errorStatus(error: unknown): RuntimeStatus {
  if (typeof error !== "object" || error === null) return "error"
  const type = "type" in error ? String(error.type) : undefined
  if (type === "access-denied") return "permission-denied"
  if (type === "wrong-functionality" || type?.endsWith("-not-found")) return "unavailable"
  const cause = "cause" in error && typeof error.cause === "object" && error.cause !== null ? error.cause : undefined
  const body = cause && "body" in cause && typeof cause.body === "object" && cause.body !== null ? cause.body : undefined
  const tagged = body ?? error
  if (!("_tag" in tagged)) return "error"
  const tag = String(tagged._tag)
  if (tag.includes("AccessDenied") || tag.includes("Unauthorized")) return "permission-denied"
  if (tag.includes("NotFound") || tag.includes("WrongFunctionality")) return "unavailable"
  return "error"
}

export function BlockRuntimeHost(props: {
  blockID: string
  functionalityID: string
  transform?: CanvasBlockDescriptor["transform"]
  registration?: BlockRuntimeRegistration<unknown, unknown, unknown>
  services?: BlockRuntimeServices
  workspaceID?: string
  workspaceEpoch?: number
  onHandle?: (handle: RuntimeBlockHandle) => void
  children: JSX.Element
}) {
  const contextServices = useBlockRuntimeServices()
  const services = () => props.services ?? contextServices
  const [status, setStatus] = createSignal<RuntimeStatus>(props.registration ? "resolving" : "ready")
  const [view, setView] = createSignal<unknown>()
  const [error, setError] = createSignal<unknown>()

  let identity:
    | {
        epoch: number
        workspaceID: string
        blockID: string
        functionalityID: string
        registration: BlockRuntimeRegistration<unknown, unknown, unknown> | undefined
        services: BlockRuntimeServices | undefined
      }
    | undefined
  let resolved: unknown
  let activeRegistration: BlockRuntimeRegistration<unknown, unknown, unknown> | undefined
  let resolveController: AbortController | undefined
  let dispatchController = new AbortController()
  let refreshQueued = false
  let refreshRequested = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let refreshInFlight: Promise<void> | undefined
  let disposed = false
  let eventUnsubs: Array<() => void> = []
  let reconnectUnsub: (() => void) | undefined

  const descriptor = (): CanvasBlockDescriptor => ({
    id: props.blockID,
    functionalityID: props.functionalityID,
    transform: props.transform ?? { x: 0, y: 0, w: 0, h: 0, z: 0 },
  })

  const clearEventSubscriptions = () => {
    eventUnsubs.forEach((unsubscribe) => unsubscribe())
    eventUnsubs = []
  }

  const clearSubscriptions = () => {
    clearEventSubscriptions()
    reconnectUnsub?.()
    reconnectUnsub = undefined
  }

  const disposeResolved = () => {
    clearSubscriptions()
    if (resolved !== undefined) activeRegistration?.dispose?.(resolved)
    resolved = undefined
    activeRegistration = undefined
  }

  const queueRefresh = (reason: string) => {
    if (reason === "reconnect" && refreshInFlight) return
    if (refreshQueued || disposed) return
    refreshQueued = true
    refreshTimer = setTimeout(() => {
      refreshQueued = false
      refreshTimer = undefined
      void handle.refresh(reason)
    }, 0)
  }

  const resolve = async () => {
    const registration = props.registration
    const svc = services()
    if (!registration) {
      setStatus("ready")
      return
    }
    if (!svc) {
      setStatus("unavailable")
      return
    }
    reconnectUnsub ??= svc.eventRouter.onReconnect(() => queueRefresh("reconnect"))

    resolveController?.abort()
    const controller = new AbortController()
    resolveController = controller
    setStatus(resolved === undefined ? "resolving" : "stale")
    setError(undefined)

    try {
      const run = () =>
        registration.resolve({
          workspaceID: svc.workspace.id() ?? props.workspaceID ?? "",
          block: descriptor(),
          services: svc,
          signal: controller.signal,
        })
      const next = await run().catch(async (cause) => {
        if (controller.signal.aborted || disposed) throw cause
        if (!(await svc.workspace.recover?.(cause))) throw cause
        if (controller.signal.aborted || disposed) throw cause
        // One replacement and one retry per resolve cycle; a second failure is surfaced.
        return run()
      })
      if (controller.signal.aborted || disposed) {
        registration.dispose?.(next)
        return
      }

      const previous = resolved
      clearEventSubscriptions()
      resolved = next
      activeRegistration = registration
      setView(registration.select({ resolved: next, projection: undefined, localView: undefined }))
      setStatus("ready")

      for (const key of registration.eventKeys?.(next) ?? []) {
        eventUnsubs.push(
          svc.eventRouter.on(key, (event) => {
            const result = registration.onEvent?.({ event, resolved: next, services: svc })
            if (result === "invalidate") queueRefresh(`event:${event.type}`)
          }),
        )
      }
      if (previous !== undefined && previous !== next) registration.dispose?.(previous)
    } catch (cause) {
      if (controller.signal.aborted || disposed) return
      setError(cause)
      setStatus(errorStatus(cause))
    }
  }

  const handle: RuntimeBlockHandle = {
    status,
    view,
    error,
    refresh() {
      refreshRequested = true
      if (refreshInFlight) return refreshInFlight
      const pending = (async () => {
        while (refreshRequested && !disposed) {
          refreshRequested = false
          await resolve()
        }
      })().finally(() => {
        if (refreshInFlight === pending) refreshInFlight = undefined
      })
      refreshInFlight = pending
      return pending
    },
    async dispatch(command: unknown) {
      const registration = props.registration
      const svc = services()
      if (!registration || !svc || resolved === undefined || !registration.dispatch) {
        throw new Error(`Block runtime ${props.functionalityID} is unavailable`)
      }
      await registration.dispatch({ resolved, command, services: svc, signal: dispatchController.signal })
      await handle.refresh("dispatch")
    },
    dispose() {
      if (disposed) return
      disposed = true
      refreshRequested = false
      resolveController?.abort()
      dispatchController.abort()
      clearTimeout(refreshTimer)
      disposeResolved()
    },
  }
  props.onHandle?.(handle)

  createEffect(() => {
    const nextIdentity = {
      epoch: props.workspaceEpoch ?? 0,
      workspaceID: props.workspaceID ?? "",
      blockID: props.blockID,
      functionalityID: props.functionalityID,
      registration: props.registration,
      services: services(),
    }
    if (
      identity?.epoch === nextIdentity.epoch &&
      identity.workspaceID === nextIdentity.workspaceID &&
      identity.blockID === nextIdentity.blockID &&
      identity.functionalityID === nextIdentity.functionalityID &&
      identity.registration === nextIdentity.registration &&
      identity.services === nextIdentity.services
    ) {
      return
    }
    identity = nextIdentity
    resolveController?.abort()
    dispatchController.abort()
    dispatchController = new AbortController()
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    refreshQueued = false
    disposeResolved()
    setView(undefined)
    untrack(() => void handle.refresh("identity"))
  })

  onCleanup(() => handle.dispose())

  return <BlockRuntimeHandleContext.Provider value={handle}>{props.children}</BlockRuntimeHandleContext.Provider>
}
