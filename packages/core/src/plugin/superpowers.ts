/// <reference path="../markdown.d.ts" />

export * as SuperpowersPlugin from "./superpowers"

import { Effect, Schema } from "effect"
import { ConfigMarkdown } from "../config/markdown"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import { define } from "./internal"
import brainstorming from "../../../../vendor/superpowers/skills/brainstorming/SKILL.md" with { type: "text" }
import dispatchingParallelAgents from "../../../../vendor/superpowers/skills/dispatching-parallel-agents/SKILL.md" with { type: "text" }
import systematicDebugging from "../../../../vendor/superpowers/skills/systematic-debugging/SKILL.md" with { type: "text" }
import verificationBeforeCompletion from "../../../../vendor/superpowers/skills/verification-before-completion/SKILL.md" with { type: "text" }
import writingPlans from "../../../../vendor/superpowers/skills/writing-plans/SKILL.md" with { type: "text" }

const Metadata = Schema.Struct({ name: Schema.String })
const decodeMetadata = Schema.decodeUnknownSync(Metadata)

const HOST_ADAPTATION = `<host_adaptation>
This vendored workflow is subordinate to the host agent's role, permissions, and the user's authorized scope.
- Skill names are namespaced in this host. Load a referenced skill as \`superpowers:<name>\` when it is available.
- Dispatch subagents only through \`task_batch\` under the host policy. Never use the legacy \`task\` tool. Emit exactly one \`task_batch\` call per ready dependency wave and wait for its exact result barrier before the next wave or integration.
- Auxiliary files, scripts, helpers, worktree workflows, and visual companions referenced below are not bundled. Do not read synthetic \`/builtin\` paths or launch companion processes; use the native tools currently available.
- When used as the workspace OperatingAgent, stay within general operations, research, planning, and design. Never write implementation code, tests, patches, or code blocks, even when the upstream workflow asks for them.
</host_adaptation>`

const sources = [
  {
    name: "dispatching-parallel-agents",
    description:
      "MasterAgent only: use before dispatching independent implementation work through task_batch dependency waves.",
    source: dispatchingParallelAgents,
  },
  {
    name: "brainstorming",
    description:
      "OperatingAgent only: shape non-coding operational work, requirements, and designs before action; never write code.",
    source: brainstorming,
  },
  {
    name: "writing-plans",
    description:
      "OperatingAgent only: turn approved requirements into non-coding execution plans and design artifacts; never write code.",
    source: writingPlans,
  },
  {
    name: "systematic-debugging",
    description:
      "OperatingAgent only: investigate operational failures methodically and recommend next steps without writing code.",
    source: systematicDebugging,
  },
  {
    name: "verification-before-completion",
    description:
      "OperatingAgent only: verify evidence for non-coding operational, planning, and design work before completion claims.",
    source: verificationBeforeCompletion,
  },
].map((item) => {
  const markdown = ConfigMarkdown.parse(item.source)
  const metadata = decodeMetadata(markdown.data)
  if (metadata.name !== item.name) throw new Error(`Unexpected Superpowers skill name: ${metadata.name}`)
  return SkillV2.EmbeddedSource.make({
    type: "embedded",
    skill: SkillV2.Info.make({
      name: `superpowers:${metadata.name}`,
      description: item.description,
      location: AbsolutePath.make(`/builtin/superpowers/${metadata.name}.md`),
      content: `${HOST_ADAPTATION}\n\n${markdown.content}`,
    }),
  })
})

export const Plugin = define({
  id: "superpowers",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      for (const source of sources) draft.source(source)
    })
  }),
})
