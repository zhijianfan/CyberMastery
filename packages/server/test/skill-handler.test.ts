import { expect, test } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { Hash } from "@opencode-ai/core/util/hash"
import { SkillGroup } from "@opencode-ai/protocol/groups/skill"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { Effect, FileSystem, Layer, Path } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { SkillHandler } from "../src/handlers/skill"
import { LocationMiddleware } from "../src/location"

const directory = AbsolutePath.make("D:/native-workspace")
const catalog = ["allowed", "ask", "denied"].map((name) => ({
  name,
  description: `${name} description`,
  location: AbsolutePath.make(`${directory}/skills/${name}.md`),
  content: `${name} instructions`,
}))
const layer = SkillHandler.pipe(
  Layer.provideMerge(AgentV2.locationLayer),
  Layer.provideMerge(Layer.mock(SkillV2.Service, { list: () => Effect.succeed(catalog) })),
  Layer.provideMerge(
    Layer.succeed(Location.Service, { directory, project: { id: ProjectID.make("native"), directory } }),
  ),
  Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(Etag.layer),
  Layer.provideMerge(
    Layer.succeed(
      Authorization,
      Authorization.of((effect) => effect),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      SchemaErrorMiddleware,
      SchemaErrorMiddleware.of((effect) => effect),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      LocationMiddleware,
      LocationMiddleware.of((effect) => effect as never),
    ),
  ),
)

test("native skill metadata uses the selected agent, includes ask policy, and never falls back for unknown agents", async () => {
  await Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((draft) => {
      draft.update(AgentV2.defaultID, (agent) => {
        agent.permissions = [{ action: "skill", resource: "*", effect: "allow" }]
      })
      draft.update(AgentV2.ID.make("restricted"), (agent) => {
        agent.permissions = [
          { action: "skill", resource: "*", effect: "allow" },
          { action: "skill", resource: "ask", effect: "ask" },
          { action: "skill", resource: "denied", effect: "deny" },
        ]
      })
    })
    const client = (yield* HttpApiTest.groups(HttpApi.make("server").add(SkillGroup), ["server.skill"]))["server.skill"]
    const values = yield* client["skill.candidates"]({ query: { agent: "restricted" } })
    expect(values.data).toEqual(
      ["allowed", "ask"].map((name) => ({
        name,
        description: `${name} description`,
        contentHash: Hash.sha256(`${name} instructions`),
      })),
    )
    expect((yield* client["skill.candidates"]({ query: { agent: "missing" } })).data).toEqual([])
    expect((yield* client["skill.candidates"]({ query: {} })).data).toHaveLength(3)
    expect((yield* client["skill.list"]({ query: {} })).data).toEqual(catalog)
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)
})
