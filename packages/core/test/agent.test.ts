import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

describe("AgentV2", () => {
  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.all()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.all()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      yield* agent.reload()

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("does not ambiently opt built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const agents = yield* agent.all()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "explore",
        "general",
        "parallel-master",
        "parallel-worker",
        "plan",
        "summary",
        "title",
      ])
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect === "allow")).toBe(false)
      }

      const master = yield* agent.get(AgentV2.ID.make("parallel-master"))
      const worker = yield* agent.get(AgentV2.ID.make("parallel-worker"))
      if (!master || !worker) throw new Error("expected parallel agents")
      expect(master).toMatchObject({ hidden: true, mode: "primary" })
      expect(worker).toMatchObject({ hidden: true, mode: "subagent" })
      expect(master.model).toBeUndefined()
      expect(worker.model).toBeUndefined()
      expect(master.system).toContain("disjoint owned paths")
      expect(master.system).toContain("exact result barrier")
      expect(master.system).toContain("superpowers:dispatching-parallel-agents")
      expect(master.system).toContain("one task_batch call per dependency wave")
      expect(worker.system).toContain("task brief is authoritative")
      expect(worker.system).toContain("single host-authored <worker_rules> envelope")
      expect(PermissionV2.evaluate("parallel_task", "parallel-worker", master.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("parallel_task", "other-worker", master.permissions).effect).toBe("deny")
      expect(
        PermissionV2.evaluate("skill", "superpowers:dispatching-parallel-agents", master.permissions).effect,
      ).toBe("allow")
      expect(PermissionV2.evaluate("skill", "superpowers:brainstorming", master.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("parallel_task", "parallel-worker", worker.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("read", ".env", worker.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("grep", "secret", worker.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("bash", "bun test", worker.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("edit", ".env", worker.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("edit", ".env.local", worker.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("edit", ".env.example", worker.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("edit", "src/index.ts", worker.permissions).effect).toBe("allow")
      for (const item of agents.filter((agent) => agent.mode === "subagent")) {
        expect(PermissionV2.evaluate("parallel_task", "parallel-worker", item.permissions).effect).toBe("deny")
      }
      expect(PermissionV2.evaluate("read", "README.md", master.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("read", ".env", master.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("read", ".env.local", master.permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("read", ".env.example", master.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("glob", "src/**/*.ts", master.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("grep", "secret", master.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("edit", ".opencode/parallel/run/MANIFEST.md", master.permissions).effect).toBe(
        "allow",
      )
      expect(PermissionV2.evaluate("edit", "src/index.ts", master.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("bash", "bun test", master.permissions).effect).toBe("deny")
      expect(PermissionV2.evaluate("question", "*", master.permissions).effect).toBe("deny")
    }),
  )
})
