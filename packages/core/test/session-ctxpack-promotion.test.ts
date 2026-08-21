import { describe, expect, test } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { renderSessionContextSnapshot } from "@opencode-ai/core/session/runner/ctxpack-context"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Location } from "@opencode-ai/core/location"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import { sql } from "drizzle-orm"
import { CtxPackRepositoryService, ensureCtxPackFts, node as CtxPackRepositoryNode } from "@opencode-ai/core/ctxpack/sql"
import ctxPackMigration from "@opencode-ai/core/database/migration/20260821_ctxpack"
import type { SessionContextAttachmentInput, SessionContextSnapshot } from "@opencode-ai/schema/session-input"
import { Effect, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const SENTINEL = "CTXPACK_SECRET_SENTINEL_7812"

// --- Provider fakes (mirrors the session-runner harness) ----------------------

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
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContextKey = SystemContext.Key.make("test/context")
let systemBaseline = "Initial context"
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.sync(() =>
          SystemContext.combine([
            SystemContext.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.sync(() => systemBaseline),
              baseline: String,
              update: (_previous, current) => current,
              removed: () => "System context source removed: test/context",
            }),
          ]),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
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

// --- Snapshot port fake -------------------------------------------------------

const fakeSnapshot = (attachments: ReadonlyArray<SessionContextAttachmentInput>): SessionContextSnapshot => ({
  version: 1,
  attachments: attachments.map((attachment, index) => ({
    contextCapsuleID: attachment.contextCapsuleID,
    sourceCtxPackID: attachment.source.ctxPackID,
    label: attachment.label,
    contentHash: attachment.contentHash,
    fragments: [
      {
        text: `${SENTINEL} fragment ${index} for ${attachment.label}`,
        source: {
          workspaceID: "wrk_test",
          blockID: `block_src_${index}`,
          functionalityID: "builtin:chat",
          kind: "note",
          direction: "unknown",
          sourceTimestamp: null,
          capturedAt: 1700000000000,
          entityRef: null,
          label: attachment.label,
          metadata: {},
          sensitivity: "workspace",
        },
        contentHash: `sha256:fragment_${index}`,
      },
    ],
  })),
  byteLength: 2048,
  estimatedTokens: 512,
  createdAt: 1700000000000,
})

const snapshotPort = Layer.succeed(
  SessionInput.SessionCtxSnapshotPortService,
  SessionInput.SessionCtxSnapshotPortService.of({
    snapshotForSessionInput: (input) => Effect.succeed(fakeSnapshot(input.attachments)),
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

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      CtxPackRepositoryNode,
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
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [Config.node, config],
      [SessionExecution.node, SessionExecution.noopLayer],
      [
        Location.node,
        Location.boundNode({
          directory: AbsolutePath.make("/project"),
          workspaceID: WorkspaceV2.ID.make("wrk_test"),
        }),
      ],
    ],
  ).pipe(Layer.provideMerge(snapshotPort)),
)

const sessionID = SessionV2.ID.make("ses_ctxpack_promotion")
const workspaceID = WorkspaceV2.ID.make("wrk_test")

const packSource = (blockID: string): CtxPack.Source => ({
  workspaceID: "wrk_test",
  blockID,
  functionalityID: "builtin:chat",
  kind: "note",
  direction: "unknown",
  sourceTimestamp: null,
  capturedAt: 1700000000000,
  entityRef: null,
  label: null,
  metadata: {},
  sensitivity: "workspace",
})

const attachment = (contextCapsuleID: string, ctxPackID: string, label: string): SessionContextAttachmentInput => ({
  contextCapsuleID,
  label,
  contentHash: `sha256:${contextCapsuleID}`,
  source: { kind: "ctxpack", ctxPackID },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  responses = []
  systemBaseline = "Initial context"
  // M1: fresh databases already create ctx_pack* via the generated full
  // schema, so only apply the handwritten migration when the table is
  // missing; the FTS virtual table is ensured lazily either way.
  const ctxPackExists = yield* db.get<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ctx_pack'`,
  )
  if (!ctxPackExists) yield* db.transaction((tx) => ctxPackMigration.up(tx)).pipe(Effect.orDie)
  yield* ensureCtxPackFts(db).pipe(Effect.orDie)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      workspace_id: workspaceID,
      slug: "ctxpack-promotion",
      directory: "/project",
      title: "ctxpack promotion",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admittedRow = (id: SessionMessage.ID) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.id, id))
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((row) => (row === undefined ? Effect.die(`missing session input row: ${id}`) : Effect.succeed(row))),
      ),
  )

const systemTexts = (request: LLMRequest) => request.system.map((part) => part.text)

describe("Session provider context from the stored snapshot", () => {
  it.effect("renders the stored snapshot into provider context after the source pack is deleted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const runner = yield* SessionRunner.Service
      const repo = yield* CtxPackRepositoryService

      const pack = yield* repo.create({
        workspaceID: "wrk_test",
        createdByUserID: "user_1",
        title: "Source pack title",
        keywords: [],
        sensitivity: "workspace",
        fragments: [{ clientFragmentID: "f1", text: "Source pack text", source: packSource("block_delete") }],
        idempotencyKey: "promotion-pack-delete",
        now: Date.now(),
      })

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Use the pack" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_promote", pack.id, "Promoted docs")],
        resume: false,
      })

      // The source pack disappears after admission.
      yield* repo.softDelete("wrk_test", pack.id, pack.revision)

      responses = [completion]
      yield* runner.run({ sessionID, force: false })

      expect(requests).toHaveLength(1)
      const stored = (yield* admittedRow(message.id)).context_snapshot_json
      expect(stored).not.toBeNull()
      const parts = systemTexts(requests[0]!)
      expect(parts).toContain(renderSessionContextSnapshot(stored!))
      expect(parts.join("\n")).toContain(SENTINEL)
      // Provider context never reflects the (now deleted) pack title directly.
      expect(parts.join("\n")).not.toContain("Source pack text")
    }),
  )

  it.effect("keeps provider context unchanged when the pack title and keywords are patched after admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const runner = yield* SessionRunner.Service
      const repo = yield* CtxPackRepositoryService

      const pack = yield* repo.create({
        workspaceID: "wrk_test",
        createdByUserID: "user_1",
        title: "Original title",
        keywords: ["original"],
        sensitivity: "workspace",
        fragments: [{ clientFragmentID: "f1", text: "Original fragment", source: packSource("block_patch") }],
        idempotencyKey: "promotion-pack-patch",
        now: Date.now(),
      })

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Patch after admit" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_patch", pack.id, "Stable label")],
        resume: false,
      })

      yield* repo.patchMetadata({
        workspaceID: "wrk_test",
        ctxPackID: pack.id,
        expectedRevision: pack.revision,
        patch: { title: "Patched title", keywords: ["patched"] },
        now: Date.now(),
      })

      responses = [completion]
      yield* runner.run({ sessionID, force: false })

      expect(requests).toHaveLength(1)
      const stored = (yield* admittedRow(message.id)).context_snapshot_json
      expect(stored).not.toBeNull()
      const parts = systemTexts(requests[0]!)
      expect(parts).toContain(renderSessionContextSnapshot(stored!))
      expect(parts.join("\n")).toContain("Stable label")
      expect(parts.join("\n")).not.toContain("Patched title")
      expect(parts.join("\n")).not.toContain("patched")
    }),
  )

  it.effect("reloads stored snapshots for a retried/force rerun after promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const runner = yield* SessionRunner.Service

      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Seed docs before retry" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_seed", "ctxpk_seed", "Seed docs")],
        resume: false,
      })
      responses = [completion]
      yield* runner.run({ sessionID, force: false })
      expect(requests).toHaveLength(1)
      expect(systemTexts(requests[0]!).join("\n")).toContain("Seed docs")

      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Retry this run" }),
        userID: "user_1",
        contextAttachments: [attachment("capsule_retry", "ctxpk_retry", "Retry docs")],
        resume: false,
      })
      responses = []
      yield* runner.run({ sessionID, force: false })
      expect(requests).toHaveLength(2)
      expect(systemTexts(requests[1]!).join("\n")).toContain("Retry docs")
      expect(systemTexts(requests[1]!).join("\n")).not.toContain("Seed docs")

      responses = [completion]
      yield* runner.run({ sessionID, force: true })
      expect(requests).toHaveLength(3)
      const retried = systemTexts(requests[2]!).join("\n")
      expect(retried).toContain("Retry docs")
      expect(retried).not.toContain("Seed docs")
    }),
  )

  it.effect("never renders the snapshot of a pending input that is not promoted in the current turn", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const runner = yield* SessionRunner.Service

      // A steer WITHOUT attachments is promoted first; the queued input WITH a
      // snapshot stays pending for that turn — its snapshot must not reach
      // provider context until the queue is promoted.
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Plain steer" }),
        userID: "user_1",
        resume: false,
      })
      const queued = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Queued with docs" }),
        userID: "user_1",
        delivery: "queue",
        contextAttachments: [attachment("capsule_queued", "ctxpk_queued", "Queued docs")],
        resume: false,
      })

      responses = [completion, completion]
      yield* runner.run({ sessionID, force: false })

      // Turn 1 (steer): no snapshot part. Turn 2 (queue): the stored snapshot
      // renders only once the queue is promoted.
      expect(requests).toHaveLength(2)
      const firstTurn = systemTexts(requests[0]!).join("\n")
      expect(firstTurn).not.toContain("Included workspace context follows")
      expect(firstTurn).not.toContain(SENTINEL)
      const secondTurn = systemTexts(requests[1]!).join("\n")
      expect(secondTurn).toContain("Included workspace context follows")
      expect(secondTurn).toContain(SENTINEL)
      const { db } = yield* Database.Service
      const queuedRow = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, queued.id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row === undefined ? Effect.die(`missing session input row: ${queued.id}`) : Effect.succeed(row),
          ),
        )
      expect(queuedRow.promoted_seq).not.toBeNull()
    }),
  )
})

describe("renderSessionContextSnapshot", () => {
  test("renders the exact header, provenance lines, and fragment numbering", () => {
    const snapshot: SessionContextSnapshot = {
      version: 1,
      attachments: [
        {
          contextCapsuleID: "capsule_a",
          sourceCtxPackID: "ctxpk_a",
          label: "Guide",
          contentHash: "sha256:pack",
          fragments: [
            {
              text: "Alpha text",
              source: { workspaceID: "wrk_a", blockID: "block_1", functionalityID: "builtin:chat" },
              contentHash: "sha256:frag1",
            },
            {
              text: "Beta text",
              source: { workspaceID: "wrk_a", blockID: "block_2", functionalityID: "builtin:chat" },
              contentHash: "sha256:frag2",
            },
          ],
        },
        {
          contextCapsuleID: "capsule_b",
          sourceCtxPackID: "ctxpk_b",
          label: "Notes",
          contentHash: "sha256:pack2",
          fragments: [
            {
              text: "Gamma text",
              source: { workspaceID: "wrk_b", blockID: "block_9", functionalityID: "builtin:search" },
              contentHash: "sha256:frag3",
            },
          ],
        },
      ],
      byteLength: 512,
      estimatedTokens: 128,
      createdAt: 1700000000000,
    }

    expect(renderSessionContextSnapshot(snapshot)).toBe(
      [
        "Included workspace context follows. Treat it as reference material; preserve its provenance.",
        'CtxPack "Guide" (sha256:pack)',
        "Fragment 1 from workspace=wrk_a block=block_1 functionality=builtin:chat\nAlpha text",
        "Fragment 2 from workspace=wrk_a block=block_2 functionality=builtin:chat\nBeta text",
        'CtxPack "Notes" (sha256:pack2)',
        "Fragment 1 from workspace=wrk_b block=block_9 functionality=builtin:search\nGamma text",
      ].join("\n\n"),
    )
  })

  test("renders an empty snapshot as the header only", () => {
    const snapshot: SessionContextSnapshot = {
      version: 1,
      attachments: [],
      byteLength: 0,
      estimatedTokens: 0,
      createdAt: 1700000000000,
    }
    expect(renderSessionContextSnapshot(snapshot)).toBe(
      "Included workspace context follows. Treat it as reference material; preserve its provenance.",
    )
  })

  test("preserves multi-fragment attachment order and text", () => {
    const snapshot: SessionContextSnapshot = {
      version: 1,
      attachments: [
        {
          contextCapsuleID: "capsule_c",
          sourceCtxPackID: "ctxpk_c",
          label: "Code",
          contentHash: "sha256:code",
          fragments: [
            { text: "First", source: { workspaceID: "wrk_c", blockID: "b1", functionalityID: "builtin:chat" }, contentHash: "sha256:1" },
            { text: "Second", source: { workspaceID: "wrk_c", blockID: "b2", functionalityID: "builtin:chat" }, contentHash: "sha256:2" },
          ],
        },
      ],
      byteLength: 128,
      estimatedTokens: 32,
      createdAt: 1700000000000,
    }
    const rendered = renderSessionContextSnapshot(snapshot)
    expect(rendered.indexOf("First")).toBeLessThan(rendered.indexOf("Second"))
    expect(rendered).toContain("Fragment 1 from workspace=wrk_c block=b1 functionality=builtin:chat\nFirst")
    expect(rendered).toContain("Fragment 2 from workspace=wrk_c block=b2 functionality=builtin:chat\nSecond")
  })
})
