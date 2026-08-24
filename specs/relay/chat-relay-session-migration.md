# ChatRelay → OpenCode Session Migration Status

Goal: complete migration from custom relay transport/OAuth/session logic to a
session-bound `builtin:chat-relay` block.

## Final status

- Migration status: done for architecture and runtime model.
- Remaining item: explicit OperatingAgent session-event forwarding follow-up.
- Active ChatProxy transport status: removed from App, Protocol, and Server.

## Migration target state

`builtin:chat-relay` resolves its `sessionID` binding from the server-owned
FunctionalityInstance using `blockID`; layout and browser storage contain only
descriptor/presentation state. Runtime execution is delegated to `SessionV2` via
`packages/core/src/workspace/chat-relay-session.ts`.

- Auth: `CodexAuthPlugin` (`packages/opencode/src/plugin/openai/codex.ts`)
- Provider endpoint: `https://chatgpt.com/backend-api/codex/responses`
- UI: `ChatRelayBody` renders `CanvasSessionSurface` for composer, stream, auth,
  and message surfaces.

## Tracks

| # | Status | Track | Outcome |
|---|---|---|---|
| T1 | DONE | Backend binding service | `chat-relay-session.ts` mirrors `master-agent` binding lifecycle with `get/ensure/reset` over `/api/workspace/:workspaceID/chat-relay/:blockID(/:ensure|:reset)`, service group `server.workspace.chatRelay`. |
| T2 | DONE | Protocol | ChatRelay now uses `chatRelay.get`, `chatRelay.ensure`, and `chatRelay.reset` in the workspace binding group. The `relay.*` transport API set is deprecated in new architecture. |
| T3 | DONE | Frontend | `ChatRelayBody` now uses session binding state and `CanvasSessionSurface`; relay-specific controls and local state have been removed. |
| T4 | DONE | Stack removal | `packages/relay/src/provider/{chat-relay.ts,chatgpt.ts,oauth.ts,sse.ts}` and relay transport endpoints are removed from active design as replaced by session execution. |
| T5 | PLANNED (follow-up) | OperatingAgent context forwarding | Old `operating-context.jsonl` semantics now map to a session-event consumer (`sessions.events`) outside relay transport. |
| T6 | DONE | Polling/runtime local state | The 5-second status polling loop and block-local runtime message state are removed; binding-driven UI is session-owned. |

## Compatibility retention boundary

The first release containing the active ChatProxy removal deliberately leaves
these dormant data surfaces untouched:

- `ChatRelayPayloadTable` and
  `packages/core/src/workspace/chat-relay-payload.ts` (`list`, `append`, and
  `markImportant`), with no active production caller;
- existing browser profiles below `Global.Path.data/chat-proxy`.

They are retained for one released compatibility window. This migration does
not inspect, export, rewrite, or delete either surface. Export, migration, or
deletion requires a separate explicit change with retention criteria and a
backup/recovery plan; stopping active use is not authorization to destroy the
data.

## Decision points (resolved)

- Model selection: not pinned at creation; use the normal session model selection path.
- `important` payload API: dropped as part of relay transport removal.
- Operating context: forwarding is follow-up through session events, not relay callbacks.
- Functionality registration: `builtin:chat-relay` remains registered in its existing workspace service location.

## Migration rationale

- The former custom relay path pushed Codex tokens to
  `chatgpt.com/backend-api/conversation`, which is not the valid endpoint for
  this auth flow (405 behavior).
- Native session execution routes auth and requests through
  `packages/opencode/src/plugin/openai/codex.ts`, which targets
  `https://chatgpt.com/backend-api/codex/responses`.
