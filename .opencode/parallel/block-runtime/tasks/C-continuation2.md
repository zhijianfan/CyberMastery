You are worker 3 of 8 (RETRY 2). Your previous TWO runs wrote NOTHING — you explored and then stopped. This run is different: your FIRST action after reading TWO files is to WRITE code. Do not run any other exploration. Do not grep broadly. Do not stop to ask.

Step 1 — read exactly these two files (no more):
- packages/core/src/workspace/chat-relay-session.ts
- packages/server/src/handlers/chat-relay-session.ts

Step 2 — IMMEDIATELY write packages/server/src/runtime/adapters/opencode-chat.ts
(mirror the Effect service pattern from chat-relay-session.ts: Context.Tag +
interface + Layer). Include this content, then fill in implementations with your
best judgment using the service deps you saw in those two files (Session,
Permission, and provider/auth services; if a service name is uncertain, use a
generic `Context.Service` dependency and add a TODO comment):

```ts
import { Context, Effect, Layer } from "effect"

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
  authStart(providerID: string): Effect.Effect<{ loginURL?: string; userCode?: string }, unknown, unknown>
  authStatus(providerID: string): Effect.Effect<AuthRuntimeState, unknown, unknown>
  sessionCreate(opts?: { modelID?: string; agentID?: string }): Effect.Effect<SessionRuntimeState, unknown, unknown>
  sessionEnsure(workspaceID: string, blockID: string): Effect.Effect<SessionRuntimeState, unknown, unknown>
  sessionGet(sessionID: string): Effect.Effect<SessionRuntimeState, unknown, unknown>
  prompt(sessionID: string, input: { text: string; delivery: "steer" | "queue" }): Effect.Effect<void, unknown, unknown>
  abort(sessionID: string): Effect.Effect<void, unknown, unknown>
  permissionRespond(requestID: string, response: "allow-once" | "allow-always" | "deny"): Effect.Effect<void, unknown, unknown>
  messages(sessionID: string): Effect.Effect<MessageRuntimeState[], unknown, unknown>
  parts(messageID: string): Effect.Effect<MessagePartRuntimeState[], unknown, unknown>
  pendingPermissions(sessionID: string): Effect.Effect<PermissionRuntimeState[], unknown, unknown>
}

export class OpencodeChat extends Context.Tag("OpencodeChat")<OpencodeChat, OpencodeChatAdapter>() {}

export const OpencodeChatLive = Layer.effect(
  OpencodeChat,
  Effect.gen(function* () {
    // TODO: use the service deps you saw in chat-relay-session.ts (Session,
    // Permission, provider auth) to implement each method. sessionEnsure
    // delegates to the EXISTING chat-relay-session service. Never fetch
    // chatgpt.com/backend-api/*; token refresh stays in native provider code.
    return {
      authStart: (providerID) => Effect.succeed({}),
      authStatus: (providerID) => Effect.succeed({ providerID, status: "missing" }),
      sessionCreate: () => Effect.fail(new Error("TODO: native session create")),
      sessionEnsure: (workspaceID, blockID) => Effect.fail(new Error("TODO: delegate to chat-relay-session service")),
      sessionGet: () => Effect.fail(new Error("TODO: native session get")),
      prompt: () => Effect.fail(new Error("TODO: native prompt with steer/queue")),
      abort: () => Effect.fail(new Error("TODO: native abort")),
      permissionRespond: () => Effect.fail(new Error("TODO: native permission response")),
      messages: () => Effect.fail(new Error("TODO: native message listing")),
      parts: () => Effect.fail(new Error("TODO: native part listing")),
      pendingPermissions: () => Effect.fail(new Error("TODO: native permission listing")),
    } satisfies OpencodeChatAdapter
  }),
)
```

Replace every TODO with a real delegation to native services. Keep tool calls,
permissions, and errors as first-class fields — do not flatten messages into one
string. Header comment must note: `important` toggle + operating-context.jsonl
are CyberMaster-specific metadata, deliberately not in the core session schema.

Step 3 — write packages/server/src/runtime/adapters/opencode-chat.test.ts with
pure fake-based tests (no network): command->method mapping, state mapping
preserves tool/permission/error info, missing binding triggers sessionEnsure.

Do not touch any other files. You may run only targeted checks of your own files.

Report: files changed, implemented, uncertain.
