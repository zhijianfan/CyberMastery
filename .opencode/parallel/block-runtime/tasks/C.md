# Task C — OpenCode-Native Chat/Auth/Session Adapter (worker 3 of 8)

You are worker 3 of 8. Implement ONLY this task.
- Edit ONLY the files listed as your owned files. Never touch other files, shared configs, lockfiles, or generated code.
- Read any existing code you need first; follow the repo conventions (bun workspace, .js import suffixes, Effect v4 patterns, AGENTS.md style).
- Do not run repo-wide builds, typechecks, or tests — the master integrates and tests. A quick targeted check of your own code is allowed.
- Do not wait for, check on, or communicate with other workers.
- When done, reply with: files changed, what was implemented, what was left undone or uncertain.

## Owned files (create; touch nothing else)
- `packages/server/src/runtime/adapters/opencode-chat.ts` (new)
- `packages/server/src/runtime/adapters/opencode-chat.test.ts` (new)

## Context
ChatRelay's custom ChatGPT transport was already deleted. Your job: the thinnest
typed service that lets block runtime adapters use OpenCode-NATIVE auth,
sessions, prompts, messages/parts, abort, and permissions. OAuth credential
handling stays entirely inside native provider/auth code — never reimplement it,
and never call `chatgpt.com/backend-api/*`.

A previous migration already built the session-binding service you should REUSE
(not duplicate): `packages/core/src/workspace/chat-relay-session.ts` (get/ensure/
reset for block→session bindings) exposed through
`packages/server/src/handlers/chat-relay-session.ts` +
`chat-relay-session-access.ts`.

## Inspect first (read-only)
- `packages/core/src/workspace/chat-relay-session.ts` + the two handlers above.
- `packages/core/src/session/*` — native session create/list/prompt/abort APIs
  (V2 session core: prompt admission vs steer/queue semantics).
- `packages/core/src/permission/*` — permission request/respond services.
- `packages/core/src/credential/*` and `packages/core/src/oauth/*` — provider
  auth state (how the TUI knows a provider is logged in).
- `packages/opencode/src/plugin/openai/codex.ts` — the canonical ChatGPT/Codex
  OAuth flow (client id, device endpoints, PKCE). READ ONLY — do not copy its
  transport; it documents which native path handles ChatGPT-subscription OAuth
  and that it routes to the Codex Responses backend.

## Pinned command contract (map THESE to native calls)

```ts
export type ChatRelayCommand =
  | { type: "auth.start"; providerID: string }
  | { type: "session.create"; modelID?: string; agentID?: string }
  | { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
  | { type: "session.abort" }
  | { type: "permission.respond"; requestID: string; response: "allow-once" | "allow-always" | "deny" }
```

Also produce these resource shapes (same fields as pinned in tasks/A.md — keep
EXACT): `AuthRuntimeState` (providerID, status missing|awaiting-login|ready|
error, loginURL?, userCode?, error?), `SessionRuntimeState` (id, status
idle|busy, directory?, modelID?, agentID?, error?), `MessageRuntimeState` (id,
sessionID, role user|assistant, timeCreated?, important?),
`MessagePartRuntimeState` (id, messageID, kind text|tool|reasoning|permission,
text?, state?, error?), `PermissionRuntimeState` (id, requestID, sessionID,
status pending|resolved, response?).

## What to implement

1. `OpencodeChatAdapter` service exposing (Effect-style, Layer-friendly — mirror
   the service/context pattern of `packages/core/src/workspace/chat-relay-session.ts`):
   - `authStart(providerID)` → device-flow details (loginURL/userCode) via the
     NATIVE auth service; `authStatus(providerID)` → `AuthRuntimeState`.
   - `sessionCreate(opts)` / `sessionEnsure(blockID, workspaceID)` (delegate to
     the existing chat-relay-session service) / `sessionGet(sessionID)` /
     `sessionList()` → `SessionRuntimeState`.
   - `prompt(sessionID, { text, delivery })` → native session prompt; map
     `delivery: "steer" | "queue"` to the native prompt/steer/queue semantics
     (inspect how the session surface sends messages today — see
     `packages/app/src/pages/canvas/session-surface.tsx` READ ONLY for intent,
     and the server-side session prompt API).
   - `abort(sessionID)` → native abort.
   - `permissionRespond(requestID, response)` → native permission response
     (allow-once / allow-always / deny mapping).
   - `messages(sessionID)` / `parts(messageID)` → the pinned state shapes,
     WITHOUT flattening everything into one final assistant string — preserve
     tool calls, permissions, retry state, and errors as first-class fields.
2. Map native session/message entities into the pinned resource shapes. Prefer
   referencing existing entities by ID; do not duplicate persistence.
3. Compatibility helper: for a ChatRelay block with no `sessionID`, create/
   ensure a session on first use and return the new binding (sessionID +
   revision) so the canvas layer can persist it as a descriptor binding update.
4. CyberMaster-specific behaviors — the `important` message toggle and
   `operating-context.jsonl` forwarding — are OUT of scope here. Add a short
   header comment documenting that they remain CyberMaster metadata/actions and
   must not be pushed into the core session schema.
5. `opencode-chat.test.ts` — pure mapping tests with fakes: command→native-call
   mapping, state-shape mapping preserves tool/permission/error info, missing
   binding triggers session creation and returns the binding, no legacy
   endpoints referenced (grep-level assertion is fine to note).

## Do not touch
- `packages/core/**` (READ only), `packages/relay/**`, protocol, app packages.
- Central registrations (`packages/server/src/routes.ts` etc.) — master wires.

## Acceptance
- The service compiles in `packages/server`; all native capabilities are reused,
  none reimplemented.
- No custom ChatGPT SSE parser; provider OAuth URLs/token refresh live only in
  native provider/auth code.
- Report: files changed, implemented, uncertain (esp. any native capability you
  found missing and had to bridge).
