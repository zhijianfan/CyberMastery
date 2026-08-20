import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup, type Accessor, type JSX } from "solid-js"
import { createEffect } from "solid-js"
import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import type { BlockRuntimeServices, BlockLocalViewStore } from "./contracts"
import { createBlockRuntimeEventRouter } from "./event-router"

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
  /** Test seam: overrides the ServerSDK context accessor (same pattern as the manager). */
  serverSDK?: Accessor<ServerSDK>
  children: JSX.Element
}) {
  const serverSDK = props.serverSDK ?? useServerSDK()

  // The single app event stream (C3). The ServerSDK emitter delivers
  // `{ name, details }` where `details` is the ServerEvent (type + properties);
  // the router expects `{ details: { type, properties } }`.
  const router = createBlockRuntimeEventRouter({
    listen: (handler) =>
      serverSDK().event.listen((entry) => {
        handler({ details: { type: entry.details.type, properties: entry.details.properties } })
      }),
  })

  const services: BlockRuntimeServices = {
    serverSDK,
    eventRouter: router as never,
    workspace: {
      id: () => props.workspaceID(),
      epoch: () => props.workspaceEpoch(),
      connected: () => props.connected(),
      awaitDescriptorPersisted: props.awaitDescriptorPersisted,
    },
    localView: props.localView,
  }

  // Reconnect notifications (C5): mount/refresh adapters that subscribed to
  // the router get one authoritative-refresh signal when the connection comes
  // back. Children subscribe after this effect's first run, so the initial
  // connected state does not fire a spurious reconnect.
  let wasConnected = false
  createEffect(() => {
    const connected = props.connected()
    if (connected && !wasConnected) router.notifyReconnect()
    wasConnected = connected
  })

  onCleanup(() => {
    router.dispose()
  })

  return <BlockRuntimeServicesContext.provider value={services}>{props.children}</BlockRuntimeServicesContext.provider>
}
