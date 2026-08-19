import { Context, Effect, Layer } from "effect"
import { ChatRelaySessionService } from "@opencode-ai/core/workspace/chat-relay-session"

export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }

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

export interface OpencodeChatAdapter {
  authStart(providerID: string): Effect.Effect<{ loginURL?: string; userCode?: string }, unknown, never>
  authStatus(providerID: string): Effect.Effect<AuthRuntimeState, unknown, never>
  sessionCreate(opts?: { modelID?: string; agentID?: string }): Effect.Effect<SessionRuntimeState, unknown, never>
  sessionEnsure(workspaceID: string, blockID: string): Effect.Effect<SessionRuntimeState, unknown, never>
  sessionGet(sessionID: string): Effect.Effect<SessionRuntimeState, unknown, never>
  prompt(sessionID: string, input: { text: string; delivery: "steer" | "queue" }): Effect.Effect<void, unknown, never>
  abort(sessionID: string): Effect.Effect<void, unknown, never>
  permissionRespond(requestID: string, response: "allow-once" | "allow-always" | "deny"): Effect.Effect<void, unknown, never>
  messages(sessionID: string): Effect.Effect<MessageRuntimeState[], unknown, never>
  parts(input: { sessionID: string; messageID: string }): Effect.Effect<MessagePartRuntimeState[], unknown, never>
  pendingPermissions(sessionID: string): Effect.Effect<PermissionRuntimeState[], unknown, never>
}

// TODO: Replace ProviderAuthRuntimeService with the concrete provider/auth service tag used by this package.
interface ProviderAuthRuntimeApi {
  readonly start: (providerID: string) => Effect.Effect<{ loginURL?: string; userCode?: string }, unknown, never>
  readonly status: (
    providerID: string,
  ) => Effect.Effect<
    { providerID: string; status: "missing" | "awaiting-login" | "ready" | "error"; loginURL?: string; userCode?: string; error?: string },
    unknown,
    never
  >
}

// TODO: Replace NativeSessionRuntimeService with the concrete session runtime service tag used by this package.
interface NativeSessionRuntimeApi {
  readonly create: (input?: { modelID?: string; agentID?: string }) => Effect.Effect<SessionRuntimeState, never, never>
  readonly get: (sessionID: string) => Effect.Effect<SessionRuntimeState | undefined, unknown, never>
  readonly prompt: (sessionID: string, input: { text: string; delivery: "steer" | "queue" }) => Effect.Effect<void, unknown, never>
  readonly abort: (sessionID: string) => Effect.Effect<void, unknown, never>
  readonly messages: (sessionID: string) => Effect.Effect<NativeMessageRuntime[], unknown, never>
  readonly parts: (input: { sessionID: string; messageID: string }) => Effect.Effect<NativeMessagePartRuntime[], unknown, never>
  readonly pendingPermissions: (sessionID: string) => Effect.Effect<NativePermissionRuntime[], unknown, never>
}

// TODO: Replace PermissionRuntimeService with the concrete permission service tag used by this package.
interface PermissionRuntimeApi {
  readonly respond: (
    requestID: string,
    response: "allow-once" | "allow-always" | "deny",
  ) => Effect.Effect<void, unknown, never>
}

type ChatRelaySessionShape = Parameters<typeof ChatRelaySessionService.Service.of>[0]

interface NativeMessageRuntime {
  id: string
  sessionID: string
  role: "user" | "assistant" | string
  createdAt?: number
  timeCreated?: number
  importance?: "high" | "normal" | "low"
  important?: boolean
}

interface NativeMessagePartRuntime {
  id: string
  messageID: string
  kind: "text" | "tool" | "reasoning" | "permission" | string
  text?: string
  tool?: unknown
  permission?: unknown
  state?: unknown
  error?: unknown
}

interface NativePermissionRuntime {
  id: string
  requestID: string
  sessionID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export class ProviderAuthRuntimeService extends Context.Service<ProviderAuthRuntimeService, ProviderAuthRuntimeApi>()("@opencode/ProviderAuthRuntime") {}

export class NativeSessionRuntimeService extends Context.Service<NativeSessionRuntimeService, NativeSessionRuntimeApi>()("@opencode/NativeSessionRuntime") {}

export class PermissionRuntimeService extends Context.Service<PermissionRuntimeService, PermissionRuntimeApi>()("@opencode/PermissionRuntime") {}

// important toggle + operating-context.jsonl are CyberMaster-specific metadata, deliberately not in the core session schema.
const defaultSessionError = (error: unknown) => (error as Error)?.message ?? "unknown error"

function mapAuthState(providerID: string, state: { status: "missing" | "awaiting-login" | "ready" | "error"; loginURL?: string; userCode?: string; error?: unknown }): AuthRuntimeState {
  return {
    providerID,
    status: state.status,
    loginURL: state.loginURL,
    userCode: state.userCode,
    error: state.error ? String(state.error) : undefined,
  }
}

export function mapSessionState(session: SessionRuntimeState): SessionRuntimeState {
  return {
    id: session.id,
    status: session.status,
    directory: session.directory,
    modelID: session.modelID,
    agentID: session.agentID,
    error: session.error,
  }
}

export function mapMessageState(message: NativeMessageRuntime): MessageRuntimeState {
  return {
    id: message.id,
    sessionID: message.sessionID,
    role: message.role === "assistant" ? "assistant" : "user",
    timeCreated: message.timeCreated ?? message.createdAt,
    important: message.important ?? message.importance === "high",
  }
}

function mapPartKind(kind: string): MessagePartRuntimeState["kind"] {
  if (kind === "tool") return "tool"
  if (kind === "permission") return "permission"
  if (kind === "reasoning") return "reasoning"
  return "text"
}

export function mapPartState(part: NativeMessagePartRuntime): MessagePartRuntimeState {
  const state: Record<string, unknown> = {}
  if (part.state !== undefined) state.state = part.state
  if (part.tool !== undefined) state.tool = part.tool
  if (part.permission !== undefined) state.permission = part.permission
  if (part.error !== undefined) state.error = part.error

  return {
    id: part.id,
    messageID: part.messageID,
    kind: mapPartKind(part.kind),
    text: part.text,
    state: Object.keys(state).length > 0 ? state : part.state,
    error: part.error === undefined ? undefined : typeof part.error === "string" ? part.error : defaultSessionError(part.error),
  }
}

export function mapPermissionState(permission: NativePermissionRuntime): PermissionRuntimeState {
  return {
    id: permission.id,
    requestID: permission.requestID,
    sessionID: permission.sessionID,
    status: permission.status,
    response: permission.response,
  }
}

function isMissingBindingError(error: unknown): error is { _tag: "MissingBindingError"; workspaceID: string; blockID: string; sessionID?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { _tag?: unknown })._tag === "MissingBindingError" &&
    typeof (error as { workspaceID?: unknown }).workspaceID === "string" &&
    typeof (error as { blockID?: unknown }).blockID === "string"
  )
}

function withSessionRecovery<T>(
  sessionID: string,
  bind: ChatRelaySessionShape,
  failure: unknown,
  continueWith: (nextSessionID: string) => Effect.Effect<T, unknown, never>,
): Effect.Effect<T, unknown, never> {
  if (!isMissingBindingError(failure)) return Effect.fail(failure)
  return Effect.gen(function* () {
    const binding = yield* bind.ensure(failure.workspaceID as never, failure.blockID)
    if (binding.sessionID === sessionID) {
      return yield* continueWith(sessionID)
    }
    return yield* continueWith(binding.sessionID)
  })
}

export const executeChatRelayCommand = (
  adapter: OpencodeChatAdapter,
  resolveSessionID: (command: ChatRelayCommand) => string,
) => (command: ChatRelayCommand): Effect.Effect<unknown, unknown, never> => {
    if (command.type === "auth.start") return adapter.authStart(command.providerID)
    if (command.type === "session.create") return adapter.sessionCreate({ modelID: command.modelID, agentID: command.agentID })
    if (command.type === "session.prompt") return adapter.prompt(resolveSessionID(command), command)
    if (command.type === "session.abort") return adapter.abort(resolveSessionID(command))
    return adapter.permissionRespond(command.requestID, command.response)
  }

export class OpencodeChat extends Context.Service<OpencodeChat, OpencodeChatAdapter>()("@opencode/OpencodeChat") {}

export const OpencodeChatLive = Layer.effect(
  OpencodeChat,
  Effect.gen(function* () {
    const auth = yield* ProviderAuthRuntimeService
    const sessions = yield* NativeSessionRuntimeService
    const permissions = yield* PermissionRuntimeService
    const chatRelaySession = yield* ChatRelaySessionService.Service

    return OpencodeChat.of({
      authStart: (providerID) =>
        auth.start(providerID).pipe(
          Effect.map((result) => ({
            loginURL: result.loginURL,
            userCode: result.userCode,
          })),
        ),
      authStatus: (providerID) =>
        auth.status(providerID).pipe(Effect.map((state) => mapAuthState(providerID, state))),
      sessionCreate: (opts) => sessions.create(opts).pipe(Effect.map(mapSessionState)),
      sessionEnsure: (workspaceID, blockID) =>
        Effect.gen(function* () {
          const binding = yield* chatRelaySession.ensure(workspaceID as never, blockID)
          const session = yield* sessions.get(binding.sessionID).pipe(
            Effect.map((value) => value ?? {
              id: binding.sessionID,
              status: "idle" as const,
              directory: binding.directory,
               error: "session not initialized",
             }),
          )
          return mapSessionState(session)
        }),
      sessionGet: (sessionID) => {
        const readSession = (resolvedSessionID: string) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(resolvedSessionID)
            if (!session) return yield* Effect.fail(new Error(`session ${resolvedSessionID} not found`))
            return session
          })

        return readSession(sessionID).pipe(
          Effect.map(mapSessionState),
          Effect.catch((error) => withSessionRecovery<SessionRuntimeState>(sessionID, chatRelaySession, error, readSession)),
        )
      },
      prompt: (sessionID, input) =>
        sessions.prompt(sessionID, input).pipe(
          Effect.catch((error) =>
            withSessionRecovery<void>(sessionID, chatRelaySession, error, (recoveredSessionID) => sessions.prompt(recoveredSessionID, input)),
          ),
        ),
      abort: (sessionID) =>
        sessions.abort(sessionID).pipe(
          Effect.catch((error) =>
            withSessionRecovery<void>(sessionID, chatRelaySession, error, (recoveredSessionID) => sessions.abort(recoveredSessionID)),
          ),
        ),
      permissionRespond: (requestID, response) => permissions.respond(requestID, response),
      messages: (sessionID) =>
        sessions.messages(sessionID).pipe(
          Effect.map((messages) => messages.map(mapMessageState)),
          Effect.catch((error) =>
            withSessionRecovery<MessageRuntimeState[]>(sessionID, chatRelaySession, error, (recoveredSessionID) =>
              sessions.messages(recoveredSessionID).pipe(Effect.map((messages) => messages.map(mapMessageState))),
            ),
          ),
        ),
      parts: (input) =>
        sessions.parts(input).pipe(Effect.map((parts) => parts.map(mapPartState))),
      pendingPermissions: (sessionID) =>
        sessions.pendingPermissions(sessionID).pipe(
          Effect.map((permissions) => permissions.map(mapPermissionState)),
          Effect.catch((error) =>
            withSessionRecovery<PermissionRuntimeState[]>(sessionID, chatRelaySession, error, (recoveredSessionID) =>
              sessions.pendingPermissions(recoveredSessionID).pipe(Effect.map((items) => items.map(mapPermissionState))),
            ),
          ),
        ),
    } satisfies OpencodeChatAdapter)
  }),
)
