# block-runtime-v3 — Baseline (S0, 2026-08-19)

Recorded by the integration lead BEFORE any parallel work.

## Commands & results

| Check | Command | Result |
|---|---|---|
| Root typecheck | `bun run typecheck` (repo root, absolute bun) | ✅ 31/31 (FULL TURBO cache) |
| Canvas e2e | `cd packages/app && bun test --conditions=browser src/pages/canvas/master-agent.e2e.test.tsx` | ❌ 0 pass / 1 fail — module-load failure: `solid-js/web` resolves to the server build (`Export named 'use' not found in solid-js/web/dist/server.js`) when `server-sdk.tsx` is imported; harness is stale (assigned to Task G) |
| ChatRelay native smoke | `POST /api/workspace/wrk_01408ba3f001mC3z6132yaKC9O/chat-relay/card-1787109583002-gppj8/ensure` then `POST /api/session/<sid>/prompt {"prompt":{"text":"ping"}}` | ✅ ensure → binding + session; prompt → assistant reply (live server :4096) |
| Served embedded UI | `curl http://127.0.0.1:4096/` | bundle `index-CnYtnCKl.js` (rebuilt 17:45 via `embed-web-ui.ts`) |

## localStorage keys currently used

| Key | Content | Disposition |
|---|---|---|
| `opencode-canvas-v1` | camera + blocks incl. `bindings`, `text`, `listening`, `layers`, `history` (violates C1) | D strips to descriptor+transform; view state moves to `opencode.canvas.local-view.v1` |
| `opencode.canvas.workspaceID.v1` | resolved workspace ID (added 2026-08-19) | kept (C9 recovery clears it on typed 404) |

## Known-good rollback baseline

`ensure → FunctionalityInstance CAS → SessionV2 binding → CanvasSessionSurface →
native session prompt APIs → /api/event stream`. Verified live: `ping → pong!`.

## Environment

- Repo: `D:\OpencodeDev`, branch `feature/CyberMaster`, tree UNCOMMITTED at S0 start.
- Worker model: `openai/gpt-5.3-codex-spark`; usage-limit fallback `inferai/deepseek-v4-flash` variant `ultra`.
- Dev server: user's VS Code task on :4096 (never kill; frontend changes only reach the browser after `embed-web-ui.ts` — M-owned in this run).
- Dev DB: `D:\OpencodeDev\.test-data\opencode-test.db`.
