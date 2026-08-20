import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  RuntimeBlockHandle,
  RuntimeStatus,
} from "./contracts"
import { useBlockRuntimeServices } from "./provider"

export const BlockRuntimeHandleContext = createSimpleContext({
  name: "BlockRuntimeHandle",
  init: (props: { value: RuntimeBlockHandle }) => props.value,
})

export function useBlockRuntimeHandle(): RuntimeBlockHandle | undefined {
  return BlockRuntimeHandleContext.use()
}

export function BlockRuntimeHost(props: {
  blockID: string
  functionalityID: string
  registration?: BlockRuntimeRegistration<unknown, unknown, unknown>
  services?: BlockRuntimeServices
  workspaceID?: string
  workspaceEpoch?: number
  children: JSX.Element
}) {
  // v1: without a registration the host is a pass-through wrapper. With one it
  // resolves the registration, subscribes its event keys on the shared router,
  // and refreshes on invalidation/reconnect/workspace-epoch changes.
  const contextServices = useBlockRuntimeServices()
  const services = () => props.services ?? contextServices
  const [status, setStatus] = createSignal<RuntimeStatus>(props.registration ? "resolving" : "ready")
  const [view, setView] = createSignal<unknown>(undefined)
  const [error, setError] = createSignal<unknown>(undefined)

  let resolved: unknown
  let refreshQueued = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  const selectView = (registration: BlockRuntimeRegistration<unknown, unknown, unknown>, next: unknown) =>
    registration.select({ resolved: next, projection: undefined, localView: undefined })

  // Coalesced invalidation (C5): a burst of matching events produces one
  // refresh in a following macrotask, never one per event.
  const queueRefresh = (reason: string) => {
    if (refreshQueued) return
    refreshQueued = true
    refreshTimer = setTimeout(() => {
      refreshQueued = false
      refreshTimer = undefined
      void handle.refresh(reason)
    }, 0)
  }

  const handle: RuntimeBlockHandle = {
    status: () => status(),
    view: () => view(),
    error: () => error(),
    async refresh() {
      const registration = props.registration
      if (!registration || resolved === undefined) return
      setStatus("stale")
      setView(selectView(registration, resolved))
      setStatus("ready")
    },
    async dispatch(command: unknown) {
      const registration = props.registration
      const svc = services()
      if (!registration || !svc || resolved === undefined) return
      await registration.dispatch?.({ resolved, command, services: svc, signal: dispatchAbort.signal })
    },
    dispose() {
      resolveAbort.abort()
      dispatchAbort.abort()
    },
  }

  const resolveAbort = new AbortController()
  const dispatchAbort = new AbortController()

  // C8/C9: the runtime identity includes workspaceEpoch + workspaceID +
  // blockID + functionalityID. Any change re-resolves (disposing the previous
  // adapter state) — this is how workspace recovery rebinds host-backed blocks.
  createEffect(() => {
    const registration = props.registration
    const svc = services()
    if (!registration || !svc) return
    void props.workspaceEpoch
    void props.workspaceID
    void props.blockID
    void props.functionalityID

    const controller = new AbortController()
    const unsubs: Array<() => void> = []
    setStatus("resolving")
    setError(undefined)

    void (async () => {
      try {
        const next = await registration.resolve({
          workspaceID: props.workspaceID ?? "",
          block: {
            id: props.blockID,
            functionalityID: props.functionalityID,
            transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
          },
          services: svc,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        resolved = next
        setView(selectView(registration, next))
        setStatus("ready")

        for (const key of registration.eventKeys?.(next) ?? []) {
          unsubs.push(
            svc.eventRouter.on(key, (event) => {
              const result = registration.onEvent?.({ event, resolved: next, services: svc })
              if (result === "invalidate") queueRefresh(`event:${event.type}`)
              else if (result && typeof result === "object") queueRefresh(`patch:${event.type}`)
            }),
          )
        }
        unsubs.push(svc.eventRouter.onReconnect(() => queueRefresh("reconnect")))
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause)
        setStatus("error")
      }
    })()

    onCleanup(() => {
      controller.abort()
      for (const unsub of unsubs) unsub()
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer)
        refreshTimer = undefined
        refreshQueued = false
      }
      if (resolved !== undefined) {
        registration.dispose?.(resolved)
        resolved = undefined
      }
    })
  })

  onCleanup(() => handle.dispose())

  return (
    <BlockRuntimeHandleContext.provider value={handle}>
      {props.children}
    </BlockRuntimeHandleContext.provider>
  )
}
