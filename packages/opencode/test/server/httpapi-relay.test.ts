import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const it = testEffect(httpApiLayer)

describe("httpapi relay", () => {
  it.live("reports uninitialized status without touching the browser", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/relay/status")
      const body = yield* response.json
      expect(response.status).toBe(200)
      expect(body).toEqual({ status: "uninitialized", conversationId: null, url: null, messages: [], totalMessages: 0 })
    }),
  )

  it.live("rejects submission before initialization", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/relay/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      })
      expect(response.status).toBe(400)
    }),
  )
})
