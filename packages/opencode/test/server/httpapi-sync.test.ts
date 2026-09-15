import { afterEach, describe, expect, mock } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionContextEpochTable } from "@opencode-ai/core/session/sql"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { MAX_SYNC_AGGREGATES, SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { canonical, digest } from "../../src/control-plane/session-context-transfer-spool"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalFlagPassword = Flag.OPENCODE_SERVER_PASSWORD
const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
const originalPassword = process.env.OPENCODE_SERVER_PASSWORD
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, Database.node])), httpApiLayer))

function privateSyncHeaders(directory: string) {
  Flag.OPENCODE_SERVER_PASSWORD = "lease-secret"
  return {
    authorization: `Basic ${Buffer.from("opencode:lease-secret").toString("base64")}`,
    "content-type": "application/json",
    "x-opencode-directory": directory,
  }
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  Flag.OPENCODE_SERVER_PASSWORD = originalFlagPassword
  Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
  if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = originalPassword
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  it.instance(
    "rejects an unauthenticated v1 lease when host authorization is unconfigured",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* requestInDirectory(SyncPaths.start, tmp.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            action: "grant",
            workspaceID: "wrk_test",
            topologyRevision: "revision-a",
            expiresAt: Date.now() + 30_000,
            requestToken: "a".repeat(64),
          }),
        })

        expect(response.status).toBe(409)
        expect(yield* response.json).toMatchObject({ code: "version" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "authenticates v1 grant and revoke without returning the request token",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_SERVER_PASSWORD = "lease-secret"
        Flag.OPENCODE_SERVER_PASSWORD = "lease-secret"
        Flag.OPENCODE_WORKSPACE_ID = "wrk_test"
        const tmp = yield* TestInstance
        const handler = HttpRouter.toWebHandler(
          HttpApiApp.routes.pipe(Layer.provide(HttpServer.layerServices)),
          { disableLogger: true },
        ).handler
        const requestToken = "d".repeat(64)
        const payload = {
          version: 1,
          action: "grant",
          workspaceID: "wrk_test",
          topologyRevision: "revision-authenticated",
          expiresAt: Date.now() + 30_000,
          requestToken,
        }
        const send = (body: typeof payload) =>
          Effect.promise(() =>
            handler(
              new Request(`http://localhost${SyncPaths.start}`, {
                method: "POST",
                headers: {
                  authorization: `Basic ${Buffer.from("opencode:lease-secret").toString("base64")}`,
                  "content-type": "application/json",
                  "x-opencode-directory": tmp.directory,
                },
                body: JSON.stringify(body),
              }),
              context,
            ),
          )

        const granted = yield* send(payload)
        const grantBody = (yield* Effect.promise(() => granted.json())) as Record<string, unknown>
        expect({ status: granted.status, body: grantBody }).toMatchObject({ status: 200 })
        expect(grantBody).toMatchObject({
          version: 1,
          acceptedRevision: "revision-authenticated",
          transferRequired: false,
        })
        expect(JSON.stringify(grantBody)).not.toContain(requestToken)

        const revoked = yield* send({ ...payload, action: "revoke" })
        expect(revoked.status).toBe(200)
        expect(yield* Effect.promise(() => revoked.json())).toMatchObject({
          acceptedRevision: "revision-authenticated",
          transferRequired: false,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
    20_000,
  )

  it.instance(
    "refuses legacy start after local private state exists",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const session = yield* Session.use.create({ title: "private-start" })
        const { db } = yield* Database.Service
        yield* db
          .insert(SessionContextEpochTable)
          .values({ session_id: session.id, baseline: "private baseline", snapshot: {}, baseline_seq: 0 })
          .run()
          .pipe(Effect.orDie)

        const response = yield* requestInDirectory(SyncPaths.start, tmp.directory, { method: "POST" })
        expect(response.status).toBe(409)
        expect(yield* response.json).toMatchObject({ code: "version" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "exposes bounded v1 discovery without changing the legacy response",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = privateSyncHeaders(tmp.directory)
        const session = yield* Session.use.create({ title: "sync-v1" })
        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ version: 1, capabilityOnly: false, aggregates: {} }),
        })
        expect(response.status).toBe(200)
        const body = (yield* response.json) as {
          version: 1
          aggregates: Array<{ aggregateID: string; sourceSeq: number }>
          page: { records: unknown[] }
          sourceSnapshotToken: string
        }
        expect(body.version).toBe(1)
        expect(body.aggregates.map((item) => item.aggregateID)).toContain(session.id)
        expect(body.aggregates.length).toBeLessThanOrEqual(MAX_SYNC_AGGREGATES)
        expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(512 * 1024)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects oversized v1 aggregate cursor maps",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers: privateSyncHeaders(tmp.directory),
          body: JSON.stringify({
            version: 1,
            capabilityOnly: false,
            aggregates: Object.fromEntries(
              Array.from({ length: MAX_SYNC_AGGREGATES + 1 }, (_, index) => [
                `session-${index}`,
                { cursor: 0, privateDigest: "sha256:none" },
              ]),
            ),
          }),
        })
        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps legacy history unavailable when the selected session has private state",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = privateSyncHeaders(tmp.directory)
        const session = yield* Session.use.create({ title: "private-sync" })
        const { db } = yield* Database.Service
        yield* db
          .insert(SessionContextEpochTable)
          .values({ session_id: session.id, baseline: "private baseline", snapshot: {}, baseline_seq: 0 })
          .run()
          .pipe(Effect.orDie)

        const legacy = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(legacy.status).toBe(409)

        const discovery = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ version: 1, capabilityOnly: false, aggregates: {} }),
        })
        expect(discovery.status).toBe(200)
        const manifest = (yield* discovery.json) as {
          highWater: Record<string, number>
          aggregates: Array<{ aggregateID: string; privateDigest: string }>
        }
        expect(JSON.stringify(manifest.aggregates)).not.toContain("private baseline")

        const repair = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            capabilityOnly: false,
            aggregates: { [session.id]: { cursor: manifest.highWater[session.id], privateDigest: "sha256:wrong" } },
            repairCursor: session.id,
          }),
        })
        expect(repair.status).toBe(200)
        const body = (yield* repair.json) as {
          sourceSnapshotToken: string
          highWater: Record<string, number>
          manifestDigest: string
          page: { records: Array<{ kind: string }> }
        }
        expect(body.page.records.map((record) => record.kind)).toEqual(["epoch"])

        const begin = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            action: "begin",
            clientTransferID: "private-repair-1",
            directory: tmp.directory,
            sourceSnapshotToken: body.sourceSnapshotToken,
            highWater: body.highWater,
            manifestDigest: body.manifestDigest,
            expiresAt: Date.now() + 60_000,
          }),
        })
        expect(begin.status).toBe(200)
        const started = (yield* begin.json) as { transferHandle: string }
        const append = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            action: "append",
            transferHandle: started.transferHandle,
            pageIndex: 0,
            pageHash: digest(canonical(body.page)),
            page: body.page,
          }),
        })
        expect(append.status).toBe(200)
        const finalized = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            action: "finalize",
            transferHandle: started.transferHandle,
            expectedPageCount: 1,
            manifestDigest: body.manifestDigest,
          }),
        })
        expect(finalized.status).toBe(200)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    10_000,
  )

  it.instance(
    "chunks one oversized canonical record into bounded base64 pages",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = privateSyncHeaders(tmp.directory)
        yield* Session.use.create({ title: "x".repeat(600 * 1024) })
        const first = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ version: 1, capabilityOnly: false, aggregates: {} }),
        })
        expect(first.status).toBe(200)
        const body = (yield* first.json) as {
          sourceSnapshotToken: string
          nextCursor?: string
          page: { records: Array<{ kind: string; data?: string }> }
        }
        expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(512 * 1024)
        expect(body.page.records.length).toBeLessThanOrEqual(64)
        expect(body.page.records.every((record) => record.kind === "chunk")).toBe(true)
        expect(
          body.page.records.every((record) => record.data === Buffer.from(record.data!, "base64").toString("base64")),
        ).toBe(true)
        expect(body.nextCursor).toBeString()

        const second = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            capabilityOnly: false,
            aggregates: {},
            sourceSnapshotToken: body.sourceSnapshotToken,
            pageCursor: body.nextCursor,
          }),
        })
        expect(second.status).toBe(200)
        const continuation = yield* second.json
        expect(Buffer.byteLength(JSON.stringify(continuation))).toBeLessThanOrEqual(512 * 1024)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    10_000,
  )

  it.instance(
    "caps complete public records at 256 per frozen page",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = privateSyncHeaders(tmp.directory)
        const session = yield* Session.use.create({ title: "sync-page-count" })
        yield* Effect.forEach(
          Array.from({ length: 257 }, (_, index) => index),
          (index) => Session.use.setTitle({ sessionID: session.id, title: `sync-page-${index}` }),
          { discard: true },
        )
        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            capabilityOnly: false,
            aggregates: { [session.id]: { cursor: 0, privateDigest: digest(canonical([])) } },
          }),
        })
        expect(response.status).toBe(200)
        const body = (yield* response.json) as {
          sourceSnapshotToken: string
          highWater: Record<string, number>
          nextCursor?: string
          page: { records: unknown[] }
        }
        expect(body.page.records).toHaveLength(256)
        expect(body.nextCursor).toBeString()
        yield* Session.use.setTitle({ sessionID: session.id, title: "concurrent-tail" })
        const continuation = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            capabilityOnly: false,
            aggregates: { [session.id]: { cursor: 0, privateDigest: digest(canonical([])) } },
            sourceSnapshotToken: body.sourceSnapshotToken,
            pageCursor: body.nextCursor,
          }),
        })
        expect(continuation.status).toBe(200)
        const tail = (yield* continuation.json) as { page: { records: Array<{ sequence: number }> } }
        expect(tail.page.records).toHaveLength(1)
        expect(tail.page.records.every((record) => record.sequence <= body.highWater[session.id]!)).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    10_000,
  )

  it.instance(
    "stages v1 pages until an idempotent finalize",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = privateSyncHeaders(tmp.directory)
        yield* Session.use.create({ title: "sync-v1-replay" })
        const history = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ version: 1, capabilityOnly: false, aggregates: {} }),
        })
        const snapshot = (yield* history.json) as {
          sourceSnapshotToken: string
          highWater: Record<string, number>
          manifestDigest: string
          page: { records: unknown[] }
        }
        expect(snapshot.page.records.length).toBeGreaterThan(0)

        const begin = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            action: "begin",
            clientTransferID: "client-replay-1",
            directory: tmp.directory,
            sourceSnapshotToken: snapshot.sourceSnapshotToken,
            highWater: snapshot.highWater,
            manifestDigest: snapshot.manifestDigest,
            expiresAt: Date.now() + 60_000,
          }),
        })
        expect(begin.status).toBe(200)
        const started = (yield* begin.json) as { transferHandle: string }
        const append = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            action: "append",
            transferHandle: started.transferHandle,
            pageIndex: 0,
            pageHash: digest(canonical(snapshot.page)),
            page: snapshot.page,
          }),
        })
        expect(append.status).toBe(200)
        const finalize = {
          version: 1,
          action: "finalize",
          transferHandle: started.transferHandle,
          expectedPageCount: 1,
          manifestDigest: snapshot.manifestDigest,
        }
        const completed = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify(finalize),
        })
        expect(completed.status).toBe(200)
        const receipt = yield* completed.json
        const retried = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify(finalize),
        })
        expect(retried.status).toBe(200)
        expect(yield* retried.json).toEqual(receipt)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    10_000,
  )

  it.instance(
    "serves sync routes",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const session = yield* Session.use.create({ title: "sync" })

        const started = yield* requestInDirectory(SyncPaths.start, tmp.directory, { method: "POST", headers })
        expect(started.status).toBe(200)
        expect(yield* started.json).toBe(true)

        const history = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(history.status).toBe(200)
        const rows = (yield* history.json) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

        const replayed = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            directory: tmp.directory,
            events: rows
              .filter((row) => row.aggregate_id === session.id)
              .map((row) => ({
                id: row.id,
                aggregateID: row.aggregate_id,
                seq: row.seq,
                type: row.type,
                data: row.data,
              })),
          }),
        })
        expect(replayed.status).toBe(200)
        expect(yield* replayed.json).toEqual({ sessionID: session.id })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "validates seq values",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const cases = [
          {
            path: SyncPaths.history,
            body: { aggregate: -1 },
          },
          {
            path: SyncPaths.history,
            body: { aggregate: 1.5 },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 0, type: "session.created", data: {} }],
            },
          },
        ]

        for (const item of cases) {
          const response = yield* requestInDirectory(item.path, tmp.directory, {
            method: "POST",
            headers,
            body: JSON.stringify(item.body),
          })
          expect(response.status).toBe(400)
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns structured validation errors",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* Effect.promise(() =>
          HttpApiApp.webHandler().handler(
            new Request(`http://localhost${SyncPaths.history}`, {
              method: "POST",
              headers: { "x-opencode-directory": tmp.directory, "content-type": "application/json" },
              body: JSON.stringify({ aggregate: -1 }),
            }),
            context,
          ),
        )

        expect(response.status).toBe(400)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const body = (yield* Effect.promise(() => response.json())) as Record<string, unknown>
        expect(body).toMatchObject({
          name: "BadRequest",
          data: { kind: "Payload", message: expect.stringContaining('["aggregate"]') },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
