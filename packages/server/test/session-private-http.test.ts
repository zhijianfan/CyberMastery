import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import {
  BodyTooLargeError,
  MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES,
  bufferPrivateRequest,
} from "../src/session-private-http"

describe("private HTTP body buffering", () => {
  test("accepts 16 MiB and one byte below the public boundary", async () => {
    for (const size of [MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES - 1, MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES]) {
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/session/ses_test/prompt_async", {
          method: "POST",
          body: new Uint8Array(size),
        }),
      )

      const replacement = await Effect.runPromise(bufferPrivateRequest(request))
      expect((await Effect.runPromise(replacement.arrayBuffer)).byteLength).toBe(size)
    }
  })

  test("rejects an oversized declared body without reading it", async () => {
    let reads = 0
    const source = HttpServerRequest.fromWeb(
      new Request("http://localhost/session/ses_test/prompt_async", {
        method: "POST",
        headers: { "content-length": String(MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES + 1) },
        body: new Uint8Array([1]),
      }),
    )
    const request = new Proxy(source, {
      get(target, property) {
        if (property === "stream")
          return Stream.fromEffect(
            Effect.sync(() => {
              reads++
              return new Uint8Array([1])
            }),
          )
        return Reflect.get(target, property, target)
      },
    })

    const result = await Effect.runPromise(Effect.result(bufferPrivateRequest(request)))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(BodyTooLargeError)
    expect(reads).toBe(0)
  })

  test("caps chunked bodies incrementally and accepts the exact boundary", async () => {
    const accepted = HttpServerRequest.fromWeb(
      new Request("http://localhost/session/ses_test/prompt_async", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    )
    const replacement = await Effect.runPromise(bufferPrivateRequest(accepted, 4))
    expect(new Uint8Array(await Effect.runPromise(replacement.arrayBuffer))).toEqual(new Uint8Array([1, 2, 3, 4]))

    const oversized = HttpServerRequest.fromWeb(
      new Request("http://localhost/session/ses_test/prompt_async", {
        method: "POST",
        body: new Uint8Array([1, 2, 3, 4, 5]),
      }),
    )
    const result = await Effect.runPromise(Effect.result(bufferPrivateRequest(oversized, 4)))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(BodyTooLargeError)
  })

  test("returns a replacement request with the original method, URL, and safe headers", async () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/session/ses_test/prompt_async?value=1", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "kept" },
        body: "private-body",
      }),
    )

    const replacement = await Effect.runPromise(bufferPrivateRequest(request, 64))

    expect(replacement).not.toBe(request)
    expect(replacement.method).toBe("POST")
    expect(replacement.url).toBe("/session/ses_test/prompt_async?value=1")
    expect(replacement.headers["content-type"]).toBe("application/json")
    expect(replacement.headers["x-test"]).toBe("kept")
    expect(await Effect.runPromise(replacement.text)).toBe("private-body")
  })
})
