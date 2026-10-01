import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Layer, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = SessionV2.ID.create()

describe("SessionV2.create", () => {
  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect(yield* session.list()).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.list()).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_test")
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: AgentV2.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: AgentV2.ID.make("build") },
        {
          id,
          location,
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect(yield* session.list()).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect(yield* session.list()).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("returns the current Session projection after projected updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: id,
        info: SessionV1.SessionInfo.make({
          id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.create(input)).toMatchObject({ id, agent: "build" })
    }),
  )

  it.effect("persists creation through the existing legacy created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: EventV2.versionedType(SessionV1.Event.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("omits legacy creation rows from the V2 Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text: "Hello" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)

      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 1 }, type: "session.next.prompt.admitted", data: { prompt: { text: "Hello" } } },
        { durable: { seq: 2 }, type: "session.next.prompted" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const sourceEvents = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: SessionV2.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        prompt: Prompt.make({ text: "Replay lifecycle" }),
        resume: false,
      })
      yield* SessionInput.promoteSteers(sourceDb, sourceEvents, created.id, Number.MAX_SAFE_INTEGER)
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const targetDatabase = Database.layerFromPath(path.join(tmp.path, "target.sqlite"))
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, targetDatabase]],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* events.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* events.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
          promotedSeq: 2,
        })
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, type: "user", text: "Replay lifecycle" },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, EventV2.versionedType(SessionV1.Event.Created.type, 1)],
          [1, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)],
          [2, EventV2.versionedType(SessionEvent.Prompted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const event = yield* EventV2.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionV1.Event.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.effect("reports unfinished Session operations as unavailable", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const unavailable = (
        effect: Effect.Effect<void, SessionV2.NotFoundError | SessionV2.OperationUnavailableError>,
      ) =>
        effect.pipe(
          Effect.flip,
          Effect.map((error) => (error instanceof SessionV2.OperationUnavailableError ? error.operation : "not-found")),
        )

      expect(yield* unavailable(session.shell({ sessionID: created.id, command: "pwd" }))).toBe("shell")
      expect(yield* unavailable(session.skill({ sessionID: created.id, skill: "review" }))).toBe("skill")
    }),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: "plan" })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.agent.switched", data: { agent: "plan" } }])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: "plan" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.next.model.switched", data: { model } }])
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: ModelV2.Ref.make({ ...model, variant: ModelV2.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )
})

describe("SessionV2.fork", () => {
  it.effect("copies assistant tools, shell links, and compaction without inheriting current agent or model", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const now = yield* DateTime.now
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const source = yield* session.create({ location, agent: AgentV2.ID.make("build"), model })
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.create(), type: "assistant", agent: "build", model,
        time: { created: now, completed: now },
        content: [
          SessionMessage.AssistantText.make({ type: "text", id: "text-original", text: "Used a tool" }),
          SessionMessage.AssistantTool.make({
            type: "tool", id: "call-original", name: "shell", provider: { executed: false },
            state: SessionMessage.ToolStateCompleted.make({
              status: "completed", input: { command: "pwd" }, structured: {}, content: [],
            }),
            time: { created: now, ran: now, completed: now },
          }),
        ],
      })
      const shell = SessionMessage.Shell.make({
        id: SessionMessage.ID.create(), type: "shell", callID: "call-original",
        command: "pwd", output: "/project", time: { created: now, completed: now },
      })
      const compaction = SessionMessage.Compaction.make({
        id: SessionMessage.ID.create(), type: "compaction", reason: "manual",
        summary: "Prior work", recent: "Used a tool", time: { created: now },
      })
      for (const message of [assistant, shell, compaction])
        yield* events.publish(SessionEvent.MessageImported, { sessionID: source.id, timestamp: now, message })

      const fork = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      expect(fork.agent).toBeUndefined()
      expect(fork.model).toBeUndefined()
      expect(copied.map((message) => message.type)).toEqual(["assistant", "shell", "compaction"])
      expect(copied.map((message) => message.id)).not.toEqual([assistant.id, shell.id, compaction.id])
      expect(copied[0]).toMatchObject({ content: [{ id: "text-original" }, { id: "call-original" }] })
      expect(copied[1]).toMatchObject({ callID: "call-original" })
      expect(yield* session.context(fork.id)).toEqual([copied[2]])
      expect(yield* session.messages({ sessionID: source.id, order: "asc" })).toEqual([assistant, shell, compaction])
    }),
  )

  it.effect("copies the visible prefix before a selected message with fresh IDs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location, title: "Original", metadata: { trace: { id: "source" } } })
      const ids = ["msg_z9_before", "msg_z1_before", "msg_a0_selected", "msg_a1_after"].map((id) => SessionMessage.ID.make(id))
      for (const [index, messageID] of ids.entries()) {
        yield* session.prompt({ sessionID: source.id, id: messageID, prompt: Prompt.make({ text: `turn ${index}` }), resume: false })
        yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      }
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "pending" }), resume: false })
      const original = yield* session.messages({ sessionID: source.id, order: "asc" })

      const fork = yield* session.fork({ sessionID: source.id, messageID: ids[2]! })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      expect(fork).toMatchObject({ title: "Original (fork #1)", metadata: { trace: { id: "source" } }, location })
      expect(fork.parentID).toBeUndefined()
      expect(copied.map((message) => message.type === "user" ? message.text : "")).toEqual(["turn 0", "turn 1"])
      expect(copied.map((message) => message.id)).not.toEqual(original.slice(0, 2).map((message) => message.id))
      expect(yield* SessionInput.hasPending(db, fork.id, "steer")).toBe(false)
      expect(yield* session.messages({ sessionID: source.id, order: "asc" })).toEqual(original)
      expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id)).orderBy(asc(EventTable.seq)).all())
        .map((event) => event.type)).toEqual([
          EventV2.versionedType(SessionV1.Event.Created.type, 1),
          EventV2.versionedType(SessionEvent.MessageImported.type, 1),
          EventV2.versionedType(SessionEvent.MessageImported.type, 1),
        ])
    }),
  )

  it.effect("rejects unknown and foreign cutoffs before creating any Session or event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      const other = yield* session.create({ location })
      const foreignID = SessionMessage.ID.make("msg_foreign_cutoff")
      yield* session.prompt({ sessionID: other.id, id: foreignID, prompt: Prompt.make({ text: "foreign" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, other.id, Number.MAX_SAFE_INTEGER)
      const beforeSessions = yield* session.list()
      const beforeEvents = yield* db.select().from(EventTable).all()

      for (const messageID of [SessionMessage.ID.make("msg_unknown_cutoff"), foreignID]) {
        const error = yield* session.fork({ sessionID: source.id, messageID }).pipe(Effect.flip)
        expect(error).toEqual(new SessionV2.MessageNotFoundError({ sessionID: source.id, messageID }))
      }
      expect(yield* session.list()).toEqual(beforeSessions)
      expect(yield* db.select().from(EventTable).all()).toEqual(beforeEvents)
    }),
  )

  it.effect("replays the copied transcript and metadata into a fresh database", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const source = yield* session.create({ location, title: "Original (fork #1)", metadata: { origin: "source" } })
      yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text: "hello" }), resume: false })
      yield* SessionInput.promoteSteers(sourceDb, events, source.id, Number.MAX_SAFE_INTEGER)
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: source.id,
        messageID: SessionMessage.ID.create(),
        text: "note",
        timestamp: yield* DateTime.now,
      })
      const fork = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: fork.id, order: "asc" })
      expect(fork.title).toBe("Original (fork #2)")
      expect(copied[1]).toMatchObject({ type: "synthetic", sessionID: fork.id })
      const serialized = (yield* sourceDb.select().from(EventTable).where(eq(EventTable.aggregate_id, fork.id))
        .orderBy(asc(EventTable.seq)).all()).map((event) => ({
          id: event.id, aggregateID: event.aggregate_id, seq: event.seq, type: event.type, data: event.data,
        }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
      )
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, Database.layerFromPath(path.join(tmp.path, "fork-target.sqlite"))]],
      )
      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const targetEvents = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db.insert(ProjectTable).values({
          id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [],
        }).run().pipe(Effect.orDie)
        yield* targetEvents.replayAll(serialized)
        expect(yield* store.get(fork.id)).toMatchObject({ title: fork.title, metadata: { origin: "source" } })
        expect(yield* store.context(fork.id)).toEqual(copied)
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("rolls back the new Session when an imported message projector fails", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const db = (yield* Database.Service).db
      const source = yield* session.create({ location })
      for (const text of ["first", "second"]) {
        yield* session.prompt({ sessionID: source.id, prompt: Prompt.make({ text }), resume: false })
        yield* SessionInput.promoteSteers(db, events, source.id, Number.MAX_SAFE_INTEGER)
      }
      yield* events.project(SessionEvent.MessageImported, (event) =>
        event.data.message.type === "user" && event.data.message.text === "second"
          ? Effect.die("import failed")
          : Effect.void,
      )

      expect(yield* session.fork({ sessionID: source.id }).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
      expect((yield* session.list()).map((item) => item.id)).toEqual([source.id])
      expect((yield* db.select().from(EventTable).all()).every((event) => event.aggregate_id === source.id)).toBe(true)
    }),
  )
})
