import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SuperpowersPlugin } from "@opencode-ai/core/plugin/superpowers"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("SuperpowersPlugin.Plugin", () => {
  it.effect("registers the five host-adapted Superpowers skills", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SuperpowersPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const skills = (yield* skill.list()).toSorted((a, b) => a.name.localeCompare(b.name))
      expect(skills.map((item) => item.name)).toEqual([
        "superpowers:brainstorming",
        "superpowers:dispatching-parallel-agents",
        "superpowers:systematic-debugging",
        "superpowers:verification-before-completion",
        "superpowers:writing-plans",
      ])
      for (const item of skills) {
        expect(item.location).toBe(
          AbsolutePath.make(`/builtin/superpowers/${item.name.slice("superpowers:".length)}.md`),
        )
        expect(item.content).toStartWith("<host_adaptation>")
        expect(item.content).toContain("task_batch")
        expect(item.content).toContain("Never write implementation code")
      }
      expect(skills.find((item) => item.name.endsWith("dispatching-parallel-agents"))?.description).toContain(
        "MasterAgent",
      )
      for (const item of skills.filter((item) => !item.name.endsWith("dispatching-parallel-agents"))) {
        expect(item.description).toContain("OperatingAgent")
      }
    }),
  )
})
