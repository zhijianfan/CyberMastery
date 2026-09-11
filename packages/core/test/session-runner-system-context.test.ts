import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2, type Payload } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { buildLocationServiceMap, LocationServiceMap } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { renderContextSidecar } from "@opencode-ai/core/session/context-sidecar"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner, SessionRunnerLLM } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionContextEpochTable, SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { FunctionalityInstanceTable, WorkspaceV2Table } from "@opencode-ai/core/workspace/sql"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Cause, DateTime, Effect, Exit, Layer, Schema, Stream } from "effect"
import { and, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const model = Model.make({ id: "fake-model", provider: "fake", route })
const requests: LLMRequest[] = []
const response = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-system-context" }),
  LLMEvent.textDelta({ id: "text-system-context", text: "Done" }),
  LLMEvent.textEnd({ id: "text-system-context" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(response)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContext = AppNodeBuilder.build(SystemContextRegistry.node)
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))

const profiles = new Map<SessionV2.ID, SessionContextProfile.Profile>()
const ambiguous = new Set<SessionV2.ID>()
const profileResolutions: SessionV2.ID[] = []
let profileAcquisitions = 0
const profileLayer = Layer.effect(
  SessionContextProfile.Service,
  Effect.sync(() => {
    profileAcquisitions++
    return SessionContextProfile.Service.of({
      resolve: (sessionID) => {
        profileResolutions.push(sessionID)
        return ambiguous.has(sessionID)
          ? Effect.fail(new SessionContextProfile.AmbiguousError({ sessionID, matches: 2 }))
          : Effect.succeed(profiles.get(sessionID) ?? { kind: "generic" })
      },
      revalidate: () => Effect.void,
    })
  }),
)
const profileNode = makeGlobalNode({ service: SessionContextProfile.Service, layer: profileLayer, deps: [] })
const sessionContextReplacements = [
  [SessionInput.SessionContextAssemblyPort.node, SessionInput.cleanContextAssemblyNode],
  [SessionContextProfile.node, profileNode],
  [SessionContextTransferReadiness.node, SessionContextTransferReadiness.managedNotReadyNode],
] as const

const runnerReplacements = [
  ...sessionContextReplacements,
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Config.node, config],
] as const
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, runnerReplacements)
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => runner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      ...sessionContextReplacements,
      [LayerNodePlatform.llmClient, client],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const firstSessionID = SessionV2.ID.make("ses_system_context_first")
const secondSessionID = SessionV2.ID.make("ses_system_context_second")
const operatingProfile = (blockID: string, instanceID: string): SessionContextProfile.Profile => ({
  kind: "operating-chat",
  workspaceID: "wrk_system_context",
  workspaceName: "System Context Workspace",
  blockID,
  functionalityID: "builtin:operating-chat-session",
  functionalityInstanceID: instanceID,
  generation: 3,
  revision: 7,
  directory: "/project",
  operatingAgent: "openai/gpt-5",
})

const insertSession = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "test",
        version: "test",
        agent: "build",
      })
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  requests.length = 0
  profiles.clear()
  ambiguous.clear()
  profileResolutions.length = 0
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* insertSession(firstSessionID)
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) =>
    editor.update(AgentV2.ID.make("build"), (agent) => {
      agent.system = "Build agent private instructions"
      agent.steps = 2
      agent.mode = "primary"
    }),
  )
  const applications = yield* ApplicationTools.Service
  yield* applications.register({
    echo: Tool.make({
      description: "Echo text",
      input: Schema.Struct({ text: Schema.String }),
      output: Schema.Struct({ text: Schema.String }),
      execute: ({ text }) => Effect.succeed({ text }),
    }),
  })
})

const promptAndRun = (sessionID: SessionV2.ID, text: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    yield* sessions.prompt({ sessionID, prompt: Prompt.make({ text }), resume: false })
    yield* sessions.resume(sessionID)
  })

const systemText = (request: LLMRequest) => request.system.map((part) => part.text).join("\n")

const registerDelegation = Effect.gen(function* () {
  const applications = yield* ApplicationTools.Service
  yield* applications.register({
    task_batch: Tool.withPermission(
      Tool.make({
        description: "Delegate independent tasks",
        input: Schema.Struct({}),
        output: Schema.Struct({}),
        execute: () => Effect.die("The provider must not invoke tools in catalog tests"),
      }),
      "parallel_task",
    ),
  })
})

const runWithWorkspace = Effect.gen(function* () {
  const database = yield* Database.Service
  const agents = yield* AgentV2.Service
  const applications = yield* ApplicationTools.Service
  yield* database.db
    .update(SessionTable)
    .set({ workspace_id: Workspace.ID.make("wrk_system_context") })
    .where(eq(SessionTable.id, firstSessionID))
    .run()
    .pipe(Effect.orDie)
  yield* SessionRunner.Service.pipe(
    Effect.flatMap((runner) => runner.run({ sessionID: firstSessionID, force: true })),
    Effect.provide(
      Layer.fresh(
        AppNodeBuilder.build(SessionRunnerLLM.node, [
          ...runnerReplacements.filter(([node]) => node !== Location.node),
          [Database.node, Layer.succeed(Database.Service, database)],
          [AgentV2.node, Layer.succeed(AgentV2.Service, agents)],
          [ApplicationTools.node, Layer.succeed(ApplicationTools.Service, applications)],
          [
            Location.node,
            Location.boundNode({
              directory: AbsolutePath.make("/project"),
              workspaceID: Workspace.ID.make("wrk_system_context"),
            }),
          ],
        ]),
      ),
    ),
  )
})

describe("SessionRunner delegation catalog", () => {
  for (const agentID of ["build", "parallel-master"]) {
    it.effect(`hides delegation from ${agentID} without a live host binding`, () =>
      Effect.gen(function* () {
        yield* setup
        yield* registerDelegation
        const agents = yield* AgentV2.Service
        yield* agents.transform((editor) =>
          editor.update(AgentV2.ID.make(agentID), (agent) => {
            agent.mode = "primary"
            agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          }),
        )
        const database = yield* Database.Service
        yield* database.db
          .update(SessionTable)
          .set({ agent: agentID })
          .where(eq(SessionTable.id, firstSessionID))
          .run()
          .pipe(Effect.orDie)

        yield* promptAndRun(firstSessionID, "Inspect the available tools")
        expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(["echo"])
      }),
    )
  }

  it.effect("hides coding delegation from a live OperatingChat primary", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerDelegation
      profiles.set(firstSessionID, operatingProfile("operating", "instance-operating"))
      yield* runWithWorkspace
      expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(["echo"])
    }),
  )

  it.effect("keeps delegation available to a live MasterAgent binding", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerDelegation
      const database = yield* Database.Service
      yield* database.db
        .insert(WorkspaceV2Table)
        .values({
          id: Workspace.ID.make("wrk_system_context"),
          name: "Catalog workspace",
          style: "canvas",
          directories: ["/project"],
          plugin_ids: [],
          skill_ids: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(FunctionalityInstanceTable)
        .values({
          id: "instance-master",
          workspace_id: Workspace.ID.make("wrk_system_context"),
          block_id: "master",
          functionality_id: "builtin:master-agent",
          revision: 0,
          configuration: {
            version: 1,
            directoryBinding: { mode: "workspace-primary" },
            sessionBinding: { mode: "owned", sessionID: firstSessionID, generation: 0 },
          },
          deleted_at: null,
          time_updated: 0,
        })
        .run()
        .pipe(Effect.orDie)
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("parallel-master"), (agent) => {
          agent.mode = "primary"
          agent.hidden = true
          agent.permissions = [{ action: "parallel_task", resource: "parallel-worker", effect: "allow" }]
        }),
      )
      yield* database.db
        .update(SessionTable)
        .set({ agent: "parallel-master" })
        .where(eq(SessionTable.id, firstSessionID))
        .run()
        .pipe(Effect.orDie)

      yield* runWithWorkspace
      expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(["echo", "task_batch"])
    }),
  )

  it.effect("preserves configured delegation denial for an eligible OperatingChat primary", () =>
    Effect.gen(function* () {
      yield* setup
      yield* registerDelegation
      profiles.set(firstSessionID, operatingProfile("operating", "instance-operating"))
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "allow" },
            { action: "parallel_task", resource: "*", effect: "deny" },
          ]
        }),
      )

      yield* runWithWorkspace
      expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(["echo"])
    }),
  )
})

describe("SessionRunner system context", () => {
  it.effect("scopes non-coding Superpowers guidance to the OperatingChat host", () =>
    Effect.gen(function* () {
      yield* setup
      yield* insertSession(secondSessionID)
      profiles.set(firstSessionID, operatingProfile("operating", "instance-operating"))

      yield* promptAndRun(firstSessionID, "Plan a feature")
      yield* promptAndRun(secondSessionID, "Implement a feature")

      expect(systemText(requests[0]!)).toContain("superpowers:brainstorming")
      expect(systemText(requests[0]!)).toContain("superpowers:writing-plans")
      expect(systemText(requests[0]!)).toContain("Do not write or modify application code, tests, or scripts")
      expect(systemText(requests[0]!)).toContain("MasterAgent")
      expect(systemText(requests[1]!)).not.toContain("superpowers:")
      expect(systemText(requests[1]!)).not.toContain("Do not write or modify application code")
    }),
  )

  it.effect("upgrades an existing OperatingChat baseline with Superpowers guidance", () =>
    Effect.gen(function* () {
      yield* setup
      profiles.set(firstSessionID, operatingProfile("operating", "instance-operating"))
      yield* promptAndRun(firstSessionID, "Before upgrade")
      const database = yield* Database.Service
      yield* database.db
        .update(SessionContextEpochTable)
        .set({
          baseline: "Legacy operating context",
          snapshot: {
            "core/selected-agent": {
              value: { id: "build", system: "Build agent private instructions" },
              refresh: "replacement-only",
            },
            "cybermaster/operating-chat-host": {
              value: { ...operatingProfile("operating", "instance-operating") },
              refresh: "replacement-only",
            },
          },
        })
        .where(eq(SessionContextEpochTable.session_id, firstSessionID))
        .run()
        .pipe(Effect.orDie)

      yield* promptAndRun(firstSessionID, "After upgrade")

      expect(systemText(requests[1]!)).toContain("superpowers:writing-plans")
      expect(systemText(requests[1]!)).not.toContain("Legacy operating context")
      const store = yield* SessionStore.Service
      expect((yield* store.context(firstSessionID)).filter((message) => message.type === "user")).toHaveLength(2)
    }),
  )

  it.effect("stores one private agent and OperatingChat baseline per Session", () =>
    Effect.gen(function* () {
      yield* setup
      yield* insertSession(secondSessionID)
      profiles.set(firstSessionID, operatingProfile("block-first", "instance-first"))
      profiles.set(secondSessionID, operatingProfile("block-second", "instance-second"))

      yield* promptAndRun(firstSessionID, "First turn")
      yield* promptAndRun(secondSessionID, "Other block")
      yield* promptAndRun(firstSessionID, "Second turn")

      expect(requests).toHaveLength(3)
      expect(requests[0]!.system).toHaveLength(1)
      expect(systemText(requests[0]!)).toContain("Build agent private instructions")
      expect(systemText(requests[0]!)).toContain("block-first")
      expect(systemText(requests[0]!)).toContain("instance-first")
      expect(systemText(requests[0]!)).not.toContain("block-second")
      expect(systemText(requests[1]!)).toContain("block-second")
      expect(systemText(requests[1]!)).not.toContain("block-first")
      expect(systemText(requests[2]!)).toBe(systemText(requests[0]!))

      const { db } = yield* Database.Service
      const stored = yield* db
        .select()
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, firstSessionID))
        .get()
        .pipe(Effect.orDie)
      expect(stored?.baseline).toBe(systemText(requests[0]!))
      expect(stored?.snapshot).toEqual({
        "core/selected-agent": {
          value: { id: "build", system: "Build agent private instructions" },
          refresh: "replacement-only",
        },
        "cybermaster/operating-chat-host": {
          value: {
            kind: "operating-chat",
            workspaceID: "wrk_system_context",
            workspaceName: "System Context Workspace",
            blockID: "block-first",
            functionalityID: "builtin:operating-chat-session",
            functionalityInstanceID: "instance-first",
            generation: 3,
            revision: 7,
            directory: "/project",
            operatingAgent: "openai/gpt-5",
            instructions: expect.stringContaining("superpowers:brainstorming"),
          },
          refresh: "replacement-only",
        },
      })
    }),
  )

  it.effect("reuses a byte-identical durable baseline after runner service restart", () =>
    Effect.gen(function* () {
      yield* setup
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) => editor.remove(AgentV2.ID.make("build")))
      profiles.set(firstSessionID, operatingProfile("restart-block", "restart-instance"))
      yield* promptAndRun(firstSessionID, "Before restart")
      const before = systemText(requests[0]!)
      const database = yield* Database.Service

      yield* SessionRunner.Service.pipe(
        Effect.flatMap((runner) => runner.run({ sessionID: firstSessionID, force: true })),
        Effect.provide(
          AppNodeBuilder.build(SessionRunnerLLM.node, [
            ...runnerReplacements,
            [Database.node, Layer.succeed(Database.Service, database)],
          ]),
        ),
      )

      expect(requests).toHaveLength(2)
      expect(systemText(requests[1]!)).toBe(before)
    }),
  )

  it.effect("keeps private replacements out of chronological events and aligns switched-agent policy", () =>
    Effect.gen(function* () {
      yield* setup
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const streamed: Payload[] = []
      const unsubscribe = yield* events.listen((event) => Effect.sync(() => streamed.push(event)))

      yield* promptAndRun(firstSessionID, "Initial")
      const baseline = systemText(requests[0]!)
      expect(baseline).not.toContain("OperatingChat host:")
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "echo", resource: "*", effect: "deny" }]
        }),
      )
      yield* promptAndRun(firstSessionID, "Permission only")
      expect(systemText(requests[1]!)).toBe(baseline)
      expect(requests[1]!.toolChoice).toBeUndefined()
      expect(requests[1]!.tools).toEqual([])
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.steps = 1
        }),
      )
      yield* promptAndRun(firstSessionID, "Step limit only")
      expect(systemText(requests[2]!)).toBe(baseline)
      expect(requests[2]!.toolChoice).toMatchObject({ type: "none" })
      expect(requests[2]!.tools).toEqual([])

      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.system = "Reviewer private instructions"
          agent.steps = 2
          agent.mode = "primary"
        }),
      )
      yield* events.publish(SessionEvent.AgentSwitched, {
        sessionID: firstSessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: DateTime.makeUnsafe(1),
        agent: "reviewer",
      })
      yield* promptAndRun(firstSessionID, "Switch agent")
      expect(systemText(requests[3]!)).toContain("Reviewer private instructions")
      expect(systemText(requests[3]!)).not.toContain("Build agent private instructions")
      expect(requests[3]!.toolChoice).toBeUndefined()
      expect(requests[3]!.tools.map((tool) => tool.name)).toEqual(["echo"])
      expect((yield* sessions.context(firstSessionID)).at(-1)).toMatchObject({
        type: "assistant",
        agent: "reviewer",
      })

      profiles.set(firstSessionID, operatingProfile("private-block-a", "private-instance-a"))
      yield* promptAndRun(firstSessionID, "Add host")
      expect(systemText(requests[4]!)).toContain("private-block-a")
      profiles.set(firstSessionID, operatingProfile("private-block-b", "private-instance-b"))
      yield* promptAndRun(firstSessionID, "Change host")
      expect(systemText(requests[5]!)).toContain("private-block-b")
      expect(systemText(requests[5]!)).not.toContain("private-block-a")
      profiles.set(firstSessionID, { kind: "generic" })
      yield* promptAndRun(firstSessionID, "Remove host")
      expect(systemText(requests[6]!)).not.toContain("private-block-b")

      yield* agents.transform((editor) => editor.remove(AgentV2.ID.make("reviewer")))
      yield* promptAndRun(firstSessionID, "Remove agent source")
      expect(systemText(requests[7]!)).not.toContain("Reviewer private instructions")
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.system = "Restored reviewer private instructions"
          agent.steps = 2
          agent.mode = "primary"
        }),
      )
      yield* promptAndRun(firstSessionID, "Restore agent source")
      expect(systemText(requests[8]!)).toContain("Restored reviewer private instructions")
      yield* unsubscribe

      const { db } = yield* Database.Service
      const raw = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, firstSessionID))
        .all()
        .pipe(Effect.orDie)
      expect(raw.some((event) => event.type === "session.next.context.updated.1")).toBe(false)
      const publicBytes = JSON.stringify([...raw, ...streamed])
      expect(publicBytes).not.toContain("Build agent private instructions")
      expect(publicBytes).not.toContain("Reviewer private instructions")
      expect(publicBytes).not.toContain("Restored reviewer private instructions")
      expect(publicBytes).not.toContain("private-block-a")
      expect(publicBytes).not.toContain("private-block-b")
      expect(publicBytes).not.toContain("private-instance-a")
      expect(publicBytes).not.toContain("private-instance-b")
    }),
  )

  it.effect("rebuilds a compacted epoch from current private values", () =>
    Effect.gen(function* () {
      yield* setup
      profiles.set(firstSessionID, operatingProfile("before-compaction", "instance-before"))
      yield* promptAndRun(firstSessionID, "Before compaction")
      const events = yield* EventV2.Service
      const compactionID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Compaction.Started, {
        sessionID: firstSessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(2),
        reason: "manual",
      })
      yield* events.publish(SessionEvent.Compaction.Ended, {
        sessionID: firstSessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(3),
        reason: "manual",
        text: "summary",
        recent: "",
      })
      profiles.set(firstSessionID, operatingProfile("after-compaction", "instance-after"))

      yield* promptAndRun(firstSessionID, "After compaction")

      expect(systemText(requests[1]!)).toContain("after-compaction")
      expect(systemText(requests[1]!)).not.toContain("before-compaction")
      const { db } = yield* Database.Service
      expect(
        (yield* db
          .select()
          .from(SessionContextEpochTable)
          .where(eq(SessionContextEpochTable.session_id, firstSessionID))
          .get()
          .pipe(Effect.orDie))?.baseline,
      ).toBe(systemText(requests[1]!))
    }),
  )

  it.effect("fails profile ambiguity before provider invocation", () =>
    Effect.gen(function* () {
      yield* setup
      const sessions = yield* SessionV2.Service
      yield* sessions.prompt({
        sessionID: firstSessionID,
        prompt: Prompt.make({ text: "Ambiguous" }),
        resume: false,
      })
      ambiguous.add(firstSessionID)

      const exit = yield* sessions.resume(firstSessionID).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(
          Cause.findErrorOption(exit.cause).pipe((error) => (error._tag === "Some" ? error.value : undefined)),
        ).toBeInstanceOf(SessionContextProfile.AmbiguousError)
      expect(requests).toEqual([])
    }),
  )

  it.effect("never renders a promoted V2 sidecar as request system text", () =>
    Effect.gen(function* () {
      yield* setup
      const sessions = yield* SessionV2.Service
      const admitted = yield* sessions.prompt({
        sessionID: firstSessionID,
        prompt: Prompt.make({ text: "Visible prompt" }),
        resume: false,
      })
      const snapshot = yield* renderContextSidecar({
        promptText: "Visible prompt",
        attachments: [
          {
            selection: "automatic",
            sourceCtxPackID: "private-pack",
            label: "Private recall",
            contentHash: "private-pack-hash",
            fragments: [{ contentHash: "private-fragment-hash", text: "PRIVATE V2 FRAGMENT" }],
          },
        ],
        recall: { policy: "operating-chat-v1", status: "selected" },
        budget: { maximumBytes: 10_000, maximumEstimatedTokens: 2_500 },
        createdAt: 1,
      })
      const { db } = yield* Database.Service
      const row = yield* db
        .select({ admittedSeq: SessionInputTable.admitted_seq })
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, admitted.id))
        .get()
        .pipe(Effect.orDie)
      if (row === undefined) return yield* Effect.die("missing admitted input")
      const event = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, firstSessionID), eq(EventTable.seq, row.admittedSeq)))
        .get()
        .pipe(Effect.orDie)
      if (event === undefined) return yield* Effect.die("missing admission event")
      yield* db
        .update(EventTable)
        .set({ data: { ...event.data, modelContextVersion: 2 } })
        .where(eq(EventTable.id, event.id))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ context_snapshot_json: snapshot })
        .where(eq(SessionInputTable.id, admitted.id))
        .run()
        .pipe(Effect.orDie)

      yield* sessions.resume(firstSessionID)

      expect(systemText(requests[0]!)).not.toContain("PRIVATE V2 FRAGMENT")
      expect(systemText(requests[0]!)).not.toContain("Private recall")
      expect(systemText(requests[0]!)).not.toContain(snapshot.apiContent)
    }),
  )
})

const locationSessionID = SessionV2.ID.make("ses_location_profile_spy")
const locationRef = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
const locationStoreLayer = Layer.succeed(
  SessionStore.Service,
  SessionStore.Service.of({
    get: (sessionID) =>
      Effect.succeed(
        sessionID === locationSessionID
          ? SessionV2.Info.make({
              id: locationSessionID,
              projectID: Project.ID.global,
              agent: AgentV2.ID.make("build"),
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
              title: "location profile spy",
              location: locationRef,
            })
          : undefined,
      ),
    context: () => Effect.succeed([]),
    runnerContext: () => Effect.succeed([]),
    message: () => Effect.succeed(undefined),
  }),
)
const locationStoreNode = makeGlobalNode({ service: SessionStore.Service, layer: locationStoreLayer, deps: [] })
const locationMap = buildLocationServiceMap([...sessionContextReplacements, [SessionStore.node, locationStoreNode]])
const locationIt = testEffect(locationMap)

describe("SessionRunner location profile composition", () => {
  locationIt.live("injects the live profile replacement into a real location graph", () =>
    Effect.gen(function* () {
      profileAcquisitions = 0
      profileResolutions.length = 0
      const locations = yield* LocationServiceMap.Service
      const location = locations.get(locationRef)
      yield* FileSystem.Service.pipe(Effect.provide(location))
      yield* SessionRunner.Service.pipe(
        Effect.flatMap((runner) => runner.run({ sessionID: locationSessionID, force: true })),
        Effect.exit,
        Effect.provide(location),
      )

      expect(profileAcquisitions).toBe(1)
      expect(profileResolutions).toContain(locationSessionID)
    }),
  )
})
