import { expect, spyOn } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { CanvasTabTable } from "@opencode-ai/core/workspace/sql"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { testEffect } from "../../../core/test/lib/effect"
import { active, fixture, layer, pages } from "../fixture/canvas-tabs"

const it = testEffect(layer)

for (const kind of ["chat-relay", "master-agent", "operating-chat"] as const) {
  it.effect(`${kind} owned polling avoids writer transactions and preserves initial enrollment`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind)
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const changed: number[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === WorkspaceEvent.CanvasTabChanged.type)
            changed.push((event.data as { revision: number }).revision)
        }),
      )
      const transactions = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(database.db, "transaction")),
        (spy) => Effect.sync(() => spy.mockRestore()),
      )
      const initial = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      // Only first-time V2 binding creation needs a writer transaction, not the surrounding GET.
      expect(transactions.mock.calls.filter((call) => call[1]?.behavior === "immediate")).toHaveLength(
        kind === "chat-relay" ? 0 : 1,
      )
      expect(initial).toMatchObject(
        kind === "chat-relay"
          ? { items: [], selectedTabID: null, revision: 0 }
          : { selectedTabID: initial.items[0].id, revision: 0, bindingRevision: 0 },
      )
      expect(changed).toEqual(kind === "chat-relay" ? [] : [0])
      transactions.mockClear()
      const polled = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      expect(polled).toEqual(initial)
      expect(transactions.mock.calls.filter((call) => call[1]?.behavior === "immediate")).toEqual([])
      expect(changed).toEqual(kind === "chat-relay" ? [] : [0])
    }),
  )
}

for (const kind of ["master-agent", "operating-chat"] as const) {
  it.effect(`${kind} legacy reset creates a selected tab and rejects a mismatched session identity`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind)
      const owned = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      const events = yield* EventV2.Service
      const changed: number[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === WorkspaceEvent.CanvasTabChanged.type)
            changed.push((event.data as { revision: number }).revision)
        }),
      )
      const reset = (input: {
        params: typeof f.params
        payload: { expectedSessionID: SessionSchema.ID; expectedRevision: number }
      }): Effect.Effect<void, unknown> =>
        kind === "master-agent"
          ? f.master["workspace.masterAgent.reset"](input).pipe(Effect.asVoid)
          : f.operating["workspace.operatingChat.reset"](input).pipe(Effect.asVoid)
      yield* reset({
        params: f.params,
        payload: {
          expectedSessionID: SessionSchema.ID.make(owned.items[0].conversationID),
          expectedRevision: owned.bindingRevision!,
        },
      })
      expect((yield* f.tabs.listOwned(f.info.id, kind, "one", undefined, 100)).items).toHaveLength(2)
      expect(changed).toEqual([1])
      const next = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      expect(next.items).toHaveLength(2)
      expect(next.selectedTabID).not.toBe(owned.selectedTabID)
      const registry = yield* f.tabs.block(f.info.id, kind, "one")
      expect(registry.selected.conversationID).toBe(
        next.items.find((entry) => entry.id === next.selectedTabID)!.conversationID,
      )
      yield* reset({
        params: f.params,
        payload: {
          expectedSessionID: SessionSchema.ID.make("ses_wrong_identity"),
          expectedRevision: next.bindingRevision!,
        },
      }).pipe(Effect.result)
      expect((yield* f.tabs.listOwned(f.info.id, kind, "one", undefined, 100)).items).toHaveLength(2)
      expect(changed).toEqual([1])
    }),
  )
}

it.effect("malformed cursor returns a typed invalid request for owned and archived lists", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const cursor of [
      "not-json",
      "null",
      "{}",
      '{"createdAt":"10","id":"tab"}',
      '{"createdAt":10}',
      '{"createdAt":10,"id":""}',
      '{"createdAt":1e309,"id":"tab"}',
    ]) {
      for (const endpoint of ["workspace.canvasTab.listOwned", "workspace.canvasTab.listArchived"] as const) {
        const error = yield* f.client[endpoint]({ params: f.params, query: { cursor } }).pipe(Effect.flip)
        expect(error._tag).toBe("CanvasTabInvalidRequestError")
      }
    }
  }),
)

it.effect("authenticates workspace ownership before reading tabs", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const other = yield* f.workspace.create({ name: "Private", user: "someone-else" })
    const error = yield* f.client["workspace.canvasTab.listArchived"]({
      params: { workspaceID: other.id, kind: "chat-relay" },
      query: {},
    }).pipe(Effect.flip)
    expect(error._tag).toBe("CanvasTabAccessDeniedError")
  }),
)

it.effect("lists Relay tabs with live writability and read-only persisted history after restart", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.client["workspace.canvasTab.create"]({
      params: f.params,
      payload: { expectedRevision: 0, requestID: crypto.randomUUID() },
    })
    expect(first.selected.writable).toBe(true)
    const live = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
    expect(live).toMatchObject({ selectedTabID: first.selected.id, revision: 1, items: [{ writable: true }] })
    pages.delete(first.selected.conversationID)
    const saved = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
    expect(saved.items[0].writable).toBe(false)
  }),
)

for (const kind of ["master-agent", "operating-chat"] as const) {
  it.effect(`${kind} requires both revisions, preserves exact retries, and emits committed changes`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind)
      const events = yield* EventV2.Service
      const database = yield* Database.Service
      const owned = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      const before = yield* database.db.select().from(SessionTable).all().pipe(Effect.orDie)
      const requestID = crypto.randomUUID()
      const missing = yield* f.client["workspace.canvasTab.create"]({
        params: f.params,
        payload: { expectedRevision: owned.revision, requestID },
      }).pipe(Effect.flip)
      expect(missing._tag).toBe("CanvasTabInvalidRequestError")
      const stale = yield* f.client["workspace.canvasTab.create"]({
        params: f.params,
        payload: { expectedRevision: 99, expectedBindingRevision: owned.bindingRevision, requestID },
      }).pipe(Effect.flip)
      expect(stale._tag).toBe("CanvasTabStaleRevisionError")
      expect(yield* database.db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(before.length)
      const observed: string[] = []
      yield* events.listen((event) =>
        event.type === WorkspaceEvent.CanvasTabChanged.type
          ? f.tabs.block(f.info.id, kind, "one").pipe(
              Effect.tap((state) => Effect.sync(() => observed.push(state.selected.id))),
              Effect.asVoid,
              Effect.orDie,
            )
          : Effect.void,
      )
      const payload = { expectedRevision: owned.revision, expectedBindingRevision: owned.bindingRevision, requestID }
      const created = yield* f.client["workspace.canvasTab.create"]({ params: f.params, payload })
      const retry = yield* f.client["workspace.canvasTab.create"]({ params: f.params, payload })
      expect(retry.selected.id).toBe(created.selected.id)
      expect(yield* database.db.select().from(SessionTable).all().pipe(Effect.orDie)).toHaveLength(before.length + 1)
      expect(observed).toContain(created.selected.id)
      active.add(SessionSchema.ID.make(created.selected.conversationID))
      const busy = yield* f.client["workspace.canvasTab.select"]({
        params: f.params,
        payload: {
          tabID: owned.selectedTabID!,
          expectedRevision: created.revision,
          expectedBindingRevision: created.bindingRevision,
        },
      }).pipe(Effect.flip, Effect.ensuring(Effect.sync(() => active.clear())))
      expect(busy._tag).toBe("CanvasTabBusyError")
      expect((yield* f.tabs.block(f.info.id, kind, "one")).selected.id).toBe(created.selected.id)
    }),
  )
}

it.effect("rejects a mismatched target block kind without creating a conversation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const error = yield* f.client["workspace.canvasTab.create"]({
      params: { ...f.params, kind: "master-agent" },
      payload: { expectedRevision: 0, expectedBindingRevision: 0, requestID: crypto.randomUUID() },
    }).pipe(Effect.flip)
    expect(error._tag).toBe("CanvasTabWrongKindError")
  }),
)

it.effect("archive search and creation cursors remain isolated by workspace and kind", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const database = yield* Database.Service
    const other = yield* f.workspace.create({ name: "Other", user: "tab-user" })
    yield* database.db
      .insert(CanvasTabTable)
      .values([
        {
          id: "older",
          workspace_id: f.info.id,
          kind: "chat-relay" as const,
          conversation_id: "exact-conversation",
          origin_block_id: "removed",
          owner_block_id: null,
          title: "Alpha older",
          time_created: 10,
          time_archived: 20,
        },
        {
          id: "z-newer",
          workspace_id: f.info.id,
          kind: "chat-relay" as const,
          conversation_id: "second",
          origin_block_id: "removed",
          owner_block_id: null,
          title: "ALPHA newer",
          time_created: 10,
          time_archived: 30,
        },
        {
          id: "newest",
          workspace_id: f.info.id,
          kind: "chat-relay" as const,
          conversation_id: "third",
          origin_block_id: "removed",
          owner_block_id: null,
          title: "Alpha newest",
          time_created: 30,
          time_archived: 40,
        },
        {
          id: "wrong-kind",
          workspace_id: f.info.id,
          kind: "master-agent" as const,
          conversation_id: "fourth",
          origin_block_id: "removed",
          owner_block_id: null,
          title: "Alpha hidden",
          time_created: 50,
          time_archived: 60,
        },
        {
          id: "wrong-workspace",
          workspace_id: other.id,
          kind: "chat-relay" as const,
          conversation_id: "fifth",
          origin_block_id: "removed",
          owner_block_id: null,
          title: "Alpha hidden",
          time_created: 50,
          time_archived: 60,
        },
      ])
      .run()
      .pipe(Effect.orDie)
    const first = yield* f.client["workspace.canvasTab.listArchived"]({
      params: f.params,
      query: { search: "aLpHa", limit: 2 },
    })
    expect(first.items.map((entry) => entry.id)).toEqual(["newest", "z-newer"])
    const second = yield* f.client["workspace.canvasTab.listArchived"]({
      params: f.params,
      query: { search: "alpha", limit: 2, cursor: JSON.stringify(first.next) },
    })
    expect(second.items.map((entry) => entry.id)).toEqual(["older"])
    const exact = yield* f.client["workspace.canvasTab.listArchived"]({
      params: f.params,
      query: { search: "exact-conversation" },
    })
    expect(exact.items.map((entry) => entry.id)).toEqual(["older"])
    expect(
      (yield* f.client["workspace.canvasTab.listArchived"]({ params: f.params, query: { search: "missing" } })).items,
    ).toEqual([])
    const crossKind = yield* f.client["workspace.canvasTab.restore"]({
      params: f.params,
      payload: { tabID: "wrong-kind", expectedRevision: 0 },
    }).pipe(Effect.flip)
    expect(crossKind._tag).toBe("CanvasTabWrongKindError")
    const crossWorkspace = yield* f.client["workspace.canvasTab.restore"]({
      params: f.params,
      payload: { tabID: "wrong-workspace", expectedRevision: 0 },
    }).pipe(Effect.flip)
    expect(crossWorkspace._tag).toBe("CanvasTabNotFoundError")
  }),
)

for (const kind of ["master-agent", "operating-chat"] as const) {
  it.effect(`${kind} admits one of two clients creating from the same revisions`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind)
      const owned = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      const results = yield* Effect.all(
        ["a", "b"].map((suffix) =>
          f.client["workspace.canvasTab.create"]({
            params: f.params,
            payload: {
              expectedRevision: owned.revision,
              expectedBindingRevision: owned.bindingRevision,
              requestID: `${crypto.randomUUID()}-${suffix}`,
            },
          }).pipe(Effect.result),
        ),
        { concurrency: "unbounded" },
      )
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
      expect(results.filter((result) => result._tag === "Failure").map((result) => result.failure._tag)).toEqual([
        "CanvasTabStaleRevisionError",
      ])
      expect((yield* f.tabs.listOwned(f.info.id, kind, "one", undefined, 10)).items).toHaveLength(2)
    }),
  )
}
