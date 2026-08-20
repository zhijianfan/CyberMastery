import type { Accessor } from "solid-js"

import type { ServerEvent, ServerSDK } from "@/context/server-sdk"

export interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: {
    x: number
    y: number
    w: number
    h: number
    z: number
  }
}

export type BlockRuntimeMode = "native" | "projected" | "local" | "static"

export type RuntimeStatus = "resolving" | "ready" | "stale" | "unavailable" | "permission-denied" | "error"

export interface RuntimeEventKey {
  type: string
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  resourceID?: string
}

export type RuntimeProjectionPatch =
  | { op: "replace"; value: unknown; revision?: number }
  | { op: "merge"; value: Record<string, unknown>; revision?: number }
  | { op: "append"; path: readonly string[]; value: unknown; revision?: number }
  | { op: "remove"; path?: readonly string[]; revision?: number }

export interface BlockRuntimeEventRouter {
  on(eventKey: RuntimeEventKey, listener: (event: ServerEvent) => void): () => void
  off(eventKey: RuntimeEventKey, listener: (event: ServerEvent) => void): void
  onReconnect(listener: () => void): () => void
}

export interface BlockLocalViewStore {
  read<T>(key: string): T | undefined
  write<T>(key: string, value: T): void
  delete(key: string): void
  clearAll(): void
}

export interface BlockRuntimeServices {
  serverSDK: Accessor<ServerSDK>
  eventRouter: BlockRuntimeEventRouter
  workspace: {
    id(): string | undefined
    epoch(): number
    connected(): boolean
    awaitDescriptorPersisted(blockID: string, signal: AbortSignal): Promise<void>
  }
  localView: BlockLocalViewStore
}

export interface BlockRuntimeRegistration<TResolved, TView, TCommand> {
  functionalityID: string
  mode: BlockRuntimeMode
  resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<TResolved>
  eventKeys?(resolved: TResolved): readonly RuntimeEventKey[]
  onEvent?(input: {
    event: ServerEvent
    resolved: TResolved
    services: BlockRuntimeServices
  }): "ignore" | "invalidate" | RuntimeProjectionPatch
  select(input: {
    resolved: TResolved
    projection: unknown
    localView: unknown
  }): TView
  dispatch?(input: {
    resolved: TResolved
    command: TCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<void>
  dispose?(resolved: TResolved): void
}

export interface RuntimeBlockHandle<TView = unknown, TCommand = unknown> {
  status(): RuntimeStatus
  view(): TView | undefined
  error(): unknown
  refresh(reason?: string): Promise<void>
  dispatch(command: TCommand): Promise<void>
  dispose(): void
}
