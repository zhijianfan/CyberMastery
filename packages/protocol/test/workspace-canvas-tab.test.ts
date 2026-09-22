import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { makeDefaultApi } from "../src/api"
import { Authorization } from "../src/middleware/authorization"
import {
  CanvasTabArchivePayload,
  CanvasTabArchivedQuery,
  CanvasTabCreatePayload,
  CanvasTabGroup,
  CanvasTabMutationResult,
  CanvasTabOwnedQuery,
  CanvasTabOwnedResult,
  CanvasTabSelectPayload,
} from "../src/groups/workspace-canvas-tab"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()("CanvasTabTest.Location") {}
class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "CanvasTabTest.Session",
) {}

const api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

describe("canvas tab public API", () => {
  test("mounts an authenticated canvas tab group in the public API", () => {
    expect(Object.keys(api.groups)).toContain("server.workspace.canvasTab")
    expect(
      api.groups["server.workspace.canvasTab"].endpoints["workspace.canvasTab.listOwned"].middlewares.has(
        Authorization,
      ),
    ).toBe(true)
  })

  test("publishes a workspace and kind scoped registry invalidation event", () => {
    const event = WorkspaceEvent.Definitions.find((event) => event.type === "workspace.canvas-tab.changed")
    expect(event).toBeDefined()
    if (!event) return
    expect(
      Schema.decodeUnknownSync(event.data)({
        workspaceID: "wrk_test",
        kind: "chat-relay",
        blockID: "relay",
        revision: 3,
      }),
    ).toEqual({ workspaceID: WorkspaceID.make("wrk_test"), kind: "chat-relay", blockID: "relay", revision: 3 })
  })

  test("generates stable route IDs and typed authorization/lifecycle HTTP responses", () => {
    const document = OpenApi.fromApi(api)
    const root = "/api/workspace/{workspaceID}/canvas-tab/{kind}"
    const routes = [
      ["get", `${root}/owned/{blockID}`, "listOwned"],
      ["get", `${root}/archived`, "listArchived"],
      ["post", `${root}/owned/{blockID}/create`, "create"],
      ["post", `${root}/owned/{blockID}/select`, "select"],
      ["post", `${root}/owned/{blockID}/restore`, "restore"],
      ["post", `${root}/owned/{blockID}/archive-and-remove`, "archiveAndRemove"],
    ] as const
    for (const [method, path, operation] of routes) {
      expect(document.paths[path]?.[method]?.operationId).toBe(`v2.workspace.canvasTab.${operation}`)
      expect(Object.keys(document.paths[path]?.[method]?.responses ?? {})).toEqual(
        expect.arrayContaining(["200", "401", "403", "404", "409"]),
      )
    }
    const params = CanvasTabGroup.endpoints["workspace.canvasTab.listOwned"].params
    expect(() =>
      Schema.decodeUnknownSync(params as Schema.Decoder<unknown>)({
        workspaceID: "wrk_test",
        kind: "notes",
        blockID: "block",
      }),
    ).toThrow()
  })
})

describe("canvas tab request validation", () => {
  test("round-trips a creation-order cursor and independently searches archived titles", () => {
    const decoded = Schema.decodeUnknownSync(CanvasTabArchivedQuery)({
      cursor: '{"createdAt":100,"id":"tab-z"}',
      limit: "6",
      search: "alpha",
    })
    expect(decoded).toEqual({ cursor: '{"createdAt":100,"id":"tab-z"}', limit: 6, search: "alpha" })
    expect(Schema.encodeSync(CanvasTabArchivedQuery)(decoded)).toEqual({
      cursor: '{"createdAt":100,"id":"tab-z"}',
      limit: "6",
      search: "alpha",
    })
    expect(Schema.decodeUnknownSync(CanvasTabOwnedQuery)({})).toEqual({})
  })

  test.each(["0", "-1", "1.5", "101", "NaN", "Infinity", "bad"])("rejects invalid page limit %s", (limit) => {
    expect(() => Schema.decodeUnknownSync(CanvasTabOwnedQuery)({ limit })).toThrow()
  })

  test("requires a nonempty create request identity and valid CAS revision", () => {
    const decode = Schema.decodeUnknownSync(CanvasTabCreatePayload)
    expect(decode({ expectedRevision: 2, expectedBindingRevision: 3, requestID: "request-1" })).toEqual({
      expectedRevision: 2,
      expectedBindingRevision: 3,
      requestID: "request-1",
    })
    expect(() => decode({ expectedRevision: 2 })).toThrow()
    expect(() => decode({ expectedRevision: 2, requestID: "" })).toThrow()
    expect(() => decode({ expectedRevision: -1, requestID: "request" })).toThrow()
    expect(() => decode({ expectedRevision: 2, expectedBindingRevision: -1, requestID: "request" })).toThrow()
  })

  test("selection requires a tab and registry revision while Relay may omit binding revision", () => {
    const decode = Schema.decodeUnknownSync(CanvasTabSelectPayload)
    expect(decode({ tabID: "tab-1", expectedRevision: 2 })).toEqual({ tabID: "tab-1", expectedRevision: 2 })
    expect(() => decode({ tabID: "tab-1" })).toThrow()
    expect(() => decode({ tabID: "", expectedRevision: 2 })).toThrow()
    expect(() => decode({ tabID: "tab-1", expectedRevision: 2.5 })).toThrow()
  })

  test("removal requires the layout authority and revision alongside the registry revision", () => {
    const request = {
      expectedRevision: 2,
      expectedLayoutRevision: 4,
      clientID: "client-1",
      tuple: { user: "user-1", style: "canvas", deviceClass: "desktop" },
    } as const
    expect(Schema.decodeUnknownSync(CanvasTabArchivePayload)(request)).toEqual(request)
    expect(() => Schema.decodeUnknownSync(CanvasTabArchivePayload)({ expectedRevision: 2 })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CanvasTabArchivePayload)({ ...request, expectedLayoutRevision: -1 }),
    ).toThrow()
  })
})

describe("canvas tab responses", () => {
  const readonly = {
    id: "tab-1",
    workspaceID: WorkspaceID.make("wrk_test"),
    kind: "chat-relay",
    blockID: "relay",
    conversationID: "relay-1",
    title: "Saved conversation",
    createdAt: 10,
    writable: false,
  } as const

  test("preserves selected read-only Relay entries without requiring V2 binding metadata", () => {
    expect(Schema.decodeUnknownSync(CanvasTabMutationResult)({ revision: 3, selected: readonly })).toEqual({
      revision: 3,
      selected: readonly,
    })
    expect(
      Schema.decodeUnknownSync(CanvasTabOwnedResult)({
        items: [readonly],
        next: null,
        selectedTabID: "tab-1",
        revision: 3,
      }),
    ).toEqual({ items: [readonly], next: null, selectedTabID: "tab-1", revision: 3 })
  })

  test("represents an empty block and preserves the two-field continuation cursor", () => {
    expect(
      Schema.decodeUnknownSync(CanvasTabOwnedResult)({
        items: [],
        next: null,
        selectedTabID: null,
        revision: 0,
      }),
    ).toEqual({ items: [], next: null, selectedTabID: null, revision: 0 })
    expect(
      Schema.decodeUnknownSync(CanvasTab.Page)({ items: [readonly], next: { createdAt: 10, id: "tab-1" } }).next,
    ).toEqual({ createdAt: 10, id: "tab-1" })
  })
})
