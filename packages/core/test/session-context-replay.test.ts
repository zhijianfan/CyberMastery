import { expect, test } from "bun:test"
import path from "path"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols/openai-chat"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionCompactionContext } from "@opencode-ai/core/session/compaction-context"
import { renderContextSidecar } from "@opencode-ai/core/session/context-sidecar"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunner, SessionRunnerLLM } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect, Layer, Stream } from "effect"
import { and, desc, eq } from "drizzle-orm"
import { tmpdir } from "./fixture/tmpdir"

const requests: LLMRequest[] = []
let responses: LLMEvent[][] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const compactModel = Model.make({
  id: "compact-model",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 4_000, output: 50 } }),
})
let activeModel = model
const models = SessionRunnerModel.layerWith(() => Effect.succeed(activeModel))
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const skills = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const references = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)
const completion = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-1" }),
  LLMEvent.textDelta({ id: "text-1", text: "Acknowledged." }),
  LLMEvent.textEnd({ id: "text-1" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const completedText = (id: string, text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const privateRecall = `PRIVATE_RECALL_TOKEN ${"p".repeat(3_000)}`
const enrichedAssembly = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) => {
      if (input.explicitAttachments.length === 0) return Effect.succeed({})
      return renderContextSidecar({
        promptText: input.promptText,
        attachments: input.explicitAttachments.map((item) => ({
          selection: "explicit" as const,
          contextCapsuleID: item.contextCapsuleID,
          sourceCtxPackID: item.source.ctxPackID,
          label: item.label,
          contentHash: item.contentHash,
          fragments: [{ contentHash: "sha256:restart_fragment", text: privateRecall }],
        })),
        recall: { policy: "disabled", status: "disabled" },
        budget: { maximumBytes: 100_000, maximumEstimatedTokens: 25_000 },
        createdAt: 1,
      }).pipe(
        Effect.map((snapshot) => ({ snapshot })),
        Effect.mapError(() => new SessionInput.ContextAttachmentError({ code: "over-budget" })),
      )
    },
  }),
)
const cleanAssembly = Layer.succeed(
  SessionInput.SessionContextAssemblyPortService,
  SessionInput.SessionContextAssemblyPortService.of({
    assemble: (input) =>
      input.explicitAttachments.length === 0 ? Effect.succeed({}) : Effect.die("private assembly used after restart"),
  }),
)
const enrichedReadiness = Layer.succeed(
  SessionContextTransferReadiness.Service,
  SessionContextTransferReadiness.Service.of({ withPermit: (_input, run) => run("v2-enriched") }),
)

const stack = (filename: string, enriched: boolean) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionV2.node,
    ]),
    [
      [Database.node, Database.layerFromPath(filename)],
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SkillGuidance.node, skills],
      [ReferenceGuidance.node, references],
      [Snapshot.node, Snapshot.noopLayer],
      [Config.node, config],
      [SessionExecution.node, SessionExecution.noopLayer],
      [SessionInput.SessionContextAssemblyPort.node, enriched ? enrichedAssembly : cleanAssembly],
      [SessionContextProfile.node, SessionContextProfile.genericNode],
      [
        SessionContextTransferReadiness.node,
        enriched ? enrichedReadiness : SessionContextTransferReadiness.managedNotReadyNode,
      ],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    ],
  )

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
      : [],
  )

test("a fresh runner replays exact V2 API content after reopening the durable session", async () => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "session-context-replay.sqlite")
  const sessionID = SessionV2.ID.make("ses_context_replay")
  requests.length = 0
  activeModel = model
  responses = [completion]

  const admitted = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "context-replay",
        directory: AbsolutePath.make("/project"),
        title: "Context replay",
        version: "test",
      })
      .run()
    const session = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    const first = yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: "Remember the clean prompt" }),
      contextAttachments: [
        {
          contextCapsuleID: "capsule_restart",
          label: "Restart context",
          contentHash: "sha256:restart",
          source: { kind: "ctxpack", ctxPackID: "ctxpk_restart" },
        },
      ],
      resume: false,
    })
    yield* runner.run({ sessionID, force: false })
    const row = yield* db
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.id, first.id))
      .get()
      .pipe(Effect.orDie)
    if (
      row?.context_snapshot_json === null ||
      row?.context_snapshot_json === undefined ||
      "state" in row.context_snapshot_json ||
      row.context_snapshot_json.version !== 2
    )
      return yield* Effect.die("expected persisted V2 sidecar")
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: "Continue after restart" }),
      resume: false,
    })
    return { apiContent: row.context_snapshot_json.apiContent, firstID: first.id }
  }).pipe(Effect.provide(stack(filename, true)), Effect.scoped, Effect.runPromise)

  responses = [completion]
  const visible = await Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const session = yield* SessionV2.Service
    yield* runner.run({ sessionID, force: false })
    return (yield* session.context(sessionID))
      .filter((message): message is SessionMessage.User => message.type === "user")
      .map((message) => ({ id: message.id, text: message.text }))
  }).pipe(Effect.provide(stack(filename, false)), Effect.scoped, Effect.runPromise)

  expect(requests).toHaveLength(2)
  expect(userTexts(requests[0]!)).toEqual([admitted.apiContent])
  expect(userTexts(requests[1]!)).toEqual([admitted.apiContent, "Continue after restart"])
  expect(visible).toEqual([
    { id: admitted.firstID, text: "Remember the clean prompt" },
    expect.objectContaining({ text: "Continue after restart" }),
  ])
})

test("private compaction survives revoked readiness and a file-backed restart", async () => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "session-private-compaction.sqlite")
  const sessionID = SessionV2.ID.make("ses_private_compaction")
  activeModel = model
  requests.length = 0
  responses = [completion]

  const first = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "private-compaction",
        directory: AbsolutePath.make("/project"),
        title: "Private compaction",
        version: "test",
      })
      .run()
    const session = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    const admitted = yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: `EARLY_CLEAN ${"a".repeat(1_000)}` }),
      contextAttachments: [
        {
          contextCapsuleID: "capsule_compaction",
          label: "Private compaction context",
          contentHash: "sha256:compaction",
          source: { kind: "ctxpack", ctxPackID: "ctxpk_compaction" },
        },
      ],
      resume: false,
    })
    yield* runner.run({ sessionID, force: false })
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: `LATEST_CLEAN ${"b".repeat(1_500)}` }),
      resume: false,
    })
    return admitted.id
  }).pipe(Effect.provide(stack(filename, true)), Effect.scoped, Effect.runPromise)

  activeModel = compactModel
  requests.length = 0
  responses = [completedText("private-summary", "## Objective\n- PRIVATE_RECALL_TOKEN preserved"), completion]
  const checkpoint = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    const runner = yield* SessionRunner.Service
    const session = yield* SessionV2.Service
    yield* runner.run({ sessionID, force: false })
    const row = yield* db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(1)
      .get()
      .pipe(Effect.orDie)
    if (!row?.model_context_json) return yield* Effect.die("expected private compaction sidecar")
    const context = yield* SessionCompactionContext.decode(row.model_context_json, row.id)
    return {
      message: (yield* session.context(sessionID)).find(
        (message): message is SessionMessage.Compaction => message.type === "compaction",
      ),
      context,
      publicEvents: yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all(),
      inputRows: yield* db
        .select({ id: SessionInputTable.id })
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .all(),
      messageRows: yield* db
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .all(),
    }
  }).pipe(Effect.provide(stack(filename, false)), Effect.scoped, Effect.runPromise)

  expect(requests).toHaveLength(2)
  expect(userTexts(requests[0]!).join("\n")).toContain("PRIVATE_RECALL_TOKEN")
  expect(checkpoint.message).toMatchObject({
    summary: SessionCompactionContext.SENTINEL,
  })
  expect(checkpoint.message?.recent).toContain("LATEST_CLEAN")
  expect(checkpoint.message?.recent).not.toContain("EARLY_CLEAN")
  expect(checkpoint.context.summary).toBe("## Objective\n- PRIVATE_RECALL_TOKEN preserved")
  expect(checkpoint.context.recent).toContain("LATEST_CLEAN")
  expect(checkpoint.context.recent).not.toContain("EARLY_CLEAN")
  expect(JSON.stringify(checkpoint.publicEvents)).not.toContain("PRIVATE_RECALL_TOKEN")
  expect(JSON.stringify(checkpoint.message)).not.toContain("PRIVATE_RECALL_TOKEN")
  expect(checkpoint.inputRows.map((row) => row.id)).toContain(first)
  expect(checkpoint.messageRows.length).toBeGreaterThan(2)

  activeModel = model
  requests.length = 0
  responses = [completion]
  const visible = await Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: "Continue after private compaction restart" }),
      resume: false,
    })
    yield* runner.run({ sessionID, force: false })
    return yield* session.context(sessionID)
  }).pipe(Effect.provide(stack(filename, false)), Effect.scoped, Effect.runPromise)

  expect(requests).toHaveLength(1)
  expect(userTexts(requests[0]!)).toHaveLength(2)
  expect(userTexts(requests[0]!)[0]).toContain("<summary>\n## Objective\n- PRIVATE_RECALL_TOKEN preserved\n</summary>")
  expect(userTexts(requests[0]!)[1]).toBe("Continue after private compaction restart")
  expect(JSON.stringify(visible)).not.toContain(privateRecall)

  activeModel = compactModel
  requests.length = 0
  responses = [completedText("updated-private-summary", "## Objective\n- Updated private checkpoint"), completion]
  const updated = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    const session = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: `Force repeat private compaction ${"c".repeat(2_500)}` }),
      resume: false,
    })
    yield* runner.run({ sessionID, force: false })
    const row = yield* db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(1)
      .get()
      .pipe(Effect.orDie)
    if (!row?.model_context_json) return yield* Effect.die("expected updated private compaction sidecar")
    return {
      context: yield* SessionCompactionContext.decode(row.model_context_json, row.id),
      message: (yield* session.context(sessionID)).find(
        (message): message is SessionMessage.Compaction => message.type === "compaction",
      ),
    }
  }).pipe(Effect.provide(stack(filename, false)), Effect.scoped, Effect.runPromise)

  expect(requests).toHaveLength(2)
  expect(userTexts(requests[0]!)[0]).toContain(
    "<prior-summary>\n## Objective\n- PRIVATE_RECALL_TOKEN preserved\n</prior-summary>",
  )
  expect(updated.context.summary).toBe("## Objective\n- Updated private checkpoint")
  expect(updated.message).toMatchObject({ summary: SessionCompactionContext.SENTINEL })
  expect(JSON.stringify(updated.message)).not.toContain("PRIVATE_RECALL_TOKEN")
})
