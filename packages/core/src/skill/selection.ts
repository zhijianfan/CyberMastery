export * as SkillSelection from "./selection"

import { Skill } from "@opencode-ai/schema/skill"
import { Effect, Schema } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SkillV2 } from "../skill"
import { Hash } from "../util/hash"

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("SkillSelection.Unavailable", {
  message: Schema.String,
}) {}

type Policy = { readonly agent?: string; readonly allowAsk?: boolean }

export const candidates = Effect.fn("SkillSelection.candidates")(function* (policy: Policy) {
  return (yield* permitted(policy)).map(
    (skill): Skill.Candidate => ({
      name: skill.name,
      ...(skill.description === undefined ? {} : { description: skill.description }),
      contentHash: Hash.sha256(skill.content),
    }),
  )
})

export const resolve = Effect.fn("SkillSelection.resolve")(function* (
  selections: readonly Skill.Selection[],
  policy: Policy,
) {
  const catalog = yield* permitted(policy)
  const selected = new Map<string, Skill.Preview>()
  for (const selection of selections) {
    const skill = catalog.find((skill) => skill.name === selection.name)
    if (!skill || Hash.sha256(skill.content) !== selection.contentHash) {
      return yield* new UnavailableError({
        message: "A selected skill changed or is unavailable. Remove it and select it again.",
      })
    }
    selected.set(skill.name, {
      name: skill.name,
      ...(skill.description === undefined ? {} : { description: skill.description }),
      contentHash: selection.contentHash,
      content: skill.content,
    })
  }
  return [...selected.values()]
})

const permitted = Effect.fn("SkillSelection.permitted")(function* (policy: Policy) {
  const agents = yield* AgentV2.Service
  const agent = yield* agents.resolve(policy.agent)
  if (!agent) return []
  const skills = yield* SkillV2.Service
  return (yield* skills.list({ refresh: true })).filter((skill) => {
    const permission = PermissionV2.evaluate("skill", skill.name, agent.permissions).effect
    return permission === "allow" || (policy.allowAsk === true && permission === "ask")
  })
})
