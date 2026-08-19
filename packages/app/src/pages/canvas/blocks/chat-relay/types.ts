import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"

export interface BlockDescriptor {
  id: string
  functionalityID: string
  layout: { x: number; y: number; width: number; height: number }
  bindings: Record<string, string | undefined>
  config?: unknown
}

export interface ChatRelayBlockDescriptor extends BlockDescriptor {
  functionalityID: "builtin:chat-relay"
  bindings: { sessionID?: string }
  config?: { showTools?: boolean; showPermissions?: boolean; showTerminal?: boolean }
}

export interface RuntimeResourceBinding {
  type: "auth" | "session" | "message" | "message-part" | "permission" | "pty" | "file" | "review"
  id: string
  parentID?: string
}

export interface RuntimeEventEnvelope<T = unknown> {
  cursor: string
  revision?: number
  timestamp: number
  resource: RuntimeResourceBinding
  event: string
  data: T
}

export interface RuntimeSnapshot<T> {
  cursor: string
  state: T
}

export interface AuthRuntimeState {
  providerID: string
  status: "missing" | "awaiting-login" | "ready" | "error"
  loginURL?: string
  userCode?: string
  error?: string
}

export interface SessionRuntimeState {
  id: string
  status: "idle" | "busy"
  directory?: string
  modelID?: string
  agentID?: string
  error?: string
}

export interface MessageRuntimeState {
  id: string
  sessionID: string
  role: "user" | "assistant"
  timeCreated?: number
  important?: boolean
}

export interface MessagePartRuntimeState {
  id: string
  messageID: string
  kind: "text" | "tool" | "reasoning" | "permission"
  text?: string
  state?: unknown
  error?: string
}

export interface PermissionRuntimeState {
  id: string
  requestID: string
  sessionID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export interface RuntimeResourceState {
  connection: { status: "connecting" | "connected" | "disconnected"; cursor?: string; lastError?: string }
  authByProvider: Record<string, AuthRuntimeState>
  sessionsByID: Record<string, SessionRuntimeState>
  messagesByID: Record<string, MessageRuntimeState>
  partsByID: Record<string, MessagePartRuntimeState>
  permissionsByID: Record<string, PermissionRuntimeState>
}

export interface BlockRuntimeContext {
  snapshot(bindings: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (e: RuntimeEventEnvelope) => void): () => void
}

export interface BlockRuntimeAdapter<TDescriptor extends BlockDescriptor, TView, TCommand> {
  getBindings(descriptor: TDescriptor): RuntimeResourceBinding[]
  hydrate(descriptor: TDescriptor, context: BlockRuntimeContext): Promise<RuntimeSnapshot<unknown>>
  select(descriptor: TDescriptor, resources: RuntimeResourceState): TView
  dispatch(descriptor: TDescriptor, command: TCommand, context: BlockRuntimeContext): Promise<void>
}

export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }

export interface ChatRelayBodyProps {
  block: { id: string; bindings?: Record<string, string | undefined> }
  permissions?: PermissionConfig
  workspaceID: string
  focused: boolean
  onFocus(): void
}
