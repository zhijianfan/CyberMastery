import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite, type EffectSQLiteDatabase } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { Deferred, Effect, Layer, Ref, Scope } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type { CtxPackListRequest, CtxPackListResult } from "@opencode-ai/schema/ctxpack"
import { ensureCtxPackFts, make } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import { tmpdir } from "./fixture/tmpdir"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
type Database = EffectSQLiteDatabase & { $client: SqlClient }

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const isIdempotencyLookupQuery = (query: Parameters<Database["get"]>[0]): boolean => {
  const chunks = typeof query === "string" ? [query] : query.getSQL().queryChunks
  const text = chunks
    .map((chunk) =>
      typeof chunk === "string"
        ? chunk
        : typeof chunk === "object" && chunk !== null && "value" in chunk
          ? String(chunk.value)
          : "",
    )
    .join("")
  // Match only the removed legacy pre-read; the current conflict-loser re-read selects the full row.
  return text.includes("SELECT id FROM ctx_pack") && text.includes("create_idempotency_key")
}

const instrumentDbForConcurrentLegacyIdempotentRace = (
  db: Database,
  started: Ref.Ref<number>,
  bothPreselects: Deferred.Deferred<void>,
) => {
    const wrap = <T extends Pick<Database, "get" | "transaction">>(target: T) => {
      const get: Database["get"] = <A = unknown>(query: Parameters<Database["get"]>[0]) => {
        const effect = target.get<A>(query)
        if (!isIdempotencyLookupQuery(query)) return effect
        return new Proxy(effect, {
          get(effect, property, receiver) {
            if (property !== "execute") return Reflect.get(effect, property, receiver)
            return () =>
              Effect.gen(function* () {
                const count = yield* Ref.updateAndGet(started, (value) => value + 1)
                const row = yield* effect.execute()
                if (count === 1) yield* Deferred.await(bothPreselects).pipe(Effect.timeout("1 second"))
                if (count === 2) yield* Deferred.succeed(bothPreselects, undefined)
                return row
              })
          },
        })
      }
      const transaction: Database["transaction"] = (callback, config) =>
        target.transaction((tx) => callback(wrap(tx)), config)
      return new Proxy(target, {
        get(target, property, receiver) {
          if (property === "get") return get
          if (property === "transaction") return transaction
          return Reflect.get(target, property, receiver)
        },
      })
    }

    return wrap(db)
  }

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    // Fresh databases bootstrap from the generated full schema. Until the
    // generated schema is regenerated, apply the ctxpack migration manually.
    const existing = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
    )
    if (!existing) {
      yield* db.transaction((tx) => ctxPackMigration.up(tx))
    }
    // M1: fresh databases skip the handwritten migration (the generated full
    // schema now creates ctx_pack*), so the FTS virtual table is ensured lazily.
    yield* ensureCtxPackFts(db)
    return { db, repository: make(db) }
  })

// Maps a domain failure to a plain tagged result for assertions.
const outcome = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.catch(
    Effect.map(effect, (value) => ({ ok: true as const, value })),
    (error) => Effect.succeed({ ok: false as const, error }),
  )

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

const fragment = (index: number, overrides: Partial<CtxPack.Source> = {}) => ({
  clientFragmentID: `frag-${index}`,
  text: `Fragment ${index} text about the post-pressure stage.`,
  source: source(overrides),
})

const createPack = (repository: CtxPackRepository, overrides: Partial<CtxPackRepository.Create> = {}) =>
  repository.create({
    workspaceID: "ws-1",
    createdByUserID: "user-1",
    title: "Niagara pump findings",
    keywords: ["Niagara", "pump"],
    sensitivity: "workspace",
    fragments: [fragment(0)],
    idempotencyKey: "create-1",
    now: 1787300020000,
    ...overrides,
  })

const listRequest = (overrides: Partial<CtxPackListRequest> = {}): CtxPackListRequest => ({
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

describe("CtxPack repository", () => {
  test("create/get round trip preserves two fragments and their ordinals", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* repository.create({
          workspaceID: "ws-1",
          createdByUserID: "user-1",
          title: "Niagara pump findings",
          keywords: ["Niagara", "pump"],
          sensitivity: "workspace",
          fragments: [
            fragment(0),
            fragment(1, { blockID: "block-2", functionalityID: "builtin:search", kind: "search" }),
          ],
          idempotencyKey: "create-1",
          now: 1787300020000,
        })

        expect(created.id.startsWith("ctxpk_")).toBe(true)
        expect(created.revision).toBe(1)
        expect(created.contentHash.startsWith("sha256:")).toBe(true)
        expect(created.byteLength).toBeGreaterThan(0)
        expect(created.estimatedTokens).toBeGreaterThan(0)
        expect(created.usage).toEqual({ attachedCount: 0, lastAttachedAt: null })
        expect(created.fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1])
        expect(created.fragments.map((fragment) => fragment.source.blockID)).toEqual(["block-1", "block-2"])
        // clientFragmentID is a create-time input; read results carry the server id.
        expect(created.fragments.every((fragment) => fragment.clientFragmentID === fragment.id)).toBe(true)

        const fetched = yield* repository.get("ws-1", created.id, false)
        expect(fetched).toEqual(created)
        expect(fetched.fragments[1]!.source.kind).toBe("search")

        // FTS finds the pack by fragment content and by title keywords.
        const byContent = yield* repository.list(listRequest({ query: "pressure" }))
        expect(byContent.items.map((item) => item.id)).toEqual([created.id])
        const byTitle = yield* repository.list(listRequest({ query: "pump" }))
        expect(byTitle.items.map((item) => item.id)).toEqual([created.id])
        const byNothing = yield* repository.list(listRequest({ query: "nonexistentterm" }))
        expect(byNothing.items).toHaveLength(0)
      }),
    )
  })

  test("create is idempotent per (workspace, user, idempotency key)", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const first = yield* createPack(repository)
        const second = yield* createPack(repository)

        expect(second.id).toBe(first.id)
        const count = yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack`)
        expect(count!.count).toBe(1)
      }),
    )
  })

  test("the concurrency wrapper preserves transaction boundaries", async () => {
    await run(
      Effect.gen(function* () {
        const { db: target } = yield* setup()
        const started = yield* Ref.make(0)
        const bothPreselects = yield* Deferred.make<void>()
        const db = instrumentDbForConcurrentLegacyIdempotentRace(target, started, bothPreselects)
        yield* db.run(sql`CREATE TABLE transaction_boundary_probe (value INTEGER NOT NULL)`)
        yield* db
          .transaction((tx) =>
            tx.run(sql`INSERT INTO transaction_boundary_probe (value) VALUES (1)`).pipe(Effect.andThen(Effect.fail("rollback"))),
          )
          .pipe(Effect.flip)

        const row = yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM transaction_boundary_probe`)
        expect(row!.count).toBe(0)
      }),
    )
  })

  test("concurrent creates for same (workspace, user, idempotency key) return one pack and create no duplicates", async () => {
    await using tmp = await tmpdir()
    const filename = join(tmp.path, `opencode-ctxpack-${crypto.randomUUID()}.sqlite`)
    await Effect.runPromise(
      Effect.scoped(
        Effect.acquireUseRelease(
          Scope.make(),
          (firstScope) =>
            Effect.gen(function* () {
            const firstContext = yield* Layer.buildWithScope(SqliteClient.layer({ filename }), firstScope)
              return yield* Effect.acquireUseRelease(
                Scope.make(),
                (secondScope) =>
                  Effect.gen(function* () {
                    const secondContext = yield* Layer.buildWithScope(SqliteClient.layer({ filename }), secondScope)
                    const first = yield* setup().pipe(Effect.provide(firstContext))
                    const second = yield* makeDb.pipe(Effect.provide(secondContext))
                    const started = yield* Ref.make(0)
                    const bothPreselects = yield* Deferred.make<void>()
                    const firstDb = instrumentDbForConcurrentLegacyIdempotentRace(first.db, started, bothPreselects)
                    const secondDb = instrumentDbForConcurrentLegacyIdempotentRace(second, started, bothPreselects)
                    const creates = [createPack(make(firstDb)), createPack(make(secondDb))]
                    const created = yield* Effect.all(creates, { concurrency: "unbounded" }).pipe(Effect.timeout("5 seconds"))

                    expect(created).toHaveLength(creates.length)
                    expect(new Set(created.map((pack) => pack.id)).size).toBe(1)
                    const [pack] = created
                    const packCount = yield* firstDb.get<{ count: number }>(
                      sql`SELECT COUNT(*) AS count FROM ctx_pack WHERE workspace_id = "ws-1" AND created_by_user_id = "user-1" AND create_idempotency_key = "create-1"`,
                    )
                    expect(packCount!.count).toBe(1)
                    const fragmentCount = yield* firstDb.get<{ count: number }>(
                      sql`SELECT COUNT(*) AS count FROM ctx_pack_fragment WHERE ctx_pack_id = ${pack.id}`,
                    )
                    expect(fragmentCount!.count).toBe(1)
                    const keywordCount = yield* firstDb.get<{ count: number }>(
                      sql`SELECT COUNT(*) AS count FROM ctx_pack_keyword WHERE ctx_pack_id = ${pack.id}`,
                    )
                    expect(keywordCount!.count).toBe(2)
                    const ftsCount = yield* firstDb.get<{ count: number }>(
                      sql`SELECT COUNT(*) AS count FROM ctx_pack_fts WHERE ctx_pack_id = ${pack.id}`,
                    )
                    expect(ftsCount!.count).toBe(1)
                  }),
                (secondScope, exit) => Scope.close(secondScope, exit),
              )
            }),
          (firstScope, exit) => Scope.close(firstScope, exit),
        ),
      ),
    )
  })

  test("the same idempotency key in a different workspace does not collide", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const first = yield* createPack(repository)
        const second = yield* createPack(repository, { workspaceID: "ws-2" })

        expect(second.id).not.toBe(first.id)
        expect(second.workspaceID).toBe("ws-2")
      }),
    )
  })

  test("patchMetadata increments revision and preserves contentHash and fragments", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository)
        const patched = yield* repository.patchMetadata({
          workspaceID: "ws-1",
          ctxPackID: created.id,
          expectedRevision: 1,
          patch: { title: "Updated title", keywords: ["new", "keywords"] },
          now: 1787300030000,
        })

        expect(patched.revision).toBe(2)
        expect(patched.title).toBe("Updated title")
        expect(patched.keywords).toEqual(["new", "keywords"])
        expect(patched.contentHash).toBe(created.contentHash)
        expect(patched.fragments).toEqual(created.fragments)
      }),
    )
  })

  test("patchMetadata with a stale expectedRevision fails with CtxPackRevisionConflict", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository)
        const result = yield* outcome(
          repository.patchMetadata({
            workspaceID: "ws-1",
            ctxPackID: created.id,
            expectedRevision: 99,
            patch: { title: "Stale" },
            now: 1787300030000,
          }),
        )

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackRevisionConflict", currentRevision: 1 })
      }),
    )
  })

  test("softDelete hides the pack, removes the FTS row, and get fails with CtxPackDeleted", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const created = yield* createPack(repository)

        expect(
          yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack_fts WHERE ctx_pack_fts MATCH 'niagara'`),
        ).toEqual({ count: 1 })

        const deleted = yield* repository.softDelete("ws-1", created.id, 1)
        expect(deleted.deletedAt).not.toBeNull()

        const listed = yield* repository.list(listRequest())
        expect(listed.items).toHaveLength(0)

        expect(
          yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack_fts WHERE ctx_pack_fts MATCH 'niagara'`),
        ).toEqual({ count: 0 })

        const result = yield* outcome(repository.get("ws-1", created.id, false))
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toEqual({ _tag: "CtxPackDeleted", ctxPackID: created.id })
      }),
    )
  })

  test("restore clears the deletion and recreates the FTS row", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const created = yield* createPack(repository)
        yield* repository.softDelete("ws-1", created.id, 1)

        const restored = yield* repository.restore("ws-1", created.id, 1)
        expect(restored.deletedAt).toBeNull()
        expect(restored.revision).toBe(1)

        expect(
          yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM ctx_pack_fts WHERE ctx_pack_fts MATCH 'niagara'`),
        ).toEqual({ count: 1 })
        const fetched = yield* repository.get("ws-1", created.id, false)
        expect(fetched.id).toBe(created.id)
      }),
    )
  })

  test("recordUse increments attached_count and keeps the maximum last_attached_at", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository)

        yield* repository.recordUse("ws-1", created.id, 1787300040000)
        const used = yield* repository.get("ws-1", created.id, false)
        expect(used.usage).toEqual({ attachedCount: 1, lastAttachedAt: 1787300040000 })

        // An earlier use increments the count but does not move the timestamp back.
        yield* repository.recordUse("ws-1", created.id, 1787300030000)
        const usedAgain = yield* repository.get("ws-1", created.id, false)
        expect(usedAgain.usage).toEqual({ attachedCount: 2, lastAttachedAt: 1787300040000 })
      }),
    )
  })

  test("list paginates with an opaque cursor over rows sharing a sort value", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const ids: CtxPack.ID[] = []
        for (let index = 0; index < 5; index++) {
          const created = yield* createPack(repository, {
            title: `Pack ${index}`,
            idempotencyKey: `create-${index}`,
            now: 1787300020000,
          })
          ids.push(created.id)
        }

        // Same time_created for all rows; tie-break is id DESC = reverse creation order.
        let cursor: string | null = null
        let pages = 0
        const collected: string[] = []
        for (;;) {
          const page: CtxPackListResult = yield* repository.list(listRequest({ sort: "created-desc", cursor, limit: 2 }))
          pages++
          collected.push(...page.items.map((item) => item.id))
          if (pages === 1) expect(page.totalEstimate).toBe(5)
          cursor = page.nextCursor
          if (cursor === null) break
        }

        expect(pages).toBe(3)
        expect(collected).toHaveLength(5)
        expect(new Set(collected).size).toBe(5)
        expect(collected).toEqual([...ids].reverse())
      }),
    )
  })

  test("list with includeDeleted=true returns the deleted row", async () => {
    await run(
      Effect.gen(function* () {
        const { repository } = yield* setup()
        const created = yield* createPack(repository)
        yield* repository.softDelete("ws-1", created.id, 1)

        const listed = yield* repository.list(listRequest({ includeDeleted: true }))
        expect(listed.items).toHaveLength(1)
        expect(listed.items[0]!.id).toBe(created.id)
        expect(listed.items[0]!.deletedAt).not.toBeNull()
        expect(listed.totalEstimate).toBe(1)
      }),
    )
  })
})
