import { expect, test } from "bun:test"
import { Effect, Layer, Logger, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { SchemaErrorMiddleware, schemaErrorLayer } from "../../src/middleware/schema-error"

const Api = HttpApi.make("schema-error-test").add(
  HttpApiGroup.make("test")
    .add(
      HttpApiEndpoint.post("private", "/api/session/:sessionID/prompt", {
        payload: Schema.Struct({ count: Schema.Number }),
        success: Schema.String,
        error: InvalidRequestError,
      }),
      HttpApiEndpoint.post("ordinary", "/api/ordinary", {
        payload: Schema.Struct({ count: Schema.Number }),
        success: Schema.String,
        error: InvalidRequestError,
      }),
    )
    .middleware(SchemaErrorMiddleware),
)

const handlers = HttpApiBuilder.group(Api, "test", (handlers) =>
  handlers
    .handle("private", () => Effect.succeed("ok"))
    .handle("ordinary", () => Effect.succeed("ok")),
)

test("private prompt schema errors redact rejected values from responses and logs", async () => {
  const sentinel = "private-label-ctxpk-secret-hash"
  const logs: string[] = []
  const logger = Logger.map(Logger.formatJson, (value) => {
    logs.push(value)
  })
  const handler = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(handlers),
      Layer.provide(schemaErrorLayer),
      Layer.provide(Logger.layer([logger])),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  ).handler

  const response = await handler(
    new Request("http://localhost/api/session/ses_test/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: sentinel }),
    }),
  )
  const body = await response.text()

  expect(response.status).toBe(400)
  expect(body).toContain("private_prompt_invalid")
  expect(body).not.toContain(sentinel)
  expect(logs.join("\n")).not.toContain(sentinel)
})

test("ordinary schema errors retain the existing bounded diagnostic", async () => {
  const sentinel = "ordinary-schema-sentinel"
  const handler = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(handlers),
      Layer.provide(schemaErrorLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  ).handler

  const response = await handler(
    new Request("http://localhost/api/ordinary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: sentinel }),
    }),
  )

  expect(response.status).toBe(400)
  expect(await response.text()).toContain(sentinel)
})
