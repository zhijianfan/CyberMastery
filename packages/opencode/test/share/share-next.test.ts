import { beforeEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { AccountRepo } from "../../src/account/repo"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { SessionSharePendingTable, SessionShareTable } from "@opencode-ai/core/share/sql"
import { SessionDeletionTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function requestLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(LayerNode.group([ShareNext.node, AccountRepo.node]), [replacement])
}

function integrationLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(
    LayerNode.group([
      ShareNext.node,
      SessionShare.node,
      EventV2Bridge.node,
      Session.node,
      SessionProjector.node,
      AccountRepo.node,
      Database.node,
    ]),
    [replacement],
  )
}

const share = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(requestLayer(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.use.request()

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () => {
        const createRequests: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/api/share")) {
            createRequests.push(req)
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })

          const result = yield* (yield* ShareNext.Service).create(session.id)

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = yield* share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(createRequests).toHaveLength(1)
          expect(createRequests[0].method).toBe("POST")
          expect(createRequests[0].url).toBe("https://legacy-share.example.com/api/share")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("reserves a share before POST and persists credentials after a deletion fence", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const reached = yield* Deferred.make<void>()
        const resume = yield* Deferred.make<void>()
        const client = HttpClient.make((req) =>
          Effect.gen(function* () {
            if (req.url.endsWith("/api/share")) {
              yield* Deferred.succeed(reached, undefined)
              yield* Deferred.await(resume)
              return json(req, {
                id: "shr_race",
                url: "https://legacy-share.example.com/share/race",
                secret: "sec_race",
              })
            }
            return json(req, { ok: true })
          }),
        )
        yield* Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service
          const { db } = yield* Database.Service
          const creating = yield* service.create(session.id).pipe(Effect.forkChild)
          yield* Deferred.await(reached)

          expect(yield* db.select().from(SessionSharePendingTable)
            .where(eq(SessionSharePendingTable.session_id, session.id)).get()).toBeDefined()
          expect(yield* share(session.id)).toBeUndefined()
          yield* db.insert(SessionDeletionTable).values({ session_id: session.id, time_created: Date.now() }).run()
          yield* Deferred.succeed(resume, undefined)
          expect((yield* Fiber.join(creating)).id).toBe("shr_race")
          expect(yield* db.select().from(SessionSharePendingTable)
            .where(eq(SessionSharePendingTable.session_id, session.id)).get()).toBeUndefined()
          expect(yield* share(session.id)).toMatchObject({ id: "shr_race", secret: "sec_race" })
        }).pipe(Effect.provide(integrationLayer(client)))
      }),
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          seen.push(req)
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("unshare clears a fenced Session only after remote revocation", () =>
    provideTmpdirInstance(
      () => {
        const methods: string[] = []
        const client = HttpClient.make((req) => {
          methods.push(req.method)
          if (req.method === "POST")
            return Effect.succeed(json(req, { id: "shr_abc", url: "https://legacy-share.example.com/share/abc", secret: "sec_123" }))
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const sharing = yield* SessionShare.Service
          const db = (yield* Database.Service).db
          yield* sharing.share(session.id)
          yield* db.insert(SessionDeletionTable).values({ session_id: session.id, time_created: Date.now() }).run()
          const updates: string[] = []
          const off = yield* (yield* EventV2Bridge.Service).listen((event) => Effect.sync(() => {
            if (event.type === "session.updated") updates.push(event.type)
          }))

          yield* sharing.unshare(session.id)
          yield* off

          expect(methods).toEqual(["POST", "DELETE"])
          expect(updates).toEqual([])
          expect(yield* share(session.id)).toBeUndefined()
          expect(yield* db.select({ url: SessionTable.share_url }).from(SessionTable)
            .where(eq(SessionTable.id, session.id)).get()).toEqual({ url: null })
          expect(yield* db.select().from(SessionDeletionTable)
            .where(eq(SessionDeletionTable.session_id, session.id)).get()).toBeDefined()
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
    30_000,
  )

  it.live("unshare publishes a Session update with the cleared share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => req.method === "POST"
        ? Effect.succeed(json(req, { id: "shr_abc", url: "https://legacy-share.example.com/share/abc", secret: "sec_123" }))
        : Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 }))))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })
        const sharing = yield* SessionShare.Service
        yield* sharing.share(session.id)
        const updates: Array<{ sessionID: string; share: unknown }> = []
        const off = yield* (yield* EventV2Bridge.Service).listen((event) => Effect.sync(() => {
          if (event.type === "session.updated") updates.push({ sessionID: event.data.sessionID, share: event.data.info.share })
        }))

        yield* sharing.unshare(session.id)
        yield* off

        expect(updates).toEqual([{ sessionID: session.id, share: undefined }])
        expect((yield* (yield* Session.Service).get(session.id)).share).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }, { config: { enterprise: { url: "https://legacy-share.example.com" } } }),
    30_000,
  )

  it.live("unshare leaves a fenced share URL when credentials are missing", () =>
    provideTmpdirInstance(() => Effect.gen(function* () {
      const session = yield* (yield* Session.Service).create({ title: "test" })
      const db = (yield* Database.Service).db
      yield* (yield* Session.Service).setShare({ sessionID: session.id, share: { url: "https://legacy-share.example.com/share/missing" } })
      yield* db.insert(SessionDeletionTable).values({ session_id: session.id, time_created: Date.now() }).run()

      const exit = yield* Effect.exit((yield* SessionShare.Service).unshare(session.id))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* db.select({ url: SessionTable.share_url }).from(SessionTable)
        .where(eq(SessionTable.id, session.id)).get()).toEqual({ url: "https://legacy-share.example.com/share/missing" })
    }).pipe(Effect.provide(integrationLayer(none)))),
    30_000,
  )

  it.live("unshare keeps the fenced share when remote revocation fails", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => req.method === "POST"
        ? Effect.succeed(json(req, { id: "shr_abc", url: "https://legacy-share.example.com/share/abc", secret: "sec_123" }))
        : Effect.succeed(json(req, { error: "unavailable" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })
        const db = (yield* Database.Service).db
        const sharing = yield* SessionShare.Service
        yield* sharing.share(session.id)
        yield* db.insert(SessionDeletionTable).values({ session_id: session.id, time_created: Date.now() }).run()

        expect(Exit.isFailure(yield* Effect.exit(sharing.unshare(session.id)))).toBe(true)
        expect(yield* share(session.id)).toBeDefined()
        expect(yield* db.select({ url: SessionTable.share_url }).from(SessionTable)
          .where(eq(SessionTable.id, session.id)).get()).toEqual({ url: "https://legacy-share.example.com/share/abc" })
      }).pipe(Effect.provide(integrationLayer(client)))
    }, { config: { enterprise: { url: "https://legacy-share.example.com" } } }),
    30_000,
  )

  it.live("unshare preserves a replacement share created during remote revocation", () =>
    provideTmpdirInstance(() => Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      const client = HttpClient.make((req) => req.method === "POST"
        ? Effect.succeed(json(req, { id: "shr_a", url: "https://legacy-share.example.com/share/a", secret: "sec_a" }))
        : Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(proceed)
            return HttpClientResponse.fromWeb(req, new Response(null, { status: 200 }))
          }))
      return yield* Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })
        const db = (yield* Database.Service).db
        const sharing = yield* SessionShare.Service
        yield* sharing.share(session.id)
        yield* db.insert(SessionDeletionTable).values({ session_id: session.id, time_created: Date.now() }).run()

        const removing = yield* Effect.exit(sharing.unshare(session.id)).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* db.insert(SessionShareTable)
          .values({ session_id: session.id, id: "shr_b", secret: "sec_b", url: "https://legacy-share.example.com/share/b" })
          .onConflictDoUpdate({ target: SessionShareTable.session_id, set: { id: "shr_b", secret: "sec_b", url: "https://legacy-share.example.com/share/b" } }).run()
        yield* db.update(SessionTable).set({ share_url: "https://legacy-share.example.com/share/b" })
          .where(eq(SessionTable.id, session.id)).run()
        yield* Deferred.succeed(proceed, undefined)

        expect(Exit.isFailure(yield* Fiber.join(removing))).toBe(true)
        expect(yield* share(session.id)).toMatchObject({ id: "shr_b", secret: "sec_b" })
        expect(yield* db.select({ url: SessionTable.share_url }).from(SessionTable)
          .where(eq(SessionTable.id, session.id)).get()).toEqual({ url: "https://legacy-share.example.com/share/b" })
      }).pipe(Effect.provide(integrationLayer(client)))
    }), { config: { enterprise: { url: "https://legacy-share.example.com" } } }),
    30_000,
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* share(session.id)).toBeUndefined()
        const { db } = yield* Database.Service
        expect(yield* db.select().from(SessionSharePendingTable)
          .where(eq(SessionSharePendingTable.session_id, session.id)).get()).toBeDefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push({ url: req.url, body: new TextDecoder().decode(req.body.body) })
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_abc",
              url: "https://legacy-share.example.com/share/abc",
              secret: "sec_123",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                patch:
                  "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          expect(body.data).toHaveLength(1)
          expect(body.data[0].type).toBe("session_diff")
          expect(body.data[0].data).toEqual([
            {
              file: "b.ts",
              patch:
                "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})
