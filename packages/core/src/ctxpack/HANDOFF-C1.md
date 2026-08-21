# C1 — Core CtxPack service, validation, hashing, search

Base commit: `2d913472a237523696e7f9105a4c08a90b50a843` (feature/CyberMaster)

## Files changed

CREATE (all new, no edits to other lanes):
- `packages/core/src/ctxpack/service.ts` — frozen `CtxPackActor` / `CtxPackEventPort` /
  `WorkspaceCtxPackChangedEvent` / `CtxPackService` / `Service` (`@opencode/v2/CtxPack`),
  `layer` (also exported for tests) and `node` exactly per the frozen spec
  (`deps: [CtxPackRepository.node, CapabilityService.node]`).
- `packages/core/src/ctxpack/validation.ts` — frozen v1 limits, create/patch/list
  validation + normalization, sensitivity rank, budget errors.
- `packages/core/src/ctxpack/hash.ts` — `canonicalizeSource` (recursive key sort) +
  wrappers delegating to S1's `contentHash` / `estimateTokens` / `utf8ByteLength`.
- `packages/core/src/ctxpack/search.ts` — `buildFtsQuery`, `matchFts`, `searchPacks`.
- `packages/core/test/ctxpack-service.test.ts` — 11 tests (9 brief scenarios + 2 extras).
- `packages/core/test/ctxpack-search.test.ts` — 10 tests (all brief scenarios + buildFtsQuery unit).
- `packages/core/src/ctxpack/HANDOFF-C1.md` — this file.

## Tests

- `cd packages/core && bun test --only-failures test/ctxpack-service.test.ts` → 11 pass / 0 fail.
- `cd packages/core && bun test --only-failures test/ctxpack-search.test.ts` → 10 pass / 0 fail.
- Sibling sanity: `test/ctxpack-sql.test.ts` + `test/capability-service.test.ts` → 18 pass / 0 fail.
- Scoped `tsgo --noEmit` over exactly this lane's 6 files (scratch tsconfig, deleted) → 0 errors.
- NOTE: whole-package `tsgo --noEmit` currently reports errors in OTHER lanes'
  in-progress files (`src/ctxpack/materialize.ts`, `test/ctxpack-materialize.test.ts` —
  C2/M3 territory). None originate from this lane.

## Public exports

From `service.ts`: `CtxPackActor`, `WorkspaceCtxPackChangedEvent`,
`CtxPackEventPort` (interface), `CtxPackEventPortService` (Context tag,
`@opencode/v2/CtxPackEventPort`), `recordingEventPort(events?)` (default + test
factory, returns `CtxPackEventPort & { events }`), `CtxPackService`, `Service`,
`layer`, `node`.
From `validation.ts`: `LIMITS`, `SENSITIVITY_RANK`, `codePointLength`,
`validateTitle`, `validateCreate`, `validatePatch`, `validateListRequest`,
`NormalizedCreate`, `NormalizedPatch`.
From `hash.ts`: `canonicalizeSource`, `contentHash`, `estimateTokens`,
`utf8ByteLength`, `HashFragment`.
From `search.ts`: `buildFtsQuery(query): string | null`, `matchFts(db,
workspaceID, query): Effect<CtxPack.ID[]>`, `searchPacks(repository, input):
Effect<CtxPackListResult, CtxPackError>`, `SearchPacksInput`.

Service behaviors (as briefed): create validates → normalizes (trimmed title,
NFKC keywords deduped case-insensitively on the normalized form, fragment text
via `normalizeSelectedText`) → repo.create (server-assigned ordinals in request
order, `createdByUserID = actor.userID`, `now = Date.now()`) → publish
`created` AFTER commit, publish failure swallowed-logged (never rolls back).
Idempotent replay returns the original and emits NO second event. get: fetch
first (includeDeleted=true) → capability `ctxpack.read` (CtxPack subject) →
re-check deleted. list: `ctxpack.read` (Workspace subject) + limit/query
validation + post-query privacy filter (private packs of other users dropped;
`totalEstimate` reduced by the number dropped). patch: workspace match →
fetch → `ctxpack.patch` → deleted check → validate (same limits, sensitivity
must be >= strictest fragment source) → repo.patchMetadata → `metadata-updated`.
remove: fetch → `ctxpack.remove` → repo.softDelete → `deleted`. restore: fetch
→ `ctxpack.restore` → repo.restore → `restored` ONLY if the pack was actually
deleted (restoring a live pack is a repo no-op, no event).

## Central integration actions (list, do NOT do)

- M1: add `CtxPack.node` to the core LayerNode group composition.
- M1: wire the production `CtxPackEventPort` (C2 lane) into this layer by
  providing `CtxPackEventPortService` in the node graph (replace the default
  `recordingEventPort()`). The layer reads the port via
  `Context.getOption(Effect.context(), CtxPackEventPortService)` at build time,
  so providing the tag anywhere in the compiled graph is sufficient.
- P1: handlers import `Service`/`node` from `@opencode-ai/core/ctxpack/service`
  and `searchPacks`/`buildFtsQuery` from `@opencode-ai/core/ctxpack/search`.
- M1: note that `CtxPackEventPort` events use the frozen `{ type,
  properties: { workspaceID, ctxPackID, revision, change } }` envelope; S1's
  event-bus `CtxPackChanged` (`Event.define`) uses `data` instead of
  `properties` — the production port (C2) is responsible for adapting one to
  the other.

## Assumptions

- `layer` is exported in addition to the frozen `Service`/`node` so tests can
  compose it with a real repository and fake capability/port layers (same
  idiom as capability and sql lanes).
- The event envelope is exactly `{ type: "workspace.ctxpack.changed",
  properties: { workspaceID, ctxPackID, revision, change } }` per the frozen
  brief; `change` is the union `created | metadata-updated | deleted |
  restored | used` (only the first four are emitted by this service).
- Idempotent create is enforced by an in-process ledger
  `(workspaceID, userID, idempotencyKey) -> ctxPackID` (bounded at 10k keys,
  FIFO eviction). The repo alone cannot distinguish a fresh insert from a
  replay (both return the same `Info`), so the ledger is what guarantees one
  `created` event per key. Sequential replays are exact; a concurrent
  same-key create race could double-publish (the repo's unique index still
  guarantees a single row) — acceptable for the v1 single-user local DB, same
  rigor as S1's select-then-insert.
- Privacy filtering for list is post-query because `CtxPack.Summary` carries
  no `createdByUserID` and S1's repo `list` input is frozen without a
  `viewerUserID`. The service re-fetches each listed `private` item via
  `repo.get` (workspace-scoped) to learn the owner, drops other users' packs,
  and subtracts the dropped count from `totalEstimate`. A pack that vanishes
  between list and get is kept (list snapshot wins).
- `searchPacks` enforces the frozen input limits (limit 1–50, query ≤ 256 code
  points) itself so search callers cannot bypass service-level validation.
- `buildFtsQuery` drops tokens containing no letters/digits/underscore
  (unicode61 token chars). This is a hardening beyond the frozen quoting rule:
  punctuation-only phrases are FTS5 syntax hazards (e.g. a lone `"`) even when
  quoted, and the frozen spec requires punctuation-heavy queries to not throw.
- Keyword dedupe is case-insensitive on the normalized (NFKC, whitespace-
  collapsed) form; the first occurrence's normalized form is kept. The count
  limit (12) applies AFTER dedupe.
- The capability error is remapped from X0's `CtxPackPermissionDeniedError`
  class to the S1 union member `{ _tag: "CtxPackPermissionDenied", operation }`.
- `matchFts`/storage failures surface as defects (`Effect.orDie`), mirroring
  S1's `toDomainError` idiom; only domain errors fail the effect.

## Known limitations

- In-process idempotency ledger: not durable across restarts and not
  cross-process; a replay after restart publishes a second `created` event
  (repo still returns the original pack). M1/C2 may move idempotency tracking
  into the production port or repository.
- Post-query privacy filtering costs up to `limit` extra `repo.get` calls when
  a page is full of private packs, and `totalEstimate` is only approximately
  corrected (pages not yet consumed still contain hidden rows). An M1
  enhancement: add `viewerUserID` to the repository list predicate.
- `CtxPackEventPort` is declared infallible (`Effect<void>`); a failing port
  must lie about its error channel (the service catches whatever it throws at
  runtime — verified by test 7).
- Default port is an in-memory recording port (frozen default): unbounded
  growth until M1 wires the production port.
- `searchPacks` does not apply the private-pack privacy filter (that is the
  service's list policy); direct searchPacks callers bypass privacy — P1
  should go through the service or apply the same post-query filter.
- List/query validation rejects rather than clamps (frozen: reject).

## Prohibited-pattern scan

`rg -n "console\.(log|debug)|ctxPack|ctx_pack" packages/core/src/workspace
packages/app/src/pages/canvas` — no new matches from this lane; existing hits
are sibling lanes' `ctxpack-browser` files. No logging of content anywhere in
this lane (the only log is the swallowed publish-failure message, IDs only).
No new npm dependencies, no git writes, no generate, no root tests, no edits
to migration/schema/gen files.
