import { Effect, Schema, Stream } from "effect"
import { HttpServerRequest } from "effect/unstable/http"

export const MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES = 16_777_216

export class BodyTooLargeError extends Schema.TaggedErrorClass<BodyTooLargeError>()(
  "SessionPrivateHttp.BodyTooLargeError",
  {},
) {}

export function bufferPrivateRequest(
  request: HttpServerRequest.HttpServerRequest,
  limit = MAX_PRIVATE_PROMPT_HTTP_BODY_BYTES,
) {
  return Effect.gen(function* () {
    const declared = request.headers["content-length"]
    if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(limit)) {
      return yield* new BodyTooLargeError()
    }

    const buffered = yield* Stream.runFoldEffect(
      request.stream,
      () => ({ chunks: [] as Uint8Array[], size: 0 }),
      (state, chunk) => {
        const size = state.size + chunk.byteLength
        if (size > limit) return Effect.fail(new BodyTooLargeError())
        state.chunks.push(chunk)
        return Effect.succeed({ chunks: state.chunks, size })
      },
    )
    const body = new Uint8Array(buffered.size)
    buffered.chunks.reduce((offset, chunk) => {
      body.set(chunk, offset)
      return offset + chunk.byteLength
    }, 0)

    const headers = new Headers(request.headers)
    headers.set("content-length", String(body.byteLength))
    const url = request.originalUrl.startsWith("/")
      ? new URL(request.originalUrl, "http://localhost")
      : new URL(request.originalUrl)
    return HttpServerRequest.fromWeb(
      new Request(url, {
        method: request.method,
        headers,
        body,
      }),
    ).modify({ url: request.url, remoteAddress: request.remoteAddress })
  })
}
