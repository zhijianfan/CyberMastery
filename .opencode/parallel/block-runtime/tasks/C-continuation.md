You are worker 3 of 8 (RETRY). Your previous run explored files but wrote NOTHING and was stopped by a provider/permission error. This time: WRITE THE FILES FIRST, validate after. Implement NOW, no questions, no further exploration beyond the pointers below.

Owned files — create ONLY these two:
- packages/server/src/runtime/adapters/opencode-chat.ts
- packages/server/src/runtime/adapters/opencode-chat.test.ts

Key pointers (read only these if needed):
- packages/core/src/workspace/chat-relay-session.ts — EXISTING block→session binding service (get/ensure/reset). REUSE it, do not duplicate.
- packages/server/src/handlers/chat-relay-session.ts and chat-relay-session-access.ts — how the binding service is exposed.
- packages/core/src/session.ts and packages/core/src/session/ — native session create/list/prompt/abort APIs (V2 session core: prompt admission vs steer/queue semantics — see AGENTS.md V2 Session Core notes).
- packages/core/src/permission/ — native permission request/respond services.
- packages/core/src/credential/ and packages/core/src/oauth/ — provider auth state.
- packages/server/src/handlers/permission.ts — permission handler conventions.

Implement OpencodeChatAdapter (Effect-style service with Context.Tag + Layer, mirroring the style of packages/core/src/workspace/chat-relay-session.ts):

```ts
export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }
```

Service methods (all delegate to NATIVE services — never reimplement auth/transport):
- authStart(providerID) -> { loginURL?: string; userCode?: string } via native auth service
- authStatus(providerID) -> AuthRuntimeState { providerID, status: "missing"|"awaiting-login"|"ready"|"error", loginURL?, userCode?, error? }
- sessionCreate(opts?: { modelID?: string; agentID?: string }) -> SessionRuntimeState { id, status: "idle"|"busy", directory?, modelID?, agentID?, error? }
- sessionEnsure(workspaceID, blockID) -> binding via the existing chat-relay-session service (returns sessionID etc.)
- sessionGet(sessionID) -> SessionRuntimeState
- prompt(sessionID, { text, delivery }) -> native session prompt with steer/queue mapping
- abort(sessionID) -> native abort
- permissionRespond(requestID, response) -> native permission response
- messages(sessionID) -> MessageRuntimeState[] { id, sessionID, role: "user"|"assistant", timeCreated?, important? }
- parts(messageID) -> MessagePartRuntimeState[] { id, messageID, kind: "text"|"tool"|"reasoning"|"permission", text?, state?, error? }
- PermissionRuntimeState = { id, requestID, sessionID, status: "pending"|"resolved", response? }

Rules:
- No fetch to chatgpt.com/backend-api/* anywhere. OAuth token refresh stays in native provider code (see packages/opencode/src/plugin/openai/codex.ts for context — do NOT copy its transport).
- Preserve tool calls, permissions, retry state, errors as first-class fields — never flatten messages into one final string.
- Header comment: the `important` message toggle and operating-context.jsonl forwarding are CyberMaster-specific metadata, deliberately NOT pushed into the core session schema.
- Test file: pure mapping tests with fakes (no network): command -> native call mapping, state-shape mapping preserves tool/permission/error info, missing binding triggers session creation and returns the binding.

Do not touch: packages/core/**, protocol, app, central registrations (master wires them). You may run only a targeted check of your own files.

Report: files changed, implemented, uncertain.
