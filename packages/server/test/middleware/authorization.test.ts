import { expect, test } from "bun:test"
import { Effect, Layer, Option, Ref } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { ServerAuth } from "../../src/auth"
import { authenticatedExternalUser, authorizationLayer, requestUser } from "../../src/middleware/authorization"

test("disabled authentication ignores unverified Basic usernames", async () => {
  expect(await authorizeUsers(Option.none(), "alice:not-secret")).toEqual({ legacy: "default", external: undefined })
})

test("authenticated requests use the validated server username", async () => {
  expect(await authorizeUsers(Option.some("secret"), "alice:secret")).toEqual({ legacy: "alice", external: "alice" })
})

function authorizeUsers(password: Option.Option<string>, credential: string) {
  const request = HttpServerRequest.fromWeb(
    new Request("http://localhost/api/workspace", {
      headers: { authorization: `Basic ${Buffer.from(credential).toString("base64")}` },
    }),
  )
  const layer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.configLayer({ username: "alice", password })))

  return Effect.runPromise(
    Effect.gen(function* () {
      const users = yield* Ref.make({ legacy: "", external: undefined as string | undefined })
      const authorize = yield* Authorization
      yield* authorize(
        Effect.gen(function* () {
          const legacy = yield* requestUser
          const external = yield* authenticatedExternalUser
          yield* Ref.set(users, { legacy: legacy.id, external: external?.id })
          return HttpServerResponse.empty()
        }),
        {
          endpoint: HttpApiEndpoint.get("authorization-test", "/"),
          group: HttpApiGroup.make("authorization-test"),
        },
      )
      return yield* Ref.get(users)
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
