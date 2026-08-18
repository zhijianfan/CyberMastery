# ChatRelay — Parallel Implementation Plan

Status: executing
Companion: [architecture.md](./architecture.md), [oauth.md](./oauth.md)
Repository package: `packages/relay` (auto-included by root `packages/*` workspaces)

## 1. Contract freeze (Phase 0 — done before any track starts)

| Contract | Shape |
|---|---|
| Inbox | `devplan/relay/inbox/*.md` — transcript files |
| Transcript frontmatter | `source, conversationId, turn, capturedAt, complete` |
| Output doc kinds | `requirements \| architecture \| plan \| notes` |
| Output location | `devplan/<domain>/<kind>.md` with provenance frontmatter |
| Ledger | `devplan/relay/index.jsonl` — message hash → files |
| Archive | `devplan/relay/archive/` for processed transcripts |
| Allowlist | writes limited to `.md`, `.txt`, `.json`, `.jsonl` |
| Credentials | `<data>/chat-relay/<provider>/credentials.json` — OAuth tokens only |

## 2. Tracks

```
Track A — core (file-only, zero deps)      Track B — provider (account auth)
  ingest/split/classify/organize/ledger      oauth device flow · credentials
  + bun:test unit tests                       store · ChatGPT API capture
                    \                        · relay state machine
                     Track C — CLI (execute layer)
                      relay login|chat|ingest|organize|status
```

- **Track A** is the ChatRelay block implementation — no network, no subprocess.
  Enforced by review.
- **Track B** implements `oauth.md`: authenticates the platform account with
  opencode's built-in ChatGPT/Codex OAuth app (device flow) and captures
  replies from the ChatGPT backend-api SSE stream. No browser automation.
- **Track C** wires A+B behind a CLI; `login` (device flow) and `chat`
  (account API) first, manual import (`ingest`) as the fallback.

## 3. Gates

1. **G1 — purity**: Track A contains no `child_process`, no `fetch`, no
   provider imports. (review + grep)
2. **G2 — contract**: B writes only its provider-namespaced data directory and
   `devplan/relay/inbox/*.md`; A/C honor the extension allowlist and path
   containment.
3. **G3 — tests**: `bun test` green in `packages/relay` (run where bun exists;
   this environment has no bun — see note).
4. **G4 — manual smoke**: `relay login` completes the device flow against a
   real ChatGPT account, then `relay chat` produces the three docs with
   frontmatter.

## 4. Non-goals

- Providers beyond ChatGPT in this pass (`ChatProvider` is the interface;
  Claude and others plug in later).
- Coherence pass / plan executor automation (existing subagent workflow).
- git operations from within the relay package.

## 5. Environment note

`bun`/`tsgo` are not available in this shell; code is pattern-verified by
review. First CI run with bun must regenerate `bun.lock` after this package
lands (`@playwright/test` was removed as a dependency, so the lockfile delta is
a removal). Hand-mirrored generated SDK type updates
(`packages/client/src/generated/types.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`)
must be confirmed by `bun run generate` from `packages/client` before release.
