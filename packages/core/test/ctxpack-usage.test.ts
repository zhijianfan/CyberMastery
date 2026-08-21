import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { CtxPackUsage } from "@opencode-ai/core/ctxpack/usage"
import { CtxPackEvents } from "@opencode-ai/core/ctxpack/events"
import { noop as noopObservability } from "@opencode-ai/core/ctxpack/observability"
import { ensureCtxPackFts, make } from "@opencode-ai/core/ctxpack/sql"
import type { CtxPackRepository } from "@opencode-ai/core/ctxpack/sql"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import usageMigration from "@opencode-ai/core/database/migration/20260821_ctxpack_usage"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
type Db = Effect.Success<typeof makeDb>

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped))

const setup = () =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.apply(db)
    // Fresh databases bootstrap from the generated full schema. Until it is
    // regenerated, apply the lane migrations manually when their tables are
    // absent.
    const hasCtxPack = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
    )
    if (!hasCtxPack) yield* db.transaction((tx) => ctxPackMigration.up(tx))
    // M1: ensure the FTS virtual table (fresh DBs skip the handwritten migration).
    yield* ensureCtxPackFts(db)
    const hasAdmission = yield* db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack_usage_admission'`,
    )
    if (!hasAdmission) yield* db.transaction((tx) => usageMigration.up(tx))
    return { db, repository: make(db) }
  })

const fakePublisher = () => {
  const published: CtxPackEvents.CtxPackChangedEvent[] = []
  const publisher: CtxPackEvents.CtxPackEventPublisher = {
    publish: (event) =>
      Effect.sync(() => {
        published.push(event)
      }),
  }
  return { published, publisher }
}

// A publisher that fails every publish — used to prove publish failures do
// not roll back the durable ledger/count.
const throwingPublisher = (): CtxPackEvents.CtxPackEventPublisher => ({
  publish: () => Effect.die("publish failed"),
})

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

const fragment = (index: number) => ({
  clientFragmentID: `frag-${index}`,
  text: `Fragment ${index} text about the post-pressure stage.`,
  source: source(),
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

const admissionRows = (db: Db) =>
  db.all<{ ctx_pack_id: string; session_input_id: string }>(
    sql`SELECT ctx_pack_id, session_input_id FROM ctx_pack_usage_admission ORDER BY ctx_pack_id`,
  )

describe("CtxPack usage accounting", () => {
  test("same sessionInputID + same pack counts once and emits one used event", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const { published, publisher } = fakePublisher()
        const usage = CtxPackUsage.make({ db, repository, publisher, observability: noopObservability })
        const created = yield* createPack(repository)

        const input = {
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [created.id],
          sessionInputID: "input-1",
          admittedAt: 1787300100000,
        }
        yield* usage.recordAdmittedUse(input)
        yield* usage.recordAdmittedUse(input)

        const after = yield* repository.get("ws-1", created.id, false)
        expect(after.usage.attachedCount).toBe(1)
        expect(after.usage.lastAttachedAt).toBe(1787300100000)
        expect(yield* admissionRows(db)).toHaveLength(1)
        expect(published).toHaveLength(1)
        expect(published[0]!.properties).toEqual({
          workspaceID: "ws-1",
          ctxPackID: created.id,
          revision: 1,
          change: "used",
        })
      }),
    )
  })

  test("a new sessionInputID increments the count again", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const { published, publisher } = fakePublisher()
        const usage = CtxPackUsage.make({ db, repository, publisher, observability: noopObservability })
        const created = yield* createPack(repository)

        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [created.id],
          sessionInputID: "input-1",
          admittedAt: 1787300100000,
        })
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [created.id],
          sessionInputID: "input-2",
          admittedAt: 1787300110000,
        })

        const after = yield* repository.get("ws-1", created.id, false)
        expect(after.usage.attachedCount).toBe(2)
        expect(after.usage.lastAttachedAt).toBe(1787300110000)
        expect(yield* admissionRows(db)).toHaveLength(2)
        expect(published).toHaveLength(2)
        expect(published.every((event) => event.properties.change === "used")).toBe(true)
      }),
    )
  })

  test("two packs in one input are both counted with distinct events", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const { published, publisher } = fakePublisher()
        const usage = CtxPackUsage.make({ db, repository, publisher, observability: noopObservability })
        const packA = yield* createPack(repository, { idempotencyKey: "create-a", title: "Pack A" })
        const packB = yield* createPack(repository, { idempotencyKey: "create-b", title: "Pack B" })

        // A duplicate id inside the same input must be deduped (DISTINCT).
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [packA.id, packA.id, packB.id],
          sessionInputID: "input-1",
          admittedAt: 1787300100000,
        })

        expect((yield* repository.get("ws-1", packA.id, false)).usage.attachedCount).toBe(1)
        expect((yield* repository.get("ws-1", packB.id, false)).usage.attachedCount).toBe(1)
        expect(yield* admissionRows(db)).toHaveLength(2)
        expect(published).toHaveLength(2)
        expect(new Set(published.map((event) => event.properties.ctxPackID))).toEqual(new Set([packA.id, packB.id]))
        expect(published.map((event) => event.properties.change)).toEqual(["used", "used"])
      }),
    )
  })

  test("event publish failure does not roll back the ledger or the count", async () => {
    await run(
      Effect.gen(function* () {
        const { db, repository } = yield* setup()
        const usage = CtxPackUsage.make({
          db,
          repository,
          publisher: throwingPublisher(),
          observability: noopObservability,
        })
        const created = yield* createPack(repository)

        // Must complete despite the throwing publisher.
        yield* usage.recordAdmittedUse({
          workspaceID: "ws-1",
          userID: "user-1",
          ctxPackIDs: [created.id],
          sessionInputID: "input-1",
          admittedAt: 1787300100000,
        })

        const after = yield* repository.get("ws-1", created.id, false)
        expect(after.usage.attachedCount).toBe(1)
        const rows = yield* admissionRows(db)
        expect(rows).toEqual([{ ctx_pack_id: created.id, session_input_id: "input-1" }])
      }),
    )
  })
})
