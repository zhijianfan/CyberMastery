import { expect, test } from "bun:test"
import { Effect, Layer, Option, Ref } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { ServerAuth } from "../../src/auth"
import { authorizationLayer, requestUser } from "../../src/middleware/authorization"

test("disabled authentication ignores unverified Basic usernames", async () => {
  expect(await authorizeUser(Option.none(), "alice:not-secret")).toBe("default")
})

test("authenticated requests use the validated server username", async () => {
  expect(await authorizeUser(Option.some("secret"), "alice:secret")).toBe("alice")
})

function authorizeUser(password: Option.Option<string>, credential: string) {
  const request = HttpServerRequest.fromWeb(
    new Request("http://localhost/api/workspace", {
      headers: { authorization: `Basic ${Buffer.from(credential).toString("base64")}` },
    }),
  )
  const layer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.configLayer({ username: "alice", password })))

  return Effect.runPromise(
    Effect.gen(function* () {
      const user = yield* Ref.make("")
      const authorize = yield* Authorization
      yield* authorize(
        requestUser.pipe(
          Effect.tap((value) => Ref.set(user, value.id)),
          Effect.as(HttpServerResponse.empty()),
        ),
        {
          endpoint: HttpApiEndpoint.get("authorization-test", "/"),
          group: HttpApiGroup.make("authorization-test"),
        },
      )
      return yield* Ref.get(user)
    }).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      Effect.provideService(HttpRouter.RouteContext, {
        params: {},
        route: HttpRouter.route("GET", "/", HttpServerResponse.empty()),
      }),
      Effect.provide(layer),
      Effect.scoped,
    ),
  )
}
