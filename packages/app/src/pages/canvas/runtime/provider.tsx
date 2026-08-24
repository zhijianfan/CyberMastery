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
  let observedServerConnection = false

  // The single app event stream (C3). The ServerSDK emitter delivers
  // `{ name, details }` where `details` is the ServerEvent (type + properties);
  // the router expects `{ details: { type, properties } }`.
  const router = createBlockRuntimeEventRouter({
    listen: (handler) =>
      serverSDK().event.listen((entry) => {
        if (entry.details.type === "server.connected") {
          // The first observed stream connection establishes the baseline;
          // the host's initial resolve already fetched current authority.
          if (observedServerConnection) router.notifyReconnect()
          observedServerConnection = true
        }
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

  // Manager connectivity transitions and post-initial stream connections both
  // converge through the router's bounded per-registration refresh semantics.
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
