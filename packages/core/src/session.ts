export * as SessionV2 from "./session"
export * from "./session/schema"

import { DateTime, Effect, Layer, Option, Schema, Context, Stream } from "effect"
import { ListAnchor } from "@opencode-ai/schema/session"
import { and, asc, desc, eq, gt, gte, inArray, like, lt, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { EventV2 } from "./event"
import { EventTable } from "./event/sql"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionContextEpochTable, SessionDeletionTable, SessionExecutionTable, SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"
import { SessionV1 } from "./v1/session"
import { InstallationVersion } from "./installation/version"
import { Slug } from "./util/slug"
import { ProjectTable } from "./project/sql"
import path from "path"
import { fromRow } from "./session/info"
import { SessionRunner } from "./session/runner/index"
import { SessionStore } from "./session/store"
import { SessionExecution } from "./session/execution"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { MessageDecodeError } from "./session/error"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { Snapshot } from "./snapshot"
import { SessionRevert } from "./session/revert"
import { Revert } from "@opencode-ai/schema/revert"
import { FSUtil } from "./fs-util"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionSharePendingTable, SessionShareTable } from "./share/sql"

export const RevertState = Revert.State
export type RevertState = Revert.State

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CreateInput = {
  id?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  title?: string
  metadata?: Record<string, unknown>
  location: Location.Ref
}

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["move", "shell", "skill", "switchAgent", "compact", "wait"]),
  },
) {}

export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}
export const MessageNotFoundError = SessionRevert.MessageNotFoundError
export type MessageNotFoundError = SessionRevert.MessageNotFoundError

export class ForkUnavailableError extends Schema.TaggedErrorClass<ForkUnavailableError>()("Session.ForkUnavailable", {
  sessionID: SessionSchema.ID,
  reason: Schema.Literals(["context-epoch", "missing-input"]),
}) {}
export class AdmissionClosedError extends Schema.TaggedErrorClass<AdmissionClosedError>()("Session.AdmissionClosedError", {
  sessionID: SessionSchema.ID,
}) {}
export class ExecutionStillOwnedError extends Schema.TaggedErrorClass<ExecutionStillOwnedError>()("Session.ExecutionStillOwnedError", {
  sessionID: SessionSchema.ID,
}) {}
export class LineageChangedError extends Schema.TaggedErrorClass<LineageChangedError>()("Session.LineageChangedError", {
  sessionID: SessionSchema.ID,
}) {}
export class SharedSessionError extends Schema.TaggedErrorClass<SharedSessionError>()("Session.SharedSessionError", {
  sessionID: SessionSchema.ID,
}) {}

export interface ForkCopy {
  readonly session: SessionSchema.Info
  readonly copied: ReadonlyArray<{
    readonly sourceMessageID: SessionMessage.ID
    readonly targetMessageID: SessionMessage.ID
    readonly sourceMessageSeq: number
    readonly targetEventSeq: number
  }>
}

export type Error = NotFoundError | MessageDecodeError | OperationUnavailableError | PromptConflictError | AdmissionClosedError | ExecutionStillOwnedError | LineageChangedError | SharedSessionError | ForkUnavailableError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  /** A consistent read-only lineage snapshot, including the root. Authorization remains the caller's responsibility. */
  readonly lineage: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info[], NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly fork: (input: {
    sessionID: SessionSchema.ID
    messageID?: SessionMessage.ID
  }) => Effect.Effect<SessionSchema.Info, NotFoundError | MessageNotFoundError | MessageDecodeError | ForkUnavailableError>
  readonly forkCopy: (input: {
    sessionID: SessionSchema.ID
    messageID?: SessionMessage.ID
  }) => Effect.Effect<ForkCopy, NotFoundError | MessageNotFoundError | MessageDecodeError | ForkUnavailableError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly history: (input: {
    sessionID: SessionSchema.ID
    after?: number
    limit: number
  }) => Effect.Effect<{ events: ReadonlyArray<SessionEvent.DurableEvent>; hasMore: boolean }, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError | AdmissionClosedError>
  /** Persistently reject prompt admissions and join local execution. An owner or handoff keeps the fence but fails this call. */
  readonly fenceAdmissions: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | ExecutionStillOwnedError>
  /** Fences an exact caller-authorized lineage and joins local drains. Share absence is a point-in-time check until host share creation coordinates with the fence. No rows are removed. */
  readonly prepareDeleteLineage: (input: {
    sessionID: SessionSchema.ID
    authorizedIDs: ReadonlyArray<SessionSchema.ID>
  }) => Effect.Effect<void, NotFoundError | LineageChangedError | ExecutionStillOwnedError | SharedSessionError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<Revert.State, NotFoundError | MessageNotFoundError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const execution = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )

    const readLineage = (sessionID: SessionSchema.ID) => Effect.gen(function* () {
      const root = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      if (!root) return yield* new NotFoundError({ sessionID })
      const found = [root]
      const seen = new Set([root.id])
      let parents = [root.id]
      while (parents.length) {
        const children = yield* db.select().from(SessionTable)
          .where(inArray(SessionTable.parent_id, parents))
          .orderBy(asc(SessionTable.id)).all().pipe(Effect.orDie)
        const next = children.filter((row) => !seen.has(row.id))
        next.forEach((row) => seen.add(row.id))
        found.push(...next)
        parents = next.map((row) => row.id)
      }
      return found
    })
    const matchesLineage = (actual: ReadonlyArray<SessionSchema.ID>, authorized: ReadonlyArray<SessionSchema.ID>) => {
      const expected = new Set(authorized)
      return expected.size === authorized.length && expected.size === actual.length && actual.every((id) => expected.has(id))
    }

    const result = Service.of({
      create: Effect.fn("V2Session.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const recorded = yield* store.get(sessionID)
        if (recorded) return recorded
        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        const info = SessionV1.SessionInfo.make({
          id: sessionID,
          slug: Slug.create(),
          version: InstallationVersion,
          projectID: project.id,
          directory: input.location.directory,
          path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
          workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
          title: input.title ?? `New session - ${new Date(now).toISOString()}`,
          metadata: input.metadata,
          agent: input.agent,
          model: input.model
            ? {
                id: ModelV2.ID.make(input.model.id),
                providerID: input.model.providerID,
                variant: input.model.variant,
              }
            : undefined,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
        })
        const projected = yield* events
          .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
          .pipe(
            Effect.as({ type: "created" } as const),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
                return Effect.die(defect)
              }
              // Concurrent creation lost the projection race. The existing Session identity wins.
              return store
                .get(sessionID)
                .pipe(
                  Effect.flatMap((session) =>
                    session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
                  ),
                )
            }),
          )
        if (projected.type === "existing") return projected.session
        // TODO: Restore recorded sessions onto replacement synchronized workspaces in a future API slice.
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      fork: Effect.fn("V2Session.fork")((input) => result.forkCopy(input).pipe(Effect.map((copy) => copy.session))),
      forkCopy: Effect.fn("V2Session.forkCopy")((input) => events.transaction(Effect.gen(function* () {
        const original = yield* result.get(input.sessionID)
        const stored = yield* db.select({ metadata: SessionTable.metadata }).from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID)).get().pipe(Effect.orDie)
        if (!stored) return yield* new NotFoundError({ sessionID: input.sessionID })
        const messages = yield* result.messages({ sessionID: input.sessionID, order: "asc" })
        const target = input.messageID === undefined
          ? messages.length
          : messages.findIndex((message) => message.id === input.messageID)
        if (target < 0 && input.messageID)
          return yield* new MessageNotFoundError({ sessionID: input.sessionID, messageID: input.messageID })
        const epoch = yield* db.select()
          .from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, input.sessionID))
          .get().pipe(Effect.orDie)
        const rows = yield* db.select({ id: SessionMessageTable.id, seq: SessionMessageTable.seq })
          .from(SessionMessageTable).where(eq(SessionMessageTable.session_id, input.sessionID))
          .orderBy(asc(SessionMessageTable.seq)).all().pipe(Effect.orDie)
        const sequence = new Map(rows.map((row) => [row.id, row.seq]))
        if (epoch && input.messageID) {
          const cutoffSeq = sequence.get(input.messageID)!
          const laterSnapshot = yield* db.select({ id: EventTable.id }).from(EventTable).where(and(
            eq(EventTable.aggregate_id, input.sessionID),
            gte(EventTable.seq, cutoffSeq),
            or(
              eq(EventTable.type, EventV2.versionedType(SessionEvent.ContextUpdated.type, 1)),
              eq(EventTable.type, EventV2.versionedType(SessionEvent.ContextImported.type, 1)),
            ),
          )).get().pipe(Effect.orDie)
          // The current sidecar has no historical snapshot to restore before a replacement or update.
          if (epoch.baseline_seq >= cutoffSeq || laterSnapshot)
            return yield* new ForkUnavailableError({ sessionID: input.sessionID, reason: "context-epoch" })
        }
        const selected = yield* Effect.forEach(messages.slice(0, target), (message) => Effect.gen(function* () {
          const sourceMessageSeq = sequence.get(message.id)
          if (sourceMessageSeq === undefined) return yield* Effect.die(`Message sequence missing: ${message.id}`)
          if (message.type !== "user") return { message, sourceMessageSeq }
          const input = yield* SessionInput.find(db, message.id)
          if (!input || input.sessionID !== original.id || input.promotedSeq !== sourceMessageSeq)
            return yield* new ForkUnavailableError({ sessionID: original.id, reason: "missing-input" })
          const admission = yield* db.select({ type: EventTable.type, data: EventTable.data })
            .from(EventTable).where(and(
              eq(EventTable.aggregate_id, original.id), eq(EventTable.seq, input.admittedSeq),
            )).get().pipe(Effect.orDie)
          const source = admission?.type === EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)
            ? { kind: "admitted" as const, data: Option.getOrUndefined(Schema.decodeUnknownOption(SessionEvent.PromptAdmitted.data)(admission.data)) }
            : admission?.type === EventV2.versionedType(SessionEvent.PromptImported.type, 1)
              ? { kind: "imported" as const, data: Option.getOrUndefined(Schema.decodeUnknownOption(SessionEvent.PromptImported.data)(admission.data)) }
              : admission?.type === EventV2.versionedType(SessionEvent.Prompted.type, 1)
                ? { kind: "prompted" as const, data: Option.getOrUndefined(Schema.decodeUnknownOption(SessionEvent.Prompted.data)(admission.data)) }
                : undefined
          if (!source?.data)
            return yield* new ForkUnavailableError({ sessionID: original.id, reason: "missing-input" })
          if ((source.kind === "prompted" && input.admittedSeq !== input.promotedSeq) ||
            source.data.sessionID !== original.id ||
            ("messageID" in source.data ? source.data.messageID : source.data.message.id) !== message.id ||
            source.data.delivery !== input.delivery ||
            DateTime.toEpochMillis("messageID" in source.data ? source.data.timestamp : source.data.message.time.created) !==
              DateTime.toEpochMillis(input.timeCreated) ||
            !Prompt.equivalence(source.data.prompt, input.prompt) ||
            !Prompt.equivalence(input.prompt, Prompt.fromUserMessage(message)))
            return yield* new ForkUnavailableError({ sessionID: original.id, reason: "missing-input" })
          return { message, sourceMessageSeq, input, sourceKind: source.kind }
        }))
        const fork = yield* result.create({
          location: original.location,
          title: forkTitle(original.title),
          metadata: stored.metadata === null ? undefined : structuredClone(stored.metadata),
        })
        const copied = [] as ForkCopy["copied"][number][]
        for (const entry of selected) {
          const targetMessageID = SessionMessage.ID.create()
          const message = entry.message.type === "synthetic"
            ? { ...entry.message, id: targetMessageID, sessionID: fork.id }
            : { ...entry.message, id: targetMessageID }
          const event = entry.message.type === "user"
            ? yield* events.publish(SessionEvent.PromptImported, {
                sessionID: fork.id,
                timestamp: entry.message.time.created,
                message: { ...entry.message, id: targetMessageID },
                prompt: entry.input!.prompt,
                delivery: entry.input!.delivery,
                source: { sessionID: original.id, messageID: entry.message.id, kind: entry.sourceKind!, seq: entry.input!.admittedSeq },
              })
            : yield* events.publish(SessionEvent.MessageImported, {
                sessionID: fork.id, timestamp: yield* DateTime.now, message,
              })
          if (event.durable === undefined) return yield* Effect.die("Imported event is missing aggregate sequence")
          copied.push({ sourceMessageID: entry.message.id, targetMessageID,
            sourceMessageSeq: entry.sourceMessageSeq, targetEventSeq: event.durable.seq })
        }
        if (epoch) yield* events.publish(SessionEvent.ContextImported, {
          sessionID: fork.id,
          timestamp: yield* DateTime.now,
          baseline: epoch.baseline,
          snapshot: epoch.snapshot,
          baselineSeq: copied.filter((entry) => entry.sourceMessageSeq <= epoch.baseline_seq).at(-1)?.targetEventSeq ?? 0,
        })
        return { session: fork, copied }
      })).pipe(Effect.catchTag("SqlError", Effect.die))),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        return session
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_created
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      lineage: Effect.fn("V2Session.lineage")((sessionID) =>
        db.transaction(() => Effect.gen(function* () {
          return (yield* readLineage(sessionID)).map(fromRow)
        })).pipe(Effect.catchTag("SqlError", Effect.die)),
      ),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      message: Effect.fn("V2Session.message")(function* (input) {
        const stored = yield* store.message(input.messageID)
        return stored?.sessionID === input.sessionID ? stored.message : undefined
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      events: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(events.durable({ aggregateID: input.sessionID, after: input.after }))),
        ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => isDurableSessionEvent(event))),
      history: Effect.fn("V2Session.history")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* EventV2.readAggregate(db, {
          ...input,
          aggregateID: input.sessionID,
          manifest: SessionDurable,
        })
      }),
      prompt: Effect.fn("V2Session.prompt")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* result.get(input.sessionID)
            const prompt = resolvePrompt(input.prompt)
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery = input.delivery ?? "steer"
            const expected = { sessionID: input.sessionID, messageID, prompt, delivery }
            const admitted = yield* SessionInput.admit(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              prompt,
              delivery,
            }).pipe(
              Effect.catchTag("SessionInput.AdmissionClosed", () => new AdmissionClosedError({ sessionID: input.sessionID })),
              Effect.catchDefect((defect): Effect.Effect<never, PromptConflictError | AdmissionClosedError> => {
                if (defect instanceof SessionInput.LifecycleConflict)
                  return Effect.fail(new PromptConflictError({ sessionID: input.sessionID, messageID }))
                if (defect instanceof SessionInput.AdmissionClosed)
                  return Effect.fail(new AdmissionClosedError({ sessionID: input.sessionID }))
                return Effect.die(defect)
              }),
            )
            if (!SessionInput.equivalent(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* execution.wake(admitted.sessionID)
            return admitted
          }),
        ),
      ),
      fenceAdmissions: Effect.fn("V2Session.fenceAdmissions")((sessionID) =>
        Effect.uninterruptible(db.transaction(() => Effect.gen(function* () {
          const closed = yield* db.select({ id: SessionDeletionTable.session_id }).from(SessionDeletionTable)
            .where(eq(SessionDeletionTable.session_id, sessionID)).get().pipe(Effect.orDie)
          if (closed) return
          const exists = yield* db.select({ id: SessionTable.id }).from(SessionTable)
            .where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
          if (!exists) return yield* new NotFoundError({ sessionID })
          yield* db.insert(SessionDeletionTable).values({ session_id: sessionID, time_created: Date.now() })
            .run().pipe(Effect.orDie)
        }), { behavior: "immediate" }).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.andThen(execution.stopAndJoin(sessionID)),
          Effect.andThen(Effect.gen(function* () {
            const row = yield* db.select({ ownerID: SessionExecutionTable.owner_id, handoff: SessionExecutionTable.handoff_state }).from(SessionExecutionTable)
              .where(eq(SessionExecutionTable.session_id, sessionID)).get().pipe(Effect.orDie)
            if (row && (row.ownerID !== null || row.handoff !== null))
              return yield* new ExecutionStillOwnedError({ sessionID })
          })),
        )),
      ),
      prepareDeleteLineage: Effect.fn("V2Session.prepareDeleteLineage")((input) =>
        Effect.uninterruptible(Effect.gen(function* () {
          const ids = yield* db.transaction(() => Effect.gen(function* () {
            const rows = yield* readLineage(input.sessionID)
            const actual = rows.map((row) => row.id)
            if (!matchesLineage(actual, input.authorizedIDs))
              return yield* new LineageChangedError({ sessionID: input.sessionID })
            yield* db.insert(SessionDeletionTable)
              .values(actual.map((sessionID) => ({ session_id: sessionID, time_created: Date.now() })))
              .onConflictDoNothing().run().pipe(Effect.orDie)
            return actual
          }), { behavior: "immediate" }).pipe(Effect.catchTag("SqlError", Effect.die))

          yield* Effect.forEach(ids, (sessionID) => execution.stopAndJoin(sessionID), { discard: true })

          yield* db.transaction(() => Effect.gen(function* () {
            const rows = yield* readLineage(input.sessionID)
            const actual = rows.map((row) => row.id)
            if (!matchesLineage(actual, input.authorizedIDs))
              return yield* new LineageChangedError({ sessionID: input.sessionID })
            const owners = yield* db.select().from(SessionExecutionTable)
              .where(inArray(SessionExecutionTable.session_id, actual)).all().pipe(Effect.orDie)
            const owned = owners.find((row) => row.owner_id !== null || row.handoff_state !== null)
            if (owned) return yield* new ExecutionStillOwnedError({ sessionID: owned.session_id })
            const shared = rows.find((row) => row.share_url !== null)
            if (shared) return yield* new SharedSessionError({ sessionID: shared.id })
            const shares = yield* db.select({ sessionID: SessionShareTable.session_id }).from(SessionShareTable)
              .where(inArray(SessionShareTable.session_id, actual)).all().pipe(Effect.orDie)
            if (shares[0]) return yield* new SharedSessionError({ sessionID: SessionSchema.ID.make(shares[0].sessionID) })
            const pending = yield* db.select({ sessionID: SessionSharePendingTable.session_id }).from(SessionSharePendingTable)
              .where(inArray(SessionSharePendingTable.session_id, actual)).all().pipe(Effect.orDie)
            if (pending[0]) return yield* new SharedSessionError({ sessionID: SessionSchema.ID.make(pending[0].sessionID) })
          }), { behavior: "immediate" }).pipe(Effect.catchTag("SqlError", Effect.die))
        })),
      ),
      shell: Effect.fn("V2Session.shell")(function* () {
        return yield* new OperationUnavailableError({ operation: "shell" })
      }),
      skill: Effect.fn("V2Session.skill")(function* () {
        return yield* new OperationUnavailableError({ operation: "skill" })
      }),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
        yield* result.get(input.sessionID)
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("V2Session.switchModel")(function* (input) {
        const session = yield* result.get(input.sessionID)
        if (
          session.model?.providerID === input.model.providerID &&
          session.model.id === input.model.id &&
          (session.model.variant ?? "default") === (input.model.variant ?? "default")
        )
          return
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          model: input.model,
        })
      }),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        yield* execution.compact(input).pipe(
          Effect.catch(() => new OperationUnavailableError({ operation: "compact" })),
        )
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.wait(sessionID)
      }),
      active: execution.active,
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.resume(sessionID)
      }),
      interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
        Effect.uninterruptible(execution.interrupt(sessionID)),
      ),
      revert: {
        stage: Effect.fn("V2Session.revert.stage")(function* (input) {
          const session = yield* result.get(input.sessionID)
          return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
        }),
        clear: Effect.fn("V2Session.revert.clear")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* SessionRevert.clear(session).pipe(
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
        }),
        commit: Effect.fn("V2Session.revert.commit")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, events))
        }),
      },
    })

    return result
  }),
)

const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

function forkTitle(title: string) {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  return match ? `${match[1]} (fork #${Number(match[2]) + 1})` : `${title} (fork #1)`
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionExecution.node,
    SessionStore.node,
    LocationServiceMap.node,
    SessionProjector.node,
  ],
})
