import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "../../src/agent"
import { AbsolutePath } from "../../src/schema"
import { SkillV2 } from "../../src/skill"
import { SkillSelection } from "../../src/skill/selection"
import { Hash } from "../../src/util/hash"

const catalog = ["allowed", "ask", "denied"].map((name) => ({
  name,
  description: `${name} description`,
  location: AbsolutePath.make("D:/skills/SKILL.md"),
  content: `${name} instructions`,
}))
const layer = Layer.merge(AgentV2.locationLayer, Layer.mock(SkillV2.Service, { list: () => Effect.succeed(catalog) }))

test("discovers metadata with native ask policy, fails closed for unknown agents, and validates current selections", async () => {
  await Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    expect(yield* SkillSelection.candidates({})).toEqual([])
    yield* agents.transform((draft) => {
      draft.update(AgentV2.defaultID, (agent) => {
        agent.permissions = [
          { action: "skill", resource: "*", effect: "allow" },
          { action: "skill", resource: "ask", effect: "ask" },
          { action: "skill", resource: "denied", effect: "deny" },
        ]
      })
    })
    expect((yield* SkillSelection.candidates({ allowAsk: true })).map((skill) => skill.name)).toEqual([
      "allowed",
      "ask",
    ])
    expect(yield* SkillSelection.candidates({ agent: "missing", allowAsk: true })).toEqual([])
    expect(yield* SkillSelection.candidates({})).toEqual([
      {
        name: "allowed",
        description: "allowed description",
        contentHash: Hash.sha256("allowed instructions"),
      },
    ])
    const selection = { name: "allowed", contentHash: Hash.sha256("allowed instructions") }
    expect(yield* SkillSelection.resolve([selection, selection], {})).toEqual([
      {
        ...selection,
        description: "allowed description",
        content: "allowed instructions",
      },
    ])
    expect(
      (yield* SkillSelection.resolve([selection, { ...selection, contentHash: "stale" }], {}).pipe(Effect.result))._tag,
    ).toBe("Failure")
    for (const selected of [
      { ...selection, contentHash: "stale" },
      { name: "missing", contentHash: "stale" },
      { name: "ask", contentHash: Hash.sha256("ask instructions") },
    ]) {
      expect((yield* SkillSelection.resolve([selected], {}).pipe(Effect.result))._tag).toBe("Failure")
    }
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)
})
