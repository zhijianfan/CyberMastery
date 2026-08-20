export type {
  BlockRuntimeMode,
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  BlockRuntimeEventRouter,
  BlockLocalViewStore,
  CanvasBlockDescriptor,
  RuntimeBlockHandle,
  RuntimeEventKey,
  RuntimeStatus,
} from "./contracts"

export type RuntimeResourceBinding = {
  /** @deprecated Retained while the shared block-runtime store still consumes this shape. */
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}

export type RuntimeEventEnvelope<T = unknown> = {
  /** @deprecated Cursor sequencing belongs to the legacy shared block-runtime store. */
  cursor: string
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string
  data: T
}

export type RuntimeSnapshot<T> = {
  /** @deprecated Cursor sequencing belongs to the legacy shared block-runtime store. */
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
