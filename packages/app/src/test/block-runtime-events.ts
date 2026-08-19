export type RuntimeResourceType =
  | "auth"
  | "session"
  | "message"
  | "message-part"
  | "permission"
  | "pty"
  | "file"
  | "review"

export interface RuntimeResourceBinding {
  type: RuntimeResourceType
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

const BASE_TIMESTAMP = 1_700_000_000_000

function makeCursor(kind: string, sequence: number) {
  return `${kind}:${String(sequence).padStart(4, "0")}`
}

function envelope<T>(
  cursor: string,
  event: string,
  resource: RuntimeResourceBinding,
  revision: number,
  data: T,
): RuntimeEventEnvelope<T> {
  return {
    cursor,
    revision,
    timestamp: BASE_TIMESTAMP + revision,
    resource,
    event,
    data,
  }
}

export const SKIPPED_CURSOR = "runtime:SKIPPED"

export function makeEmptyRuntimeState(): RuntimeSnapshot<RuntimeResourceState> {
  return {
    cursor: makeCursor("runtime", 0),
    state: {
      connection: { status: "connected" },
      authByProvider: {},
      sessionsByID: {},
      messagesByID: {},
      partsByID: {},
      permissionsByID: {},
    },
  }
}

export function buildAuthTransitionEvents(params: { providerID?: string; sequenceStart?: number } = {}) {
  const providerID = params.providerID ?? "acme"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "auth", id: providerID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("auth", start),
        "auth.updated",
        binding,
        1,
        { providerID, status: "missing" } satisfies AuthRuntimeState,
      ),
      envelope(
        makeCursor("auth", start + 1),
        "auth.updated",
        binding,
        2,
        {
          providerID,
          status: "awaiting-login",
          loginURL: "https://provider.local/device",
          userCode: "A1B2C3",
        } satisfies AuthRuntimeState,
      ),
      envelope(
        makeCursor("auth", start + 2),
        "auth.updated",
        binding,
        3,
        { providerID, status: "ready" } satisfies AuthRuntimeState,
      ),
    ] as RuntimeEventEnvelope<AuthRuntimeState>[],
  }
}

export function buildSessionStatusEvents(params: {
  sessionID?: string
  sequenceStart?: number
  modelID?: string
  agentID?: string
}) {
  const sessionID = params.sessionID ?? "session-1"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "session", id: sessionID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("session", start),
        "session.created",
        binding,
        1,
        {
          id: sessionID,
          status: "idle",
          directory: "/repo/main",
          modelID: params.modelID,
          agentID: params.agentID,
        } satisfies SessionRuntimeState,
      ),
      envelope(makeCursor("session", start + 1), "session.status", binding, 2, {
        id: sessionID,
        status: "busy",
      } satisfies Pick<SessionRuntimeState, "id" | "status">),
      envelope(makeCursor("session", start + 2), "session.status", binding, 3, {
        id: sessionID,
        status: "idle",
      } satisfies Pick<SessionRuntimeState, "id" | "status">),
    ] as RuntimeEventEnvelope<SessionRuntimeState | Pick<SessionRuntimeState, "id" | "status">>[],
  }
}

export function buildMessageShellEvents(params: {
  sessionID?: string
  userMessageID?: string
  assistantMessageID?: string
  sequenceStart?: number
}) {
  const sessionID = params.sessionID ?? "session-1"
  const userMessageID = params.userMessageID ?? "user-1"
  const assistantMessageID = params.assistantMessageID ?? "assistant-1"
  const start = params.sequenceStart ?? 1
  return {
    userMessageID,
    assistantMessageID,
    events: [
      envelope(makeCursor("message", start), "message.created", {
        type: "message",
        id: userMessageID,
        parentID: sessionID,
      }, 1, {
        id: userMessageID,
        sessionID,
        role: "user",
        timeCreated: BASE_TIMESTAMP + start,
      } satisfies MessageRuntimeState),
      envelope(makeCursor("message", start + 1), "message.created", {
        type: "message",
        id: assistantMessageID,
        parentID: sessionID,
      }, 2, {
        id: assistantMessageID,
        sessionID,
        role: "assistant",
        timeCreated: BASE_TIMESTAMP + start + 1,
      } satisfies MessageRuntimeState),
    ] as RuntimeEventEnvelope<MessageRuntimeState>[],
  }
}

export function buildIncrementalTextPartEvents(params: {
  messageID?: string
  partID?: string
  textChunks?: string[]
  sessionID?: string
  sequenceStart?: number
}) {
  const messageID = params.messageID ?? "assistant-1"
  const partID = params.partID ?? "part-1"
  const chunks = params.textChunks ?? ["Hello", ", ", "world", "!"]
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = {
    type: "message-part",
    id: partID,
    parentID: messageID,
  }
  return {
    partID,
    events: chunks.map((chunk, index) =>
      envelope(
        makeCursor("part", start + index),
        "message-part.updated",
        binding,
        start + index + 1,
        {
          id: partID,
          messageID,
          kind: "text",
          text: chunk,
        } satisfies MessagePartRuntimeState,
      ),
    ) as RuntimeEventEnvelope<MessagePartRuntimeState>[],
  }
}

export function buildPermissionFlowEvents(params: {
  sessionID?: string
  requestID?: string
  permissionID?: string
  sequenceStart?: number
  response?: "allow-once" | "allow-always" | "deny"
}) {
  const sessionID = params.sessionID ?? "session-1"
  const requestID = params.requestID ?? "perm-req-1"
  const permissionID = params.permissionID ?? "permission-1"
  const start = params.sequenceStart ?? 1
  const response = params.response ?? "allow-once"
  const binding: RuntimeResourceBinding = { type: "permission", id: permissionID, parentID: sessionID }
  return {
    binding,
    events: [
      envelope(
        makeCursor("permission", start),
        "permission.requested",
        binding,
        1,
        {
          id: permissionID,
          requestID,
          sessionID,
          status: "pending",
        } satisfies PermissionRuntimeState,
      ),
      envelope(
        makeCursor("permission", start + 1),
        "permission.resolved",
        binding,
        2,
        {
          id: permissionID,
          requestID,
          sessionID,
          status: "resolved",
          response,
        } satisfies PermissionRuntimeState,
      ),
    ] as RuntimeEventEnvelope<PermissionRuntimeState>[],
  }
}

export function buildDisconnectResumeEvents(params: { sessionID?: string; sequenceStart?: number }) {
  const sessionID = params.sessionID ?? "session-1"
  const start = params.sequenceStart ?? 1
  const binding: RuntimeResourceBinding = { type: "session", id: sessionID }
  return {
    binding,
    events: [
      envelope(makeCursor("connection", start), "connection.error", binding, 1, {
        status: "disconnected",
        cursor: makeCursor("connection", start),
        lastError: "network down",
      }),
      envelope(makeCursor("connection", start + 1), "connection.connected", binding, 2, {
        status: "connected",
        cursor: makeCursor("connection", start + 1),
      }),
    ] as RuntimeEventEnvelope<{ status: string; cursor: string; lastError?: string }>[
    ],
  }
}

export function buildDuplicateEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return { ...event }
}

export function buildStaleRevisionEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return {
    ...event,
    revision: Math.max((event.revision ?? 2) - 2, 0),
    cursor: event.cursor,
  }
}

export function buildSkippedCursorEvent<T>(event: RuntimeEventEnvelope<T>): RuntimeEventEnvelope<T> {
  return {
    ...event,
    cursor: SKIPPED_CURSOR,
  }
}
