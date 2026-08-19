# chat-relay-migration

Assignment: migrate ChatRelay from the custom ChatGPT transport/OAuth/session stack
(specs/relay/chat-relay-session-migration.md) to a thin block → OpenCode Session binding,
mirroring the builtin:master-agent implementation.

Decisions (master): model NOT pinned at session creation (session default; user picks the
codex model in the surface — CodexAuthPlugin handles auth). Payload endpoints DROPPED.
OperatingAgent forwarding = follow-up (documented, not implemented).

| # | task | source | worker | files (owned) | acceptance |
|---|---|---|---|---|---|
| 1 | backend service + protocol + handler + wiring | tasks/1.md | 1 | packages/schema/src/chat-relay.ts (new), packages/core/src/workspace/chat-relay-session.ts (new), packages/core/src/location-services.ts, packages/protocol/src/groups/chat-relay.ts (new), packages/protocol/src/groups/relay.ts (delete), packages/server/src/handlers/chat-relay-session.ts (new), packages/server/src/handlers/chat-relay-session-access.ts (new), packages/server/src/handlers/relay.ts (delete), packages/server/src/routes.ts, packages/opencode/src/server/routes/instance/httpapi/server.ts, packages/core/src/workspace/chat-relay-payload.ts (delete if unreferenced) | compiles; get/ensure/reset mirror master-agent; old relay endpoints gone |
| 2 | SDK hand-mirror | tasks/2.md | 2 | packages/client/src/generated/types.ts, packages/client/src/generated-effect/client.ts, packages/sdk/js/src/v2/gen/types.gen.ts, packages/sdk/js/src/v2/gen/sdk.gen.ts, packages/sdk/openapi.json (only if present) | generated surfaces match the pinned contract in tasks/2.md |
| 3 | frontend ChatRelayBody rewrite | tasks/3.md | 3 | packages/app/src/pages/canvas/workspace.tsx, packages/app/src/pages/canvas/canvas.css | block binds via v2.workspace.chatRelay + CanvasSessionSurface; no custom submit/login UI |
| 4 | delete relay provider stack | tasks/4.md | 4 | packages/relay/src/provider/** (all), packages/relay/package.json, packages/relay/src/index.ts | nothing outside packages/relay imports provider/*; relay package still exports core/cli |
| 5 | specs update | tasks/5.md | 5 | specs/relay/architecture.md, specs/relay/oauth.md, specs/relay/chat-relay-session-migration.md | docs describe session-based ChatRelay |

Worker spawn: `opencode run <tasks/N.md content> --agent parallel-worker --model openai/gpt-5.3-codex-spark`, background, workdir D:\OpencodeDev.
Gate: openai provider must be authorized (`opencode auth list` shows it).
