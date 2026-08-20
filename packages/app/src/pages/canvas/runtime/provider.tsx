import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup, type JSX } from "solid-js"
import type { BlockRuntimeServices, BlockLocalViewStore } from "./contracts"
import { createBlockRuntimeEventRouter } from "./event-router"
import { createBlockRuntimeRegistry } from "./registry"

const BlockRuntimeServicesContext = createSimpleContext({
  name: "BlockRuntimeServices",
  init: (props: { value: BlockRuntimeServices }) => props.value,
})

export function useBlockRuntimeServices(): BlockRuntimeServices | undefined {
  return BlockRuntimeServicesContext.use()
}

export function BlockRuntimeProvider(props: {
  workspaceID: () => string | undefined
  workspaceEpoch: () => number
  connected: () => boolean
  awaitDescriptorPersisted: (blockID: string, signal: AbortSignal) => Promise<void>
  localView: BlockLocalViewStore
  children: JSX.Element
}) {
  // v1 seam: the router subscribes the app event stream via a listen function
  // injected by M at integration (serverSDK().event.listen). Until then it is
  // a passive router with no backing stream.
  const router = createBlockRuntimeEventRouter({ listen: () => () => {} })
  const registry = createBlockRuntimeRegistry()

  const services: BlockRuntimeServices = {
    serverSDK: undefined as never,
    eventRouter: router as never,
    workspace: {
      id: () => props.workspaceID(),
      epoch: () => props.workspaceEpoch(),
      connected: () => props.connected(),
      awaitDescriptorPersisted: props.awaitDescriptorPersisted,
    },
    localView: props.localView,
  }

  onCleanup(() => {
    router.dispose()
  })

  return <BlockRuntimeServicesContext.provider value={services}>{props.children}</BlockRuntimeServicesContext.provider>
}
