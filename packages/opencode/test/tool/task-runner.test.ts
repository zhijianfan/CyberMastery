import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import {
  makeTaskRunner,
  type ChildTaskRunner,
  type ModelSelection,
  type TaskRunnerEnv,
  type TaskRunnerOps,
} from "../../src/tool/task-runner"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      Config.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      SessionRunState.node,
      SessionStatus.node,
      Truncate.node,
      ToolRegistry.node,
      Database.node,
      RuntimeFlags.node,
      Ripgrep.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const it = testEffect(layer())

const seed = Effect.fn("TaskRunnerTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskRunnerOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

const runnerEnv: Effect.Effect<
  TaskRunnerEnv,
  never,
  Agent.Service | Session.Service | Config.Service | Database.Service
> = Effect.gen(function* () {
  const agent = yield* Agent.Service
  const sessions = yield* Session.Service
  const config = yield* Config.Service
  const database = yield* Database.Service
  return { agent, sessions, config, database }
})

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

const coderConfig = {
  config: {
    agent: {
      coder: {
        description: "Coder agent",
        mode: "subagent" as const,
      },
    },
  },
}

// The trusted input shape is frozen: only host-resolved fields, no
// model-visible argument smuggling surface.
const trustedShape = {
  parentSessionID: SessionID.make("ses_parent"),
  directory: "/tmp/coder",
  agentID: "coder",
  model: { providerID: "test", modelID: "coder-model" },
  task: "fix the build",
} satisfies Parameters<ChildTaskRunner["runTrusted"]>[0]

const coderModel: ModelSelection = { providerID: "test", modelID: "coder-model" }

describe("tool.task-runner", () => {
  it.instance(
    "runTrusted creates a child coder session linked to the parent with the trusted context",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat } = yield* seed()
        let seen: SessionPrompt.PromptInput | undefined
        const runner = makeTaskRunner(
          stubOps({ onPrompt: (input) => (seen = input) }),
          yield* runnerEnv,
        )

        const result = yield* runner.runTrusted({
          parentSessionID: chat.id,
          directory: "/tmp/coder",
          agentID: "coder",
          model: coderModel,
          task: "fix the build",
          context: "see CI log",
        })

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        const child = kids[0]
        if (!child) throw new Error("child session not created")
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("coder")
        expect(child.metadata).toEqual({ directory: "/tmp/coder" })
        // Default subagent denies for task and todowrite are applied.
        expect(child.permission).toEqual([
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
        ])

        expect(result.sessionID).toBe(child.id)
        expect(result.output).toBe("done")

        expect(seen?.sessionID).toBe(child.id)
        expect(seen?.agent).toBe("coder")
        expect(seen?.model).toEqual({
          providerID: ProviderV2.ID.make("test"),
          modelID: ModelV2.ID.make("coder-model"),
        })
        expect(seen?.variant).toBeUndefined()
        // Prompt parts carry the task plus the trusted context as separate text.
        expect(seen?.parts).toEqual([
          { type: "text", text: "fix the build" },
          { type: "text", text: "see CI log" },
        ])
      }),
    coderConfig,
    { timeout: 20_000 },
  )

  it.instance("runTrusted uses the host-resolved model and never the parent message model", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      let seen: SessionPrompt.PromptInput | undefined
      const runner = makeTaskRunner(stubOps({ onPrompt: (input) => (seen = input) }), yield* runnerEnv)

      yield* runner.runTrusted({
        parentSessionID: chat.id,
        directory: "/tmp",
        agentID: "coder",
        model: { providerID: "test", modelID: "host-model" },
        task: "fix the build",
      })

      expect(seen?.model).toEqual({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("host-model"),
      })
      expect(seen?.variant).toBeUndefined()
      // The parent assistant message carries the ref model; it must not leak in.
      expect(seen?.model).not.toEqual({ providerID: ref.providerID, modelID: ref.modelID })
      expect(assistant.id).toBeDefined()
    }),
    coderConfig,
  )

  it.instance("prepareChild inherits the parent assistant model and variant when the agent has none", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const runner = makeTaskRunner(stubOps(), yield* runnerEnv)

      const prepared = yield* runner.prepareChild({
        parentSessionID: chat.id,
        parentMessageID: assistant.id,
        agentID: "general",
        title: "inspect bug (@general subagent)",
      })

      const sessions = yield* Session.Service
      const child = yield* sessions.get(prepared.sessionID)
      expect(child.parentID).toBe(chat.id)
      expect(child.agent).toBe("general")
      expect(prepared.model).toEqual({ providerID: "test", modelID: "test-model" })
      expect(prepared.variant).toBe("xhigh")
      expect(prepared.parentVariant).toBe("xhigh")
    }),
  )

  it.instance("prepareChild prefers the agent's configured model over the parent message", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const runner = makeTaskRunner(stubOps(), yield* runnerEnv)

      const prepared = yield* runner.prepareChild({
        parentSessionID: chat.id,
        parentMessageID: assistant.id,
        agentID: "general",
        title: "inspect bug (@general subagent)",
      })

      expect(prepared.model).toEqual({ providerID: "test", modelID: "agent-model" })
      expect(prepared.variant).toBeUndefined()
      expect(prepared.parentVariant).toBe("xhigh")
    }),
    {
      config: {
        agent: {
          general: {
            mode: "subagent",
            model: "test/agent-model",
          },
        },
      },
    },
  )

  it.instance("prepareChild resumes an existing child session from taskID", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const runner = makeTaskRunner(stubOps(), yield* runnerEnv)

      const prepared = yield* runner.prepareChild({
        parentSessionID: chat.id,
        parentMessageID: MessageID.ascending(),
        agentID: "general",
        title: "resume",
        taskID: child.id,
        model: coderModel,
      })

      expect(prepared.sessionID).toBe(child.id)
      expect(yield* sessions.children(chat.id)).toHaveLength(1)
    }),
  )

  it.instance("prepareChild fails for unknown agents without creating a session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const runner = makeTaskRunner(stubOps(), yield* runnerEnv)

      const exit = yield* runner
        .prepareChild({
          parentSessionID: chat.id,
          parentMessageID: assistant.id,
          agentID: "nope",
          title: "nope",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error ? error.message : String(error)).toContain("Unknown agent type: nope")
      }
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )

  it.instance("runPrompt appends the trusted context and returns the last text part", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const seen: SessionPrompt.PromptInput[] = []
      const runner = makeTaskRunner(
        stubOps({
          text: "final answer",
          onPrompt: (input) => seen.push(input),
        }),
        yield* runnerEnv,
      )

      const text = yield* runner.runPrompt({
        sessionID: chat.id,
        agentName: "coder",
        model: coderModel,
        prompt: "task prompt",
        context: "extra context",
      })

      expect(text).toBe("final answer")
      expect(seen[0]?.parts).toEqual([
        { type: "text", text: "task prompt" },
        { type: "text", text: "extra context" },
      ])
      expect(assistant.id).toBeDefined()
    }),
  )

  it.instance("runTrusted propagates child prompt failures", () =>
    Effect.gen(function* () {
      const { chat } = yield* seed()
      const runner = makeTaskRunner(
        {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: () => Effect.fail(new Error("provider down")),
        },
        yield* runnerEnv,
      )

      const exit = yield* runner
        .runTrusted({
          parentSessionID: chat.id,
          directory: "/tmp",
          agentID: "coder",
          model: coderModel,
          task: "fix the build",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error ? error.message : String(error)).toContain("provider down")
      }
    }),
    coderConfig,
  )

  it.instance("interrupting runTrusted interrupts the child prompt", () =>
    Effect.gen(function* () {
      const { chat } = yield* seed()
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const runner = makeTaskRunner(
        {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              return yield* Effect.never
            }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
        },
        yield* runnerEnv,
      )

      const fiber = yield* runner
        .runTrusted({
          parentSessionID: chat.id,
          directory: "/tmp",
          agentID: "coder",
          model: coderModel,
          task: "fix the build",
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(interrupted)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.hasInterrupts(exit)).toBe(true)
    }),
    coderConfig,
  )

  it.instance("TaskTool and the trusted runner create equivalent children for the same request", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps: TaskPromptOps = stubOps()

      const toolResult = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "coder",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const runner = makeTaskRunner(stubOps(), yield* runnerEnv)
      const runnerResult = yield* runner.runTrusted({
        parentSessionID: chat.id,
        directory: "/tmp/coder",
        agentID: "coder",
        model: coderModel,
        task: "look into the cache key path",
      })

      const toolChild = yield* sessions.get(toolResult.metadata.sessionId)
      const runnerChild = yield* sessions.get(runnerResult.sessionID)
      expect(toolChild.parentID).toBe(chat.id)
      expect(runnerChild.parentID).toBe(chat.id)
      expect(toolChild.agent).toBe("coder")
      expect(runnerChild.agent).toBe("coder")
      expect(toolChild.permission).toEqual(runnerChild.permission)
      expect(toolResult.output).toContain(`<task id="${toolChild.id}" state="completed">`)
      expect(toolResult.output).toContain("done")
      expect(runnerResult.output).toBe("done")
      expect(trustedShape).toBeDefined()
    }),
    coderConfig,
  )
})
