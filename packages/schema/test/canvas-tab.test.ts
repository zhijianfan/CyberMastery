import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CanvasTab } from "../src"
import { Workspace } from "../src/workspace"

const workspaceID = Workspace.ID.make("wrk_test")

describe("CanvasTab", () => {
  test("decodes an owned entry and rejects an unsupported kind", () => {
    expect(
      Schema.decodeUnknownSync(CanvasTab.Entry)({
        id: "tab-1",
        workspaceID,
        kind: "master-agent",
        blockID: "block-1",
        conversationID: "session-1",
        title: "First session",
        createdAt: 10,
        writable: true,
      }),
    ).toMatchObject({ id: "tab-1", createdAt: 10 })
    expect(() => Schema.decodeUnknownSync(CanvasTab.Kind)("notes")).toThrow()
  })

  test("decodes a stable creation-order cursor page", () => {
    const page = Schema.decodeUnknownSync(CanvasTab.Page)({
      items: [
        {
          id: "tab-1",
          workspaceID,
          kind: "master-agent",
          conversationID: "session-1",
          title: "First session",
          createdAt: 10,
          writable: false,
        },
      ],
      next: { createdAt: 10, id: "tab-1" },
    })

    expect(page.next).toEqual({ createdAt: 10, id: "tab-1" })
  })
})
