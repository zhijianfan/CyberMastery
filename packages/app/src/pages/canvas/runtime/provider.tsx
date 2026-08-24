import { createContext, createEffect, onCleanup, useContext, type Accessor, type JSX } from "solid-js"
import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import type { BlockRuntimeServices, BlockLocalViewStore } from "./contracts"
import { createBlockRuntimeEventRouter } from "./event-router"

const BlockRuntimeServicesContext = createContext<BlockRuntimeServices>()

export function useBlockRuntimeServices(): BlockRuntimeServices | undefined {
  return useContext(BlockRuntimeServicesContext)
}

export function BlockRuntimeProvider(props: {
  workspaceID: () => string | undefined
  workspaceEpoch: () => number
  connected: () => boolean
  awaitDescriptorPersisted: (blockID: string, signal: AbortSignal) => Promise<void>
  recoverWorkspace: (error: unknown) => Promise<boolean>
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
        handler({ details: { id: entry.details.id, type: entry.details.type, properties: entry.details.properties } })
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
      recover: props.recoverWorkspace,
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

  return <BlockRuntimeServicesContext.Provider value={services}>{props.children}</BlockRuntimeServicesContext.Provider>
}
