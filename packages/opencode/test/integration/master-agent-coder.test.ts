import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { FunctionalityInstanceTable, WorkspaceV2Table } from "@opencode-ai/core/workspace/sql"
import { MasterAgentContext } from "../../src/session/master-agent-context"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

// Track V2 — Coder routing integration tests.
//
// Drives the real prompt pipeline with the REAL MasterAgentContext resolver
// and its live DB-backed source (real workspace_v2 and functionality_instance
// rows in the instance database), so session resolution -> R2 policy ->
// coder-task injection -> R3 runner -> child session are one real chain.
// R6's own integration test scripts the resolver source; this track adds the
// live-row chain and the mid-run workspace-change snapshot invariant.
//
// No mocks beyond the standard in-memory service overrides (summary, LSP,
// MCP, runtime flags) shared by the session test suite.

const workspaceID = Workspace.ID.make("wrk_coder_v2_test")
const blockID = "block-coder-v2"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const taskAllow: PermissionV1.Rule = { permission: "task", pattern: "coder", action: "allow" }

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const makeMcp = () =>
  Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed([]),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in coder integration tests"),
      authenticate: () => Effect.die("unexpected MCP auth in coder integration tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in coder integration tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

// The real MasterAgentContext node (R1) with its live source over the real
// instance database; WorkspaceService.node is its DB-backed dependency.
const promptRoot = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  MasterAgentContext.node,
  WorkspaceService.node,
])

const harness = LayerNode.compile(
  LayerNode.group([promptRoot, testLLMServerNode]),
  [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, runtimeFlags],
  ],
)

function run<A, E>(body: Effect.Effect<A, E, any>): Promise<A> {
  // The provided layer covers every service requirement; the cast only
  // discharges the generic requirement subtraction.
  return Effect.runPromise(
    body.pipe(
      withTmpdirInstance(),
      Effect.scoped,
      Effect.provide(harness),
    ) as Effect.Effect<A, E, never>,
  )
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

// Real workspace row: primary model + nullable Coder model, host directory.
const insertWorkspace = Effect.fn("test.insertWorkspace")(function* (dir: string, coderModel: string | null) {
  const { db } = yield* Database.Service
  const now = Date.now()
  yield* db
    .insert(WorkspaceV2Table)
    .values({
      id: workspaceID,
      name: "Coder workspace",
      style: "default",
      directories: [dir],
      plugin_ids: [],
      skill_ids: [],
      operating_agent: null,
      model: "test/test-model",
      coder_model: coderModel,
      user: "",
      time_created: now,
      time_updated: now,
    })
    .run()
    .pipe(Effect.orDie)
})

// Real functionality-instance row owning the primary session (R1 binding).
const insertBinding = Effect.fn("test.insertBinding")(function* (sessionID: SessionID) {
  const { db } = yield* Database.Service
  yield* db
    .insert(FunctionalityInstanceTable)
    .values({
      id: "instance-coder-v2",
      workspace_id: workspaceID,
      block_id: blockID,
      functionality_id: "builtin:master-agent",
      revision: 1,
      configuration: {
        version: 1,
        directoryBinding: { mode: "workspace-primary" },
        sessionBinding: { mode: "owned", sessionID, generation: 0 },
      },
      deleted_at: null,
      time_updated: Date.now(),
    })
    .run()
    .pipe(Effect.orDie)
})

function cfg(url: string): Partial<ConfigV1.Info> {
  return {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
          "coder-model": {
            id: "coder-model",
            name: "Coder Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
          "other-model": {
            id: "other-model",
            name: "Other Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test",
          baseURL: url,
        },
      },
    },
  }
}

// Boot a primary session bound through the real DB rows and return handles.
const boot = Effect.fn("test.coder.boot")(function* (input: {
  coderModel: string | null
  permission: PermissionV1.Ruleset
}) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const { db } = yield* Database.Service
  yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...cfg(llm.url) }))
  yield* config.get()
  yield* insertWorkspace(dir, input.coderModel)
  const chat = yield* sessions.create({ title: "Coder primary", workspaceID, permission: input.permission })
  yield* insertBinding(chat.id)
  return { prompt, sessions, chat, llm, dir, db }
})

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

function coderTaskPart(msgs: SessionV1.WithParts[], tool: string) {
  for (const msg of msgs) {
    const part = msg.parts.find((p) => p.type === "tool" && p.tool === tool)
    if (part) return part as SessionV1.ToolPart
  }
  return undefined
}

function coderTaskParts(msgs: SessionV1.WithParts[], tool: string) {
  return msgs.flatMap((msg) => msg.parts).filter((p): p is SessionV1.ToolPart => p.type === "tool" && p.tool === tool)
}

describe("MasterAgent Coder routing integration", () => {
  test(
    "live resolver chain: bound session resolves to host state and coder-task is injected while mutation tools are removed",
    async () => {
      await run(
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm, dir } = yield* boot({
            coderModel: "test/coder-model",
            permission: [taskAllow],
          })

          // Real resolver over the real DB rows: the bound primary resolves to
          // the full host context — workspace, block, instance, directory,
          // primary model, Coder model, and task permission.
          const context = yield* MasterAgentContext.Service
          const resolved = yield* context.resolve(chat.id)
          expect(resolved.status).toBe("master-agent")
          if (resolved.status !== "master-agent") return
          expect(resolved.context.workspaceID).toBe(workspaceID)
          expect(resolved.context.blockID).toBe(blockID)
          expect(resolved.context.functionalityInstanceID).toBe("instance-coder-v2")
          expect(resolved.context.parentSessionID).toBe(chat.id)
          expect(resolved.context.directory).toBe(dir)
          expect(resolved.context.primaryModel).toEqual({ providerID: "test", modelID: "test-model" })
          expect(resolved.context.coderModel).toEqual({ providerID: "test", modelID: "coder-model" })
          expect(resolved.context.taskPermission).toBe("allow")

          // An ordinary session (no workspace, no parent) is untouched.
          const ordinary = yield* sessions.create({ title: "Ordinary" })
          expect(yield* context.resolve(ordinary.id)).toEqual({ status: "not-master-agent" })

          // Policy over the resolved tool set: the primary's direct mutation
          // tools are gone and coder-task is injected.
          yield* llm.tool("edit", { filePath: "a.ts", oldString: "a", newString: "b" })
          yield* llm.text("done")
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          expect(result.info.role).toBe("assistant")

          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const invalid = coderTaskPart(msgs, "invalid")
          expect(invalid).toBeDefined()
          if (!invalid) return
          expect(invalid.state.status).toBe("completed")
          if (invalid.state.status !== "completed") return
          const input = invalid.state.input as { tool?: string; error?: string }
          expect(input.tool).toBe("edit")
          expect(input.error).toContain("unavailable tool 'edit'")
          const available = (input.error?.split("Available tools: ")[1] ?? "").split(",").map((s) => s.trim())
          expect(available).toContain("coder-task")
          expect(available).not.toContain("edit")
          expect(available).not.toContain("write")
          expect(available).not.toContain("apply_patch")
          expect(available).not.toContain("bash")
          expect(available).not.toContain("execute")

          // No child session was created and the primary never left its model.
          expect(yield* sessions.children(chat.id)).toHaveLength(0)
          const hits = yield* llm.hits
          expect(hits.filter((hit) => hit.body.model === "coder-model")).toHaveLength(0)
        }),
      )
    },
    30_000,
  )

  test(
    "mid-run workspace change: in-flight child keeps the Coder model snapshot and the primary stays on the workspace model",
    async () => {
      await run(
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm, dir, db } = yield* boot({
            coderModel: "test/coder-model",
            permission: [taskAllow],
          })

          // While the first child's provider turn is in flight, the workspace
          // Coder model changes (host clears/replaces it). The delegation
          // already in flight must keep the snapshot taken at call time.
          yield* llm.tool("coder-task", { task: "first task" })
          yield* llm.pushMatch(
            (hit) => {
              if (hit.body.model !== "coder-model") return false
              // The drizzle driver here is Effect-based: .run() builds an
              // Effect; execute it synchronously (sqlite-node is sync).
              Effect.runSync(
                db
                  .update(WorkspaceV2Table)
                  .set({ coder_model: "test/other-model", time_updated: Date.now() })
                  .where(eq(WorkspaceV2Table.id, workspaceID))
                  .run()
                  .pipe(Effect.orDie),
              )
              return true
            },
            reply().text("done by coder").stop(),
          )
          // A later delegation resolves the NEW Coder model — resolution is
          // per call, never a stale cache of the run start.
          yield* llm.tool("coder-task", { task: "second task" })
          yield* llm.pushMatch(
            (hit) => hit.body.model === "other-model",
            reply().text("second done").stop(),
          )
          yield* llm.text("final answer")

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          expect(result.info.role).toBe("assistant")

          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const delegations = coderTaskParts(msgs, "coder-task")
          expect(delegations).toHaveLength(2)
          const first = delegations[0]
          expect(first).toBeDefined()
          if (!first) return
          expect(first.state.status).toBe("completed")
          if (first.state.status !== "completed") return
          // The snapshot model was used despite the concurrent workspace change.
          expect(first.state.output).toContain("done by coder")
          expect(first.state.metadata?.model).toEqual({
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("coder-model"),
          })
          expect(first.state.metadata?.workspaceID).toBe(workspaceID)
          expect(first.state.metadata?.directory).toBe(dir)
          expect(first.state.metadata?.parentSessionID).toBe(chat.id)
          expect(first.state.metadata?.agent).toBe("coder")
          const firstChildID = first.state.metadata?.childSessionID as SessionID | undefined
          expect(firstChildID).toBeDefined()
          if (!firstChildID) return

          const second = delegations[1]
          expect(second.state.status).toBe("completed")
          if (second.state.status !== "completed") return
          expect(second.state.output).toContain("second done")
          expect(second.state.metadata?.model).toEqual({
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("other-model"),
          })
          const secondChildID = second.state.metadata?.childSessionID as SessionID | undefined
          expect(secondChildID).toBeDefined()
          if (!secondChildID) return

          // Child runs: exactly one hit per snapshot model, never the primary
          // model (a silent fallback would surface as a test-model child hit
          // and the queued child reply would not match).
          const hits = yield* llm.hits
          expect(hits.filter((hit) => hit.body.model === "coder-model")).toHaveLength(1)
          expect(hits.filter((hit) => hit.body.model === "other-model")).toHaveLength(1)
          // The primary itself stayed on the workspace model.
          expect(hits.some((hit) => hit.body.model === "test-model")).toBe(true)

          // Children are real host-created sessions: coder agent, parent link,
          // host-resolved directory, host-composed permissions (parent's task
          // allow is NOT inherited; todo/task delegation is denied for the
          // child so it cannot delegate further).
          const children = yield* sessions.children(chat.id)
          expect(children).toHaveLength(2)
          for (const child of children) {
            expect(child.agent).toBe("coder")
            expect(child.parentID).toBe(chat.id)
            expect(child.title).toBe("Coder task")
            expect(child.metadata?.directory).toBe(dir)
            expect(child.permission).toContainEqual({ permission: "todowrite", pattern: "*", action: "deny" })
            expect(child.permission).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
            expect(
              child.permission?.some(
                (rule) => rule.permission === "task" && rule.pattern === "coder" && rule.action === "allow",
              ),
            ).toBe(false)
          }

          // Child sessions never resolve to master-agent (children are not
          // bindings; they are ordinary sessions under the primary).
          const context = yield* MasterAgentContext.Service
          expect(yield* context.resolve(firstChildID)).toEqual({ status: "not-master-agent" })
          expect(yield* context.resolve(secondChildID)).toEqual({ status: "not-master-agent" })
        }),
      )
    },
    30_000,
  )
})
