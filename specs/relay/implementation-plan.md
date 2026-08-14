# Relay System — Parallel Implementation Plan

Status: executing
Companion: [architecture.md](./architecture.md), [crawler.md](./crawler.md)
Repository package: `packages/relay` (auto-included by root `packages/*` workspaces)

## 1. Contract freeze (Phase 0 — done before any track starts)

| Contract | Shape |
|---|---|
| Inbox | `specs/relay/inbox/*.md` — transcript files |
| Transcript frontmatter | `source, conversationId, turn, capturedAt, complete` |
| Output doc kinds | `requirements \| architecture \| plan \| notes` |
| Output location | `specs/<domain>/<kind>.md` with provenance frontmatter |
| Ledger | `specs/relay/index.jsonl` — message hash → files |
| Archive | `specs/relay/archive/` for processed transcripts |
| Allowlist | writes limited to `.md`, `.txt`, `.json`, `.jsonl` |

## 2. Tracks

```
Track A — core (file-only, zero deps)      Track B — crawler (execute-capable)
  ingest/split/classify/organize/ledger      browser profile · human input · capture
  + bun:test unit tests                       · hygiene · challenge abort · run plan
                    \                        /
                     Track C — CLI (execute layer)
                      relay ingest|organize|crawl|status
```

- **Track A** is the relay block implementation — no network, no subprocess,
  no playwright imports. Enforced by review.
- **Track B** implements `crawler.md`; imports `@playwright/test` (catalog
  dep) only. Its sole file writes are inbox transcripts.
- **Track C** wires A+B behind a CLI; API-first, crawl second, manual import
  third.

## 3. Gates

1. **G1 — purity**: Track A contains no `playwright`, no `child_process`,
   no `fetch`. (review + grep)
2. **G2 — contract**: B writes only `specs/relay/inbox/*.md`; A/C honor the
   extension allowlist and path containment.
3. **G3 — tests**: `bun test` green in `packages/relay` (run where bun exists;
   this environment has no bun — see note).
4. **G4 — manual smoke**: `relay ingest` on a fixture transcript produces the
   three docs with frontmatter.

## 4. Non-goals

- Live provider calls in this pass (adapters are interface + fixtures only
  until a real session is available).
- Coherence pass / plan executor automation (existing subagent workflow).
- git operations from within the relay package.

## 5. Environment note

`bun`/`tsgo` are not available in this shell; code is pattern-verified by
review. First CI run with bun must regenerate `bun.lock` after this package
lands (no new external deps are added, so the lockfile delta is minimal).
