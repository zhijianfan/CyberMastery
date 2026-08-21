import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackListRequest, CtxPackListResult, CtxPackSort } from "@opencode-ai/schema/ctxpack"
import { ensureCtxPackFts, make } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import { buildFtsQuery, searchPacks } from "@opencode-ai/core/ctxpack/search"
import type { SearchPacksInput } from "@opencode-ai/core/ctxpack/search"

// --- Harness ----------------------------------------------------------------

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    const existing = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
    )
    if (!existing) yield* db.transaction((tx) => ctxPackMigration.up(tx))
    // M1: fresh databases skip the handwritten migration (the generated full
    // schema now creates ctx_pack*), so the FTS virtual table is ensured lazily.
    yield* ensureCtxPackFts(db)
    return { db, repository: make(db) }
  })

const outcome = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.catch(
    Effect.map(effect, (value) => ({ ok: true as const, value })),
    (error) => Effect.succeed({ ok: false as const, error }),
  )

// --- Fixtures ---------------------------------------------------------------

const source = (overrides: Partial<CtxPack.Source> = {}): CtxPack.Source => ({
  workspaceID: "ws-1",
  blockID: "block-1",
  functionalityID: "builtin:chat",
  kind: "message",
  direction: "received",
  sourceTimestamp: 1787300000000,
  capturedAt: 1787300010000,
  entityRef: { type: "message", id: "msg-1" },
  label: "Assistant response",
  metadata: {},
  sensitivity: "workspace",
  ...overrides,
})

const createPack = (repository: CtxPackRepository, overrides: Partial<CtxPackRepository.Create> = {}) =>
  repository.create({
    workspaceID: "ws-1",
    createdByUserID: "user-1",
    title: "Niagara pump findings",
    keywords: [],
    sensitivity: "workspace",
    fragments: [
      {
        clientFragmentID: "frag-0",
        text: "The quick brown fox jumps over the lazy dog.",
        source: source(),
      },
    ],
    idempotencyKey: "create-1",
    now: 1787300020000,
    ...overrides,
  })

const searchInput = (overrides: Partial<SearchPacksInput> = {}): SearchPacksInput => ({
  workspaceID: "ws-1",
  query: "",
  keyword: null,
  sourceBlockID: null,
  sourceFunctionalityID: null,
  sourceKind: null,
  sensitivity: null,
  createdAfter: null,
  createdBefore: null,
  includeDeleted: false,
  sort: "created-desc",
  cursor: null,
  limit: 10,
  ...overrides,
})

// S1's cursor codec: base64url JSON { version: 1, sort, value, id }.
const encodeCursor = (sort: CtxPackSort, value: string | number | null, id: string) =>
  Buffer.from(JSON.stringify({ version: 1, sort, value, id })).toString("base64url")

// --- Tests ------------------------------------------------------------------

describe("buildFtsQuery", () => {
  test("quotes each normalized token, joins with AND, escapes embedded quotes", () => {
    expect(buildFtsQuery("session.input")).toBe('"session.input"')
    expect(buildFtsQuery("pump  failure")).toBe('"pump" "failure"')
    // Embedded double quotes are doubled per the frozen escaping rule:
    // `"hello"` -> `""hello""` inside the phrase -> `"""hello"""`.
    expect(buildFtsQuery('say "hello"')).toBe('"say" """hello"""')
    expect(buildFtsQuery("  ")).toBeNull()
    expect(buildFtsQuery("")).toBeNull()
    expect(buildFtsQuery("...")).toBeNull()
  })
})

describe("CtxPack search", () => {
  test("FTS finds title-only, keyword-only, and fragment-only matches", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const byTitle = yield* createPack(repository, {
          title: "Flamingo habitat report",
          keywords: ["zephyr"],
          idempotencyKey: "s-1",
        })
        const byKeyword = yield* createPack(repository, {
          title: "Weather notes",
          keywords: ["turbine"],
          fragments: [
            {
              clientFragmentID: "frag-0",
              text: "A plain statement about the climate.",
              source: source(),
            },
          ],
          idempotencyKey: "s-2",
        })
        const byFragment = yield* createPack(repository, {
          title: "Equipment log",
          keywords: [],
          fragments: [
            {
              clientFragmentID: "frag-0",
              text: "Hydraulic analysis of the coolant loop.",
              source: source(),
            },
          ],
          idempotencyKey: "s-3",
        })

        expect((yield* searchPacks(repository, searchInput({ query: "flamingo" }))).items.map((item) => item.id)).toEqual([
          byTitle.id,
        ])
        expect((yield* searchPacks(repository, searchInput({ query: "turbine" }))).items.map((item) => item.id)).toEqual([
          byKeyword.id,
        ])
        expect((yield* searchPacks(repository, searchInput({ query: "hydraulic" }))).items.map((item) => item.id)).toEqual([
          byFragment.id,
        ])
      }),
    )
  })

  test("metadata filters intersect with FTS instead of replacing it", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const blockOne = yield* createPack(repository, {
          title: "Loop A",
          fragments: [
            {
              clientFragmentID: "frag-0",
              text: "Hydraulic analysis of the coolant loop.",
              source: source({ blockID: "block-1" }),
            },
          ],
          idempotencyKey: "s-1",
        })
        yield* createPack(repository, {
          title: "Loop B",
          fragments: [
            {
              clientFragmentID: "frag-0",
              text: "Hydraulic analysis of the coolant loop.",
              source: source({ blockID: "block-2" }),
            },
          ],
          idempotencyKey: "s-2",
        })

        const intersection = yield* searchPacks(
          repository,
          searchInput({ query: "hydraulic", sourceBlockID: "block-1" }),
        )
        expect(intersection.items.map((item) => item.id)).toEqual([blockOne.id])

        // The same metadata filter with a non-matching query finds nothing.
        const noMatch = yield* searchPacks(repository, searchInput({ query: "flamingo", sourceBlockID: "block-1" }))
        expect(noMatch.items).toHaveLength(0)
      }),
    )
  })

  test("search never leaks another workspace", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        yield* createPack(repository, { workspaceID: "ws-2", idempotencyKey: "s-1" })

        const result = yield* searchPacks(repository, searchInput({ query: "fox" }))
        expect(result.items).toHaveLength(0)
        expect(result.totalEstimate).toBe(0)
      }),
    )
  })

  test("default excludes deleted; includeDeleted with an empty query returns deleted", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository)
        yield* repository.softDelete("ws-1", created.id, 1)

        const defaultList = yield* searchPacks(repository, searchInput({ query: "fox" }))
        expect(defaultList.items).toHaveLength(0)

        const withDeleted = yield* searchPacks(repository, searchInput({ query: "", includeDeleted: true }))
        expect(withDeleted.items.map((item) => item.id)).toEqual([created.id])
        expect(withDeleted.items[0]!.deletedAt).not.toBeNull()
      }),
    )
  })

  test("every sort stays stable across two pages of rows sharing a sort value", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        // Identical title, content, and timestamps: every sort key is shared,
        // so the id tie-breaker decides all ordering.
        const ids: CtxPack.ID[] = []
        for (let index = 0; index < 5; index++) {
          const created = yield* createPack(repository, {
            title: "Shared Title",
            idempotencyKey: `sort-${index}`,
            now: 1787300020000,
          })
          ids.push(created.id)
        }

        const sorts: CtxPackSort[] = [
          "created-desc",
          "created-asc",
          "updated-desc",
          "title-asc",
          "tokens-desc",
          "most-attached",
          "recently-attached",
        ]
        for (const sort of sorts) {
          const page1 = yield* searchPacks(repository, searchInput({ sort, limit: 2 }))
          const page2 = yield* searchPacks(repository, searchInput({ sort, cursor: page1.nextCursor, limit: 2 }))
          const page3 = yield* searchPacks(repository, searchInput({ sort, cursor: page2.nextCursor, limit: 2 }))

          const collected = [...page1.items, ...page2.items, ...page3.items]
          expect(collected).toHaveLength(5)
          expect(new Set(collected.map((item) => item.id)).size, sort).toBe(5)
        }
      }),
    )
  })

  test("an item inserted after page 1 is not duplicated via the cursor", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const ids: CtxPack.ID[] = []
        for (let index = 0; index < 5; index++) {
          const created = yield* createPack(repository, { idempotencyKey: `page-${index}`, now: 1787300020000 })
          ids.push(created.id)
        }

        const page1 = yield* searchPacks(repository, searchInput({ limit: 2 }))
        expect(page1.items).toHaveLength(2)

        // A newer pack lands at the head of the sort order — before the cursor.
        const newcomer = yield* createPack(repository, { idempotencyKey: "page-new", now: 1787300021000 })

        const page2 = yield* searchPacks(repository, searchInput({ cursor: page1.nextCursor, limit: 2 }))
        const page3 = yield* searchPacks(repository, searchInput({ cursor: page2.nextCursor, limit: 2 }))

        const page2Ids = page2.items.map((item) => item.id)
        const page3Ids = page3.items.map((item) => item.id)
        expect(page2Ids).not.toContain(newcomer.id)
        expect(page3Ids).not.toContain(newcomer.id)

        const all = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id)
        expect(all).toHaveLength(5)
        expect(new Set(all).size).toBe(5)
        expect(all).not.toContain(newcomer.id)
      }),
    )
  })

  test("a punctuation-heavy session.input query does not throw and matches", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository, {
          title: "Session capture",
          fragments: [
            {
              clientFragmentID: "frag-0",
              text: "The session.input field was captured before the tool call.",
              source: source(),
            },
          ],
          idempotencyKey: "s-1",
        })

        const result = yield* searchPacks(repository, searchInput({ query: "session.input" }))
        expect(result.items.map((item) => item.id)).toEqual([created.id])

        // Punctuation-only queries sanitize to nothing and skip MATCH entirely.
        const harmless = yield* searchPacks(repository, searchInput({ query: "..." }))
        expect(harmless.items.map((item) => item.id)).toEqual([created.id])
      }),
    )
  })

  test("malformed cursor and cursor with the wrong sort fail with CtxPackSearchCursorInvalid", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        yield* createPack(repository)

        const malformed = yield* outcome(searchPacks(repository, searchInput({ cursor: "%%%not-a-cursor%%%" })))
        expect(malformed.ok).toBe(false)
        if (!malformed.ok) expect(malformed.error).toEqual({ _tag: "CtxPackSearchCursorInvalid" })

        const wrongSort = yield* outcome(
          searchPacks(
            repository,
            searchInput({ sort: "title-asc", cursor: encodeCursor("created-desc", 1787300020000, "ctxpk_000001") }),
          ),
        )
        expect(wrongSort.ok).toBe(false)
        if (!wrongSort.ok) expect(wrongSort.error).toEqual({ _tag: "CtxPackSearchCursorInvalid" })
      }),
    )
  })

  test("limit validation rejects 0 and 51", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        yield* createPack(repository)

        for (const limit of [0, 51]) {
          const result = yield* outcome(searchPacks(repository, searchInput({ limit })))
          expect(result.ok, `limit ${limit}`).toBe(false)
          if (!result.ok) {
            expect(result.error).toEqual({ _tag: "CtxPackInvalidSelection", reason: "limit must be between 1 and 50" })
          }
        }

        const ok = yield* searchPacks(repository, searchInput({ limit: 1 }))
        expect(ok.items).toHaveLength(1)
      }),
    )
  })
})
