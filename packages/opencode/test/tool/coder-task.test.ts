import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import { Truncate } from "../../src/tool/truncate"
import { it } from "../lib/effect"
import { MessageID, SessionID } from "../../src/session/schema"
import {
  CoderTaskTool,
  Parameters,
  type ChildTaskResult,
  type CoderTaskOps,
  type MasterAgentSessionContext,
} from "../../src/tool/coder-task"
import { Tool } from "../../src/tool/tool"

const FORBIDDEN_ARGUMENTS = [
  "workspaceID",
  "directory",
  "parentSessionID",
  "agent",
  "provider",
  "model",
  "providerID",
  "modelID",
  "permission",
  "permissionOverride",
  "sessionID",
  "blockID",
]

type RunInput = Parameters<CoderTaskOps["run"]>[0]

function makeContext(overrides: Partial<MasterAgentSessionContext> = {}): MasterAgentSessionContext {
  return {
    workspaceID: Workspace.ID.make("wrk_test"),
    blockID: "block-a",
    functionalityInstanceID: "fi_test",
    parentSessionID: SessionID.make("ses_parent"),
    directory: "/tmp/coder",
    primaryModel: { providerID: "primary", modelID: "primary-model" },
    operatingAgent: "build",
    coderModel: { providerID: "coder", modelID: "coder-model" },
    taskPermission: "allow",
    ...overrides,
  }
}

function makeModel(input: { providerID: string; modelID: string; toolcall?: boolean }): Provider.Model {
  const modalities = { text: true, audio: false, image: false, video: false, pdf: false }
  return {
    id: ModelV2.ID.make(input.modelID),
    providerID: ProviderV2.ID.make(input.providerID),
    api: { id: input.modelID, url: "", npm: "" },
    name: input.modelID,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: input.toolcall ?? true,
      input: modalities,
      output: modalities,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  }
}

function makeProvider(models: Provider.Model[]): Provider.Interface {
  const byKey = Object.fromEntries(models.map((model) => [`${model.providerID}/${model.id}`, model]))
  return Provider.Service.of({
    list: () => Effect.succeed({}),
    getProvider: (providerID) => Effect.die(new Error(`getProvider not stubbed: ${providerID}`)),
    getModel: (providerID, modelID) =>
      Effect.gen(function* () {
        const found = byKey[`${providerID}/${modelID}`]
        if (found) return found
        return yield* new Provider.ModelNotFoundError({ providerID, modelID })
      }),
    getLanguage: (model) => Effect.die(new Error(`getLanguage not stubbed: ${model.id}`)),
    closest: () => Effect.succeed(undefined),
    getSmallModel: () => Effect.succeed(undefined),
    defaultModel: () => Effect.die(new Error("defaultModel not stubbed")),
  })
}

function makeAgent(): Agent.Interface {
  const info = (name: string): Agent.Info => ({ name, mode: "primary", permission: [], options: {} })
  return Agent.Service.of({
    get: (name) => Effect.succeed(info(name)),
    list: () => Effect.succeed([info("build")]),
    defaultInfo: () => Effect.succeed(info("build")),
    defaultAgent: () => Effect.succeed("build"),
    generate: () => Effect.succeed({ identifier: "build", whenToUse: "", systemPrompt: "" }),
  })
}

function makeTruncate(): Truncate.Interface {
  return Truncate.Service.of({
    cleanup: () => Effect.void,
    write: (text) => Effect.succeed(text),
    output: (text) => Effect.succeed({ content: text, truncated: false } as const),
    limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
  })
}

const layer = (provider: Provider.Interface) =>
  Layer.mergeAll(
    Layer.succeed(Provider.Service, provider),
    Layer.succeed(Agent.Service, makeAgent()),
    Layer.succeed(Truncate.Service, makeTruncate()),
  )

function makeOps(input: {
  contexts: MasterAgentSessionContext[]
  resolveError?: string
  result?: ChildTaskResult
  runError?: string
}) {
  const resolveCalls: SessionID[] = []
  const runCalls: RunInput[] = []
  let index = 0
  const ops: CoderTaskOps = {
    resolve: (sessionID) =>
      Effect.gen(function* () {
        resolveCalls.push(sessionID)
        if (input.resolveError) return yield* Effect.fail(new Error(input.resolveError))
        const context = input.contexts[Math.min(index, input.contexts.length - 1)]
        index++
        return context
      }),
    run: (call) =>
      Effect.gen(function* () {
        runCalls.push(call)
        if (input.runError) return yield* Effect.fail(new Error(input.runError))
        return input.result ?? { sessionID: SessionID.make("ses_child"), output: "done" }
      }),
  }
  return { ops, resolveCalls, runCalls }
}

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

function makeCtx(input: { ops: CoderTaskOps; ask?: Tool.Context["ask"] }): Tool.Context {
  return {
    ...baseCtx,
    extra: { coderTaskOps: input.ops },
    ask: input.ask ?? (() => Effect.void),
  }
}

function failMessage(exit: Exit.Failure<unknown, never>): string {
  const error = Cause.squash(exit.cause)
  return error instanceof Error ? error.message : String(error)
}

const initTool = Effect.gen(function* () {
  const info = yield* CoderTaskTool
  return yield* Tool.init(info)
})

describe("tool.coder-task", () => {
  it.effect("argument schema exposes only task and context", () =>
    Effect.gen(function* () {
      expect(Object.keys(Parameters.fields)).toEqual(["task", "context"])

      const jsonSchema = ToolJsonSchema.fromSchema(Parameters)
      expect(Object.keys(jsonSchema.properties ?? {})).toEqual(["task", "context"])
      expect(jsonSchema.required).toEqual(["task"])
      for (const forbidden of FORBIDDEN_ARGUMENTS) {
        expect(jsonSchema.properties ?? {}).not.toHaveProperty(forbidden)
      }

      const decoded = Schema.decodeUnknownSync(Parameters)({
        task: "implement the feature",
        model: "model",
        providerID: "provider",
        directory: "/etc",
        workspaceID: "wrk_x",
        parentSessionID: "ses_x",
        agent: "coder",
        permissionOverride: { read: "allow" },
      })
      expect(decoded).toEqual({ task: "implement the feature" })
    }),
  )

  it.effect("exposes the reserved tool id", () =>
    Effect.sync(() => {
      expect(CoderTaskTool.id).toBe("coder-task")
    }),
  )

  it.effect("resolves the host context and runs the child with a snapshot", () =>
    Effect.gen(function* () {
      const { ops, resolveCalls, runCalls } = makeOps({ contexts: [makeContext()] })
      const tool = yield* initTool
      const ctx = makeCtx({ ops })
      const result = yield* tool.execute({ task: "fix the build", context: "see CI log" }, ctx)

      expect(resolveCalls).toEqual([ctx.sessionID])
      expect(runCalls).toEqual([
        {
          parentSessionID: SessionID.make("ses_parent"),
          directory: "/tmp/coder",
          agentID: "coder",
          model: { providerID: "coder", modelID: "coder-model" },
          task: "fix the build",
          context: "see CI log",
        },
      ])
      expect(result.metadata.childSessionID).toBe(SessionID.make("ses_child"))
      expect(result.metadata.parentSessionID).toBe(SessionID.make("ses_parent"))
      expect(result.metadata.model).toEqual({ providerID: "coder", modelID: "coder-model" })
      expect(result.metadata.agent).toBe("coder")
      expect(result.output).toContain(`<coder-task id="ses_child" state="completed">`)
      expect(result.output).toContain("done")
    }).pipe(Effect.provide(layer(makeProvider([makeModel({ providerID: "coder", modelID: "coder-model" })])))),
  )

  it.effect("rejects ordinary or unbound sessions", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({ contexts: [], resolveError: "not a master-agent session" })
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, makeCtx({ ops })).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(failMessage(exit)).toContain("not a master-agent session")
      expect(runCalls).toHaveLength(0)
    }).pipe(Effect.provide(layer(makeProvider([])))),
  )

  it.effect("fails visibly when no Coder model is configured", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({ contexts: [makeContext({ coderModel: null })] })
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, makeCtx({ ops })).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(failMessage(exit)).toContain("not configured")
        expect(failMessage(exit)).toContain("primary model is not used")
      }
      expect(runCalls).toHaveLength(0)
    }).pipe(Effect.provide(layer(makeProvider([])))),
  )

  it.effect("denied task permission blocks delegation host-side", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({ contexts: [makeContext({ taskPermission: "deny" })] })
      const asks: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const tool = yield* initTool
      const exit = yield* tool
        .execute(
          { task: "x" },
          makeCtx({
            ops,
            ask: (request) =>
              Effect.sync(() => {
                asks.push(request)
              }),
          }),
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(failMessage(exit)).toContain("denied")
      expect(asks).toHaveLength(0)
      expect(runCalls).toHaveLength(0)
    }).pipe(Effect.provide(layer(makeProvider([])))),
  )

  it.effect("ask and default permission go through the existing task admission", () =>
    Effect.gen(function* () {
      const tool = yield* initTool
      for (const taskPermission of ["ask", "default"] as const) {
        const { ops, runCalls } = makeOps({ contexts: [makeContext({ taskPermission })] })
        const asks: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
        yield* tool.execute(
          { task: "x" },
          makeCtx({
            ops,
            ask: (request) =>
              Effect.sync(() => {
                asks.push(request)
              }),
          }),
        )
        expect(asks).toHaveLength(1)
        expect(asks[0].permission).toBe("task")
        expect(asks[0].patterns).toContain("coder")
        expect(runCalls).toHaveLength(1)
      }
    }).pipe(Effect.provide(layer(makeProvider([makeModel({ providerID: "coder", modelID: "coder-model" })])))),
  )

  it.effect("fails visibly when the Coder model is unavailable and never falls back", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({
        contexts: [makeContext({ coderModel: { providerID: "missing", modelID: "nope" } })],
      })
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, makeCtx({ ops })).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(failMessage(exit)).toContain("missing/nope is unavailable")
        expect(failMessage(exit)).toContain("primary model was not used")
      }
      expect(runCalls).toHaveLength(0)
    }).pipe(Effect.provide(layer(makeProvider([])))),
  )

  it.effect("fails visibly when the Coder model cannot call tools", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({ contexts: [makeContext()] })
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, makeCtx({ ops })).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(failMessage(exit)).toContain("does not support tool calls")
        expect(failMessage(exit)).toContain("primary model was not used")
      }
      expect(runCalls).toHaveLength(0)
    }).pipe(Effect.provide(layer(makeProvider([makeModel({ providerID: "coder", modelID: "coder-model", toolcall: false })])))),
  )

  it.effect("propagates child runner failures visibly", () =>
    Effect.gen(function* () {
      const { ops } = makeOps({ contexts: [makeContext()], runError: "runner exploded" })
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, makeCtx({ ops })).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(failMessage(exit)).toContain("Coder task failed on coder/coder-model: runner exploded")
    }).pipe(Effect.provide(layer(makeProvider([makeModel({ providerID: "coder", modelID: "coder-model" })])))),
  )

  it.effect("snapshots the Coder model per execution so later children use the new model", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({
        contexts: [
          makeContext({ coderModel: { providerID: "coder", modelID: "v1" } }),
          makeContext({ coderModel: { providerID: "coder", modelID: "v2" } }),
        ],
      })
      const tool = yield* initTool
      yield* tool.execute({ task: "first" }, makeCtx({ ops }))
      yield* tool.execute({ task: "second" }, makeCtx({ ops }))

      expect(runCalls.map((call) => call.model)).toEqual([
        { providerID: "coder", modelID: "v1" },
        { providerID: "coder", modelID: "v2" },
      ])
      expect(runCalls.map((call) => call.task)).toEqual(["first", "second"])
    }).pipe(
      Effect.provide(
        layer(
          makeProvider([
            makeModel({ providerID: "coder", modelID: "v1" }),
            makeModel({ providerID: "coder", modelID: "v2" }),
          ]),
        ),
      ),
    ),
  )

  it.effect("ignores host-selected fields smuggled through tool arguments", () =>
    Effect.gen(function* () {
      const { ops, runCalls } = makeOps({ contexts: [makeContext()] })
      const tool = yield* initTool
      const junk = {
        task: "legitimate",
        model: { providerID: "evil", modelID: "evil-model" },
        providerID: "evil",
        directory: "/evil",
        workspaceID: "wrk_evil",
        parentSessionID: "ses_evil",
        agent: "evil",
        permissionOverride: { read: "allow" },
      } as unknown as Schema.Schema.Type<typeof Parameters>

      yield* tool.execute(junk, makeCtx({ ops }))

      expect(runCalls).toHaveLength(1)
      expect(runCalls[0].task).toBe("legitimate")
      expect(runCalls[0].model).toEqual({ providerID: "coder", modelID: "coder-model" })
      expect(runCalls[0].directory).toBe("/tmp/coder")
      expect(runCalls[0].parentSessionID).toBe(SessionID.make("ses_parent"))
      expect(runCalls[0].agentID).toBe("coder")
    }).pipe(Effect.provide(layer(makeProvider([makeModel({ providerID: "coder", modelID: "coder-model" })])))),
  )

  it.effect("fails visibly when the host has not wired Coder ops", () =>
    Effect.gen(function* () {
      const tool = yield* initTool
      const exit = yield* tool.execute({ task: "x" }, { ...baseCtx, ask: () => Effect.void }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(failMessage(exit)).toContain("coderTaskOps")
    }).pipe(Effect.provide(layer(makeProvider([])))),
  )
})
