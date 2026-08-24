import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const it = testEffect(httpApiLayer)

describe("httpapi chat-relay", () => {
  it.live("checks workspace access before exposing whether the workspace exists", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/workspace/wrk_missing/chat-relay/block-1")
      expect(response.status).toBe(403)
      const body = yield* response.json
      expect(body).toEqual({
        _tag: "ChatRelayAccessDeniedError",
        workspaceID: "wrk_missing",
        blockID: "block-1",
        message: "Access to workspace wrk_missing block block-1 denied",
      })
    }),
  )
})
