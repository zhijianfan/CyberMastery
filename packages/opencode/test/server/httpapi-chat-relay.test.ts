import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const it = testEffect(httpApiLayer)

describe("httpapi chat-relay", () => {
  it.live("routes the workspace binding group and maps missing workspaces", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/workspace/wrk_missing/chat-relay/block-1")
      expect(response.status).toBe(404)
      const body = yield* response.json
      expect(body).toEqual({
        _tag: "ChatRelayWorkspaceNotFoundError",
        workspaceID: "wrk_missing",
        message: "Workspace not found: wrk_missing",
      })
    }),
  )
})
