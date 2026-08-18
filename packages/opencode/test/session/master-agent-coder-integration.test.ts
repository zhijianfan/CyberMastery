import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
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
import { MasterAgentContext } from "../../src/session/master-agent-context"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

// Track R6 — Coder host integration tests.
//
// Drives the real prompt pipeline (SessionPrompt loop + SessionTools + R2
// policy) with a fake MasterAgentContext source, so the resolver's binding
// state is scripted per test while every other service is the production one.
// The reserved "coder" agent is the real registry entry from agent.ts; the
// coder-task tool is the real R5 tool executing against the real task runner.

const workspaceID = Workspace.ID.make("wrk_coder_test")
const blockID = "block-coder-1"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const taskAllow: PermissionV1.Rule = { permission: "task", pattern: "coder", action: "allow" }
const taskDeny: PermissionV1.Rule = { permission: "task", pattern: "coder", action: "deny" }

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
])

// Scripted host state for the resolver source. `sessionID` is assigned after
// the real session is created; the fake then treats that session as the bound
// MasterAgent primary and every other session (the child) as not-master-agent.
type CoderHostState = {
  sessionID?: SessionID
  coderModel: string | null
  permission: PermissionV1.Ruleset
  bound: boolean
}

function makeSource(state: CoderHostState): MasterAgentContext.MasterAgentContextSource {
  return {
    session: (sessionID) =>
      Effect.succeed({
        workspaceID,
        parentID: state.sessionID === undefined || sessionID === state.sessionID ? undefined : state.sessionID,
        permission: state.permission,
      }),
    workspace: () =>
      Effect.succeed({
        model: "test/test-model",
        // R1's WorkspaceRecord still types coderModel as `string | undefined`
        // while the workspace service (D4) returns `string | null`; the host
        // state is null-meaning-disabled, so keep the value and cast.
        coderModel: state.coderModel as string | undefined,
        directories: ["/work/a"],
      }),
    // The owned binding is resolved lazily so it always references the
    // session the test assigned to the state before the prompt ran.
    instances: () =>
      Effect.succeed(
        state.bound && state.sessionID
          ? [
              {
                instanceID: "instance-coder-1",
                blockID,
                revision: 1,
                configuration: {
                  version: 1,
                  directoryBinding: { mode: "workspace-primary" as const },
                  sessionBinding: { mode: "owned" as const, sessionID: state.sessionID, generation: 0 },
                },
              },
            ]
          : [],
      ),
  }
}

function fakeMasterAgentLayer(source: MasterAgentContext.MasterAgentContextSource) {
  return Layer.effect(
    MasterAgentContext.Service,
    Effect.gen(function* () {
      const src = yield* MasterAgentContext.Source
      return MasterAgentContext.Service.of(MasterAgentContext.makeResolver(src))
    }),
  ).pipe(Layer.provideMerge(Layer.succeed(MasterAgentContext.Source, MasterAgentContext.Source.of(source))))
}

function harness(state: CoderHostState) {
  return LayerNode.compile(
    LayerNode.group([promptRoot, testLLMServerNode]),
    [
      [SessionSummary.node, summary],
      [LSP.node, lsp],
      [MCP.node, makeMcp()],
      [RuntimeFlags.node, runtimeFlags],
      [MasterAgentContext.node, fakeMasterAgentLayer(makeSource(state))],
    ],
  )
}

function run<A, E>(state: CoderHostState, body: Effect.Effect<A, E, any>): Promise<A> {
  // The provided layer covers every service requirement; the cast only
  // discharges the generic requirement subtraction.
  return Effect.runPromise(
    body.pipe(
      withTmpdirInstance(),
      Effect.scoped,
      Effect.provide(harness(state)),
    ) as Effect.Effect<A, E, never>,
  )
}

// Last assistant message, narrowed so `.info.error` is typed.
function lastAssistant(msgs: SessionV1.WithParts[]) {
  return msgs.findLast(
    (m): m is SessionV1.WithParts & { info: SessionV1.Assistant } => m.info.role === "assistant",
  )
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
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
        },
        options: {
          apiKey: "test-api-key",
          baseURL: url,
        },
      },
    },
  }
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
}

// Boot a primary session with the given permission, wire the fake host state
// to it, point the provider at the LLM server, and return the handles.
const boot = Effect.fn("test.coder.boot")(function* (input: {
  coderModel: string | null
  permission: PermissionV1.Ruleset
  bound?: boolean
}) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...cfg(llm.url) }))
  yield* config.get()
  const chat = yield* sessions.create({ title: "Coder primary", permission: input.permission })
  return { prompt, sessions, chat, llm, dir }
})

function coderTaskPart(msgs: SessionV1.WithParts[], tool: string) {
  for (const msg of msgs) {
    const part = msg.parts.find((p) => p.type === "tool" && p.tool === tool)
    if (part) return part as SessionV1.ToolPart
  }
  return undefined
}

const fresh = (coderModel: string | null, permission: PermissionV1.Ruleset = [], bound = true): CoderHostState => ({
  coderModel,
  permission,
  bound,
})

describe("MasterAgent Coder host integration", () => {
  test(
    "enabled mode removes direct mutation tools from the primary tool set",
    async () => {
      const state = fresh("test/coder-model", [taskAllow])
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm } = yield* boot({ coderModel: state.coderModel, permission: state.permission })
          state.sessionID = chat.id
          yield* llm.tool("edit", { filePath: "a.ts", oldString: "a", newString: "b" })
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          // The edit call is rejected: the strict Coder policy removed it. The
          // SDK routes the call to the built-in "invalid" tool, whose input
          // carries the unavailable-tool error and the effective tool list.
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const invalid = coderTaskPart(msgs, "invalid")
          expect(invalid).toBeDefined()
          if (!invalid) return
          const tool = completedTool([invalid])
          if (!tool) return
          const input = tool.state.input as { tool?: string; error?: string }
          expect(input.tool).toBe("edit")
          expect(input.error).toContain("unavailable tool 'edit'")
          // The effective list proves coder-task was injected while direct
          // mutation and unrestricted shell tools were removed.
          const available = (input.error?.split("Available tools: ")[1] ?? "").split(",").map((s) => s.trim())
          expect(available).toContain("coder-task")
          expect(available).not.toContain("edit")
          expect(available).not.toContain("write")
          expect(available).not.toContain("apply_patch")
          expect(available).not.toContain("bash")
          expect(available).not.toContain("execute")
          // No child session was created and nothing was written.
          expect(yield* sessions.children(chat.id)).toHaveLength(0)
          const hits = yield* llm.hits
          expect(hits.filter((hit) => hit.body.model === "coder-model")).toHaveLength(0)
          expect(result.info.role).toBe("assistant")
        }),
      )
    },
    30_000,
  )

  test(
    "task permission denial hides the coder-task tool",
    async () => {
      const state = fresh("test/coder-model", [taskDeny])
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm } = yield* boot({ coderModel: state.coderModel, permission: state.permission })
          state.sessionID = chat.id
          yield* llm.tool("coder-task", { task: "implement the thing" })
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const invalid = coderTaskPart(msgs, "invalid")
          expect(invalid).toBeDefined()
          if (!invalid) return
          const tool = completedTool([invalid])
          if (!tool) return
          const input = tool.state.input as { tool?: string; error?: string }
          expect(input.tool).toBe("coder-task")
          expect(input.error).toContain("unavailable tool 'coder-task'")
          // The denied coder-task tool is absent from the effective list.
          const available = (input.error?.split("Available tools: ")[1] ?? "").split(",").map((s) => s.trim())
          expect(available).not.toContain("coder-task")
          // Denied delegation must never create a child session.
          expect(yield* sessions.children(chat.id)).toHaveLength(0)
          expect(result.info.role).toBe("assistant")
        }),
      )
    },
    30_000,
  )

  test(
    "ordinary sessions keep the full tool set",
    async () => {
      const state = fresh("test/coder-model", [], false)
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm, dir } = yield* boot({
            coderModel: state.coderModel,
            permission: state.permission,
            bound: false,
          })
          state.sessionID = chat.id
          yield* writeText(path.join(dir, "a.txt"), "hello")
          yield* llm.tool("edit", { filePath: path.join(dir, "a.txt"), oldString: "hello", newString: "world" })
          yield* llm.text("done")
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const match = coderTaskPart(msgs, "edit")
          expect(match).toBeDefined()
          if (!match) return
          const tool = completedTool([match])
          if (!tool) return
          expect(tool.state.output).toContain("Edit applied successfully")
          expect(lastAssistant(msgs)?.info.error).toBeUndefined()
        }),
      )
    },
    30_000,
  )

  test(
    "disabled MasterAgent mode keeps the full tool set and no coder-task",
    async () => {
      const state = fresh(null, [taskAllow])
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm, dir } = yield* boot({ coderModel: null, permission: state.permission })
          state.sessionID = chat.id
          yield* writeText(path.join(dir, "a.txt"), "hello")
          yield* llm.tool("edit", { filePath: path.join(dir, "a.txt"), oldString: "hello", newString: "world" })
          yield* llm.text("done")
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const edit = coderTaskPart(msgs, "edit")
          expect(edit).toBeDefined()
          if (!edit) return
          const tool = completedTool([edit])
          if (!tool) return
          expect(tool.state.output).toContain("Edit applied successfully")
          expect(coderTaskPart(msgs, "coder-task")).toBeUndefined()
          expect(lastAssistant(msgs)?.info.error).toBeUndefined()
        }),
      )
    },
    30_000,
  )

  test(
    "coder-task delegates to a child session on the workspace Coder model",
    async () => {
      const state = fresh("test/coder-model", [taskAllow])
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm } = yield* boot({
            coderModel: state.coderModel,
            permission: state.permission,
          })
          state.sessionID = chat.id
          yield* llm.tool("coder-task", { task: "implement the thing" })
          yield* llm.pushMatch((hit) => hit.body.model === "coder-model", reply().text("done by coder").stop())
          yield* llm.text("final answer")
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          expect(result.info.role).toBe("assistant")

          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const match = coderTaskPart(msgs, "coder-task")
          expect(match).toBeDefined()
          if (!match) return
          const tool = completedTool([match])
          if (!tool) return

          // The child ran on the workspace Coder model, never the primary model.
          const hits = yield* llm.hits
          expect(hits.filter((hit) => hit.body.model === "coder-model")).toHaveLength(1)
          expect(tool.state.output).toContain("done by coder")
          expect(tool.state.metadata?.model).toEqual({
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("coder-model"),
          })

          // The child session is a real "coder" agent session under the primary.
          const childSessionID = tool.state.metadata?.childSessionID as SessionID | undefined
          expect(childSessionID).toBeDefined()
          if (!childSessionID) return
          const child = yield* sessions.get(childSessionID)
          expect(child.agent).toBe("coder")
          expect(child.parentID).toBe(chat.id)
          expect(child.title).toBe("Coder task")
        }),
      )
    },
    30_000,
  )

  test(
    "unavailable Coder model fails visibly without falling back to the primary model",
    async () => {
      const state = fresh("test/missing-model", [taskAllow])
      await run(
        state,
        Effect.gen(function* () {
          const { prompt, sessions, chat, llm } = yield* boot({
            coderModel: state.coderModel,
            permission: state.permission,
          })
          state.sessionID = chat.id
          yield* llm.tool("coder-task", { task: "implement the thing" })
          yield* llm.text("done")
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            model: ref,
            parts: [{ type: "text", text: "hello" }],
          })
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const match = coderTaskPart(msgs, "coder-task")
          expect(match).toBeDefined()
          if (!match) return
          const tool = errorTool([match])
          if (!tool) return
          expect(tool.state.error).toContain("unavailable")
          expect(tool.state.error).toContain("primary model was not used")
          // No child session was spawned with any model.
          expect(yield* sessions.children(chat.id)).toHaveLength(0)
          const hits = yield* llm.hits
          expect(hits.filter((hit) => hit.body.model === "coder-model")).toHaveLength(0)
          expect(lastAssistant(msgs)?.info.error).toBeUndefined()
        }),
      )
    },
    30_000,
  )
})
