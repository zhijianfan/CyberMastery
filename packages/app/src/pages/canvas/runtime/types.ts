export type {
  BlockRuntimeMode,
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  BlockRuntimeEventRouter,
  BlockLocalViewStore,
  CanvasBlockDescriptor,
  RuntimeBlockHandle,
  RuntimeEventKey,
  RuntimeProjectionPatch,
  RuntimeStatus,
} from "./contracts"

export type BlockDescriptor = {
  /**
   * @deprecated Migrate callers to {@link CanvasBlockDescriptor}.
   */
  id: string
  functionalityID: string
  layout: {
    x: number
    y: number
    width: number
    height: number
  }
  bindings: Record<string, string | undefined>
  config?: unknown
}

export type RuntimeResourceBinding = {
  /**
   * @deprecated Runtime contracts now use generic projection patches.
   */
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}

export type RuntimeEventEnvelope<T = unknown> = {
  /**
   * @deprecated Cursor-based sequencing belongs to legacy block runtime stores.
   */
  cursor: string
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string
  data: T
}

export type RuntimeSnapshot<T> = {
  /**
   * @deprecated Cursor-based sequencing belongs to legacy block runtime stores.
   */
  cursor: string
  state: T
}

export type AuthRuntimeState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  providerID: string
  status: "missing" | "awaiting-login" | "ready" | "error"
  loginURL?: string
  userCode?: string
  error?: string
}

export type SessionRuntimeState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  id: string
  status: "idle" | "busy"
  directory?: string
  modelID?: string
  agentID?: string
  error?: string
}

export type MessageRuntimeState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  id: string
  sessionID: string
  role: "user" | "assistant"
  timeCreated?: number
  important?: boolean
}

export type MessagePartRuntimeState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  id: string
  messageID: string
  kind: "text" | "tool" | "reasoning" | "permission"
  text?: string
  state?: unknown
  error?: string
}

export type PermissionRuntimeState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  id: string
  requestID: string
  sessionID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export type RuntimeResourceState = {
  /** @deprecated Legacy compatibility type retained for existing chat relay runtime tests. */
  connection: {
    status: "connecting" | "connected" | "disconnected"
    cursor?: string
    lastError?: string
  }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}

export type BlockRuntimeContext = {
  /** @deprecated Legacy compatibility type retained for old chat relay tests. */
  snapshot(bindings: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (e: RuntimeEventEnvelope) => void): () => void
}

export type BlockRuntimeAdapter<TDescriptor extends BlockDescriptor, TView, TCommand> = {
  /** @deprecated Legacy adapter contract retained for current chat relay runtime tests. */
  getBindings(descriptor: TDescriptor): RuntimeResourceBinding[]
  hydrate(descriptor: TDescriptor, context: BlockRuntimeContext): Promise<RuntimeSnapshot<RuntimeResourceState>>
  select(descriptor: TDescriptor, resources: RuntimeResourceState): TView
  dispatch(descriptor: TDescriptor, command: TCommand, context: BlockRuntimeContext): Promise<void>
}
