import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup, type JSX } from "solid-js"
import type { BlockRuntimeRegistration, BlockRuntimeServices, RuntimeBlockHandle, RuntimeStatus } from "./contracts"
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
  // v1: without a registration the host is a pass-through wrapper. Wave 2
  // adapters (H/I/...) supply real registrations and services. Services
  // default to the provider context when the host renders inside
  // BlockRuntimeProvider (the workspace path); tests may pass them explicitly.
  const active = !!props.registration
  const contextServices = useBlockRuntimeServices()
  const services = props.services ?? contextServices
  const [status, setStatus] = createSignal<RuntimeStatus>(active ? "resolving" : "ready")
  const [view, setView] = createSignal<unknown>(undefined)
  const [error, setError] = createSignal<unknown>(undefined)

  let resolved: unknown
  const controller = new AbortController()

  if (active && props.registration && services) {
    const registration = props.registration
    void (async () => {
      try {
        resolved = await registration.resolve({
          workspaceID: props.workspaceID ?? "",
          block: {
            id: props.blockID,
            functionalityID: props.functionalityID,
            transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
          },
          services,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setView(registration.select({ resolved, projection: undefined, localView: undefined }))
        setStatus("ready")
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause)
        setStatus("error")
      }
    })()
  }

  const handle: RuntimeBlockHandle = {
    status: () => status(),
    view: () => view(),
    error: () => error(),
    async refresh() {
      if (!active || !props.registration || !resolved) return
      setStatus("stale")
      setView(props.registration.select({ resolved, projection: undefined, localView: undefined }))
      setStatus("ready")
    },
    async dispatch(command: unknown) {
      if (!active || !props.registration || !services || !resolved) return
      await props.registration.dispatch?.({ resolved, command, services, signal: controller.signal })
    },
    dispose() {
      controller.abort()
      props.registration?.dispose?.(resolved)
    },
  }

  onCleanup(() => handle.dispose())

  // C8: the runtime identity includes workspaceEpoch + workspaceID + blockID +
  // functionalityID — the key is what Wave-2 shared resource buckets use.
  const identityKey = [props.workspaceEpoch ?? 0, props.workspaceID ?? "", props.blockID, props.functionalityID].join("::")
  void identityKey

  return (
    <BlockRuntimeHandleContext.provider value={handle}>
      {props.children}
    </BlockRuntimeHandleContext.provider>
  )
}
