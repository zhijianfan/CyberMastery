import { expect } from "bun:test"
import { Effect } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { testEffect } from "../../core/test/lib/effect"
import { fixture, layer, pages } from "./fixture/canvas-tabs"

const it = testEffect(layer)

it.effect("HTTP removal archives durably before detaching pages, authenticates tuple user, and retries safely", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.client["workspace.canvasTab.create"]({
      params: f.params,
      payload: { expectedRevision: 0, requestID: crypto.randomUUID() },
    })
    const events = yield* EventV2.Service
    const observed: number[] = []
    yield* events.listen((event) =>
      event.type === WorkspaceEvent.CanvasTabChanged.type
        ? f.tabs.listArchived(f.info.id, "chat-relay", "", undefined, 6).pipe(
            Effect.tap((page) => Effect.sync(() => observed.push(page.items.length))),
            Effect.asVoid,
          )
        : Effect.void,
    )
    const payload = {
      expectedRevision: first.revision,
      tuple: { ...f.tuple, user: "forged-user" },
      expectedLayoutRevision: 1,
      clientID: "tab-client",
    }
    const removed = yield* f.client["workspace.canvasTab.archiveAndRemove"]({ params: f.params, payload })
    expect(removed).toEqual({ archivedCount: 1, layoutRevision: 2, tabRevision: 2 })
    expect(yield* f.workspace.block.get(f.info.id, "one")).toBeUndefined()
    expect(pages.get(first.selected.conversationID)?.blockID).toBe("")
    expect(observed).toContain(1)
    const retry = yield* f.client["workspace.canvasTab.archiveAndRemove"]({ params: f.params, payload })
    expect(retry).toEqual({ archivedCount: 0, layoutRevision: 2, tabRevision: 2 })
  }),
)

it.effect("stale removal keeps owned tabs, layout and live pages intact", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.client["workspace.canvasTab.create"]({
      params: f.params,
      payload: { expectedRevision: 0, requestID: crypto.randomUUID() },
    })
    const error = yield* f.client["workspace.canvasTab.archiveAndRemove"]({
      params: f.params,
      payload: { expectedRevision: 0, tuple: f.tuple, expectedLayoutRevision: 1, clientID: "tab-client" },
    }).pipe(Effect.flip)
    expect(error._tag).toBe("CanvasTabStaleRevisionError")
    expect(yield* f.workspace.block.get(f.info.id, "one")).toBeDefined()
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe(first.selected.id)
    expect(pages.get(first.selected.conversationID)?.blockID).toBe("one")
  }),
)

it.effect("busy and stale-layout removal preserve selection and never publish an archive hint", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.client["workspace.canvasTab.create"]({
      params: f.params,
      payload: { expectedRevision: 0, requestID: crypto.randomUUID() },
    })
    const page = pages.get(first.selected.conversationID)!
    pages.set(first.selected.conversationID, new ChatProxy.Relay({ ...page, status: "thinking" }))
    const payload = {
      expectedRevision: first.revision,
      tuple: f.tuple,
      expectedLayoutRevision: 1,
      clientID: "tab-client",
    }
    expect(
      (yield* f.client["workspace.canvasTab.archiveAndRemove"]({ params: f.params, payload }).pipe(Effect.flip))._tag,
    ).toBe("CanvasTabBusyError")
    pages.set(first.selected.conversationID, page)
    const events = yield* EventV2.Service
    const observed: string[] = []
    yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type === WorkspaceEvent.CanvasTabChanged.type) observed.push(event.type)
      }),
    )
    expect(
      (yield* f.client["workspace.canvasTab.archiveAndRemove"]({
        params: f.params,
        payload: { ...payload, expectedLayoutRevision: 0 },
      }).pipe(Effect.flip))._tag,
    ).toBe("CanvasTabStaleRevisionError")
    expect(observed).toEqual([])
    expect(yield* f.workspace.block.get(f.info.id, "one")).toBeDefined()
    expect((yield* f.tabs.block(f.info.id, "chat-relay", "one")).selected.id).toBe(first.selected.id)
    expect(pages.get(first.selected.conversationID)?.blockID).toBe("one")
  }),
)

for (const kind of ["chat-relay", "master-agent", "operating-chat"] as const) {
  it.effect(`${kind} restores archived tabs into a same-kind block and retains its old conversation`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(kind)
      const owned = yield* f.client["workspace.canvasTab.listOwned"]({ params: f.params, query: {} })
      const first = yield* f.client["workspace.canvasTab.create"]({
        params: f.params,
        payload: {
          expectedRevision: owned.revision,
          expectedBindingRevision: owned.bindingRevision,
          requestID: crypto.randomUUID(),
        },
      })
      const receiving = { ...f.params, blockID: "two" }
      const second = yield* f.client["workspace.canvasTab.listOwned"]({ params: receiving, query: {} })
      const prior =
        kind === "chat-relay"
          ? yield* f.client["workspace.canvasTab.create"]({
              params: receiving,
              payload: { expectedRevision: 0, requestID: crypto.randomUUID() },
            })
          : undefined
      yield* f.client["workspace.canvasTab.archiveAndRemove"]({
        params: f.params,
        payload: {
          expectedRevision: first.revision,
          tuple: f.tuple,
          expectedLayoutRevision: 1,
          clientID: "tab-client",
        },
      })
      const restored = yield* f.client["workspace.canvasTab.restore"]({
        params: receiving,
        payload: {
          tabID: first.selected.id,
          expectedRevision: prior?.revision ?? second.revision,
          expectedBindingRevision: second.bindingRevision,
        },
      })
      expect(restored.selected).toMatchObject({ id: first.selected.id, blockID: "two", writable: true })
      expect((yield* f.tabs.listOwned(f.info.id, kind, "two", undefined, 10)).items).toHaveLength(2)
      expect(
        (yield* f.client["workspace.canvasTab.listArchived"]({ params: f.params, query: {} })).items.some(
          (entry) => entry.id === first.selected.id,
        ),
      ).toBe(false)
    }),
  )
}
