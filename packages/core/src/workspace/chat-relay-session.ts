export * as ChatRelaySession from "./chat-relay-session"
export * as ChatRelaySessionService from "./chat-relay-session"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { ChatRelay } from "@opencode-ai/schema/chat-relay"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { FunctionalityInstance } from "./functionality-instance"
import { WorkspaceService } from "./service"

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "ChatRelay.WorkspaceNotFoundError",
  { workspaceID: Workspace.ID },
) {}

export class BlockNotFoundError extends Schema.TaggedErrorClass<BlockNotFoundError>()(
  "ChatRelay.BlockNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class WrongFunctionalityError extends Schema.TaggedErrorClass<WrongFunctionalityError>()(
  "ChatRelay.WrongFunctionalityError",
  { blockID: Schema.String },
) {}

export class InstanceNotFoundError extends Schema.TaggedErrorClass<InstanceNotFoundError>()(
  "ChatRelay.InstanceNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class StaleBindingError extends Schema.TaggedErrorClass<StaleBindingError>()("ChatRelay.StaleBindingError", {
  currentRevision: Schema.Number,
}) {}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("ChatRelay.BusyError", {
  sessionID: SessionSchema.ID,
}) {}

// Narrow session port: the ChatRelay session service only needs session
// creation, liveness, and best-effort cleanup of candidate sessions that lose
// the repository CAS, so it does not drag the full session execution engine
// into its dependency graph. The opencode/server composition provides the live
// adapter (sessionPortLive); tests provide a lightweight stub.
export interface SessionPort {
  readonly create: (input: {
    id?: SessionSchema.ID
    location: { directory: typeof AbsolutePath.Type; workspaceID?: Workspace.ID }
  }) => Effect.Effect<SessionSchema.Info>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  // Best-effort removal of a session that was created as a candidate binding
  // but lost the repository CAS. Only unbound, empty sessions are removed.
  readonly cleanupLosingCandidate: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<"removed" | "not-empty" | "unsupported">
}

export class SessionPortService extends Context.Service<SessionPortService, SessionPort>()("@opencode/v2/ChatRelaySessionPort") {}

export const sessionPort = LayerNode.unbound(SessionPortService, tags.values.global)

export const sessionPortLive = LayerNode.make({
  service: SessionPortService,
  layer: Layer.effect(
    SessionPortService,
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      return SessionPortService.of({
        create: (input) =>
          sessions.create({
            id: input.id,
            location: {
              directory: input.location.directory,
              workspaceID: input.location.workspaceID,
            },
          }),
        active: sessions.active,
        cleanupLosingCandidate: (sessionID) =>
          sessions.messages({ sessionID, limit: 1 }).pipe(
            Effect.matchEffect({
              onSuccess: (messages) =>
                Effect.succeed(messages.length > 0 ? ("not-empty" as const) : ("unsupported" as const)),
              // Unreadable sessions are never removed; the session domain has no
              // deletion API yet, so cleanup is a best-effort no-op there.
              onFailure: () => Effect.succeed("not-empty" as const),
            }),
          ),
      })
    }),
  ),
  deps: [SessionV2.node],
})

export interface Interface {
  readonly get: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    ChatRelay.Binding | undefined,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError
  >
  readonly ensure: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    ChatRelay.Binding,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError
  >
  readonly reset: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedSessionID: SessionSchema.ID,
    expectedRevision: number,
  ) => Effect.Effect<
    ChatRelay.Binding,
    WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError | StaleBindingError | BusyError | InstanceNotFoundError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ChatRelaySession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const workspaceService = yield* WorkspaceService.Service
    const instances = yield* FunctionalityInstance.Service
    const sessions = yield* SessionPortService
    const events = yield* EventV2.Service

    function requireWorkspace(workspaceID: Workspace.ID) {
      return Effect.gen(function* () {
        const info = yield* workspaceService.get(workspaceID)
        if (!info) return yield* new WorkspaceNotFoundError({ workspaceID })
        return info
      })
    }

    function verifyBlock(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const layout = yield* workspaceService.layout.get(
          workspaceID,
          { user: "", style: "default", deviceClass: "desktop" },
          "chat-relay-service",
        )
        const block = layout.blocks.find((entry) => entry.id === blockID)
        if (!block) return yield* new BlockNotFoundError({ workspaceID, blockID })
        if (block.functionality !== "builtin:chat-relay") {
          return yield* new WrongFunctionalityError({ blockID })
        }
        return block
      })
    }

    function parseConfiguration(configuration: unknown) {
      return ChatRelay.InstanceConfiguration.make(
        (configuration ?? {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: null,
        }) as ChatRelay.InstanceConfiguration,
      )
    }

    // The directory binding is resolved before session creation so a fixed
    // binding survives an unbound instance and later resets; workspace-primary
    // falls back to the first workspace directory (or the process cwd).
    function resolveDirectory(workspace: Workspace.Info, configuration: unknown) {
      const config = parseConfiguration(configuration)
      if (config.directoryBinding.mode === "fixed") return config.directoryBinding.directory
      return workspace.directories[0] ?? process.cwd()
    }

    function toBinding(
      instance: FunctionalityInstance.Instance,
      sessionID: SessionSchema.ID,
      directory: string,
      generation: number,
    ): ChatRelay.Binding {
      return ChatRelay.Binding.make({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityInstanceID: instance.id,
        sessionID,
        directory,
        generation,
        revision: instance.revision,
      })
    }

    function bindingFromInstance(
      instance: FunctionalityInstance.Instance,
      workspace: Workspace.Info,
    ): ChatRelay.Binding | undefined {
      const config = parseConfiguration(instance.configuration)
      const binding = config.sessionBinding
      if (!binding || binding.mode !== "owned") return undefined
      return toBinding(instance, binding.sessionID, resolveDirectory(workspace, config), binding.generation)
    }

    function readBinding(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const instance = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        if (!instance) return undefined
        const workspace = yield* requireWorkspace(workspaceID)
        return bindingFromInstance(instance, workspace)
      })
    }

    function hasPendingInput(sessionID: SessionSchema.ID) {
      return Effect.gen(function* () {
        const row = yield* db
          .select({ id: SessionInputTable.id })
          .from(SessionInputTable)
          .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq)))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        return row !== undefined
      })
    }

    function isActive(sessionID: SessionSchema.ID) {
      return Effect.gen(function* () {
        return (yield* sessions.active).has(sessionID)
      })
    }

    // Repository CAS against the instance read before the transition. A
    // vanished row (only possible via a workspace cascade delete) degrades to
    // a conflict carrying the last known instance so callers keep their loser
    // path instead of surfacing a repository error.
    function swapConfiguration(instance: FunctionalityInstance.Instance, nextConfiguration: unknown) {
      return instances
        .compareAndSwapConfiguration({
          instanceID: instance.id,
          expectedRevision: instance.revision,
          nextConfiguration,
        })
        .pipe(
          Effect.catchTag("FunctionalityInstance.InstanceNotFoundError", () =>
            Effect.succeed({ type: "conflict" as const, current: instance }),
          ),
        )
    }

    // Atomically claims the instance row for a candidate binding: inserts it
    // when absent, otherwise CASes on the revision read before the candidate
    // session was created. A tombstoned row is resurrected through the CAS.
    const claimInstance = Effect.fn("ChatRelay.claimInstance")(function* (
      workspaceID: Workspace.ID,
      blockID: string,
      previous: FunctionalityInstance.Instance | undefined,
      nextConfiguration: unknown,
    ) {
      if (previous) {
        const claim = yield* swapConfiguration(previous, nextConfiguration)
        if (claim.type === "updated") return { type: "inserted" as const, instance: claim.instance }
        return { type: "conflict" as const, instance: claim.current }
      }
      const existing = yield* instances.getOrCreate({
        workspaceID,
        blockID,
        functionalityID: "builtin:chat-relay",
        configuration: nextConfiguration,
      })
      // "created" means this call won the insert race and owns the row; an
      // "existing" live row means another caller already persisted its
      // binding; an "existing" tombstoned row is resurrected through the
      // revision-guarded CAS.
      if (existing.type === "created") return { type: "inserted" as const, instance: existing.instance }
      if (existing.instance.deletedAt === null) return { type: "conflict" as const, instance: existing.instance }
      const claim = yield* swapConfiguration(existing.instance, nextConfiguration)
      if (claim.type === "updated") return { type: "inserted" as const, instance: claim.instance }
      return { type: "conflict" as const, instance: claim.current }
    })

    const get: Interface["get"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        return yield* readBinding(workspaceID, blockID)
      })

    const ensure: Interface["ensure"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const existing = yield* readBinding(workspaceID, blockID)
        if (existing) return existing

        // Resolve the directory binding before creating the session so a
        // fixed binding on an unbound instance is honored.
        const previous = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        const previousConfig = parseConfiguration(previous?.configuration)
        const directory = resolveDirectory(workspace, previousConfig)
        const candidate = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory),
            workspaceID,
          },
        })
        const nextConfiguration = ChatRelay.InstanceConfiguration.make({
          version: 1,
          directoryBinding: previousConfig.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation: 0 },
        })
        const claim = yield* claimInstance(workspaceID, blockID, previous, nextConfiguration)
        if (claim.type === "conflict") {
          // A concurrent caller persisted its binding first. Return the
          // winning binding and discard only the session we created, which
          // is unbound and never visible.
          yield* sessions.cleanupLosingCandidate(candidate.id)
          const winner = bindingFromInstance(claim.instance, workspace)
          if (winner) return winner
          const rebound = yield* readBinding(workspaceID, blockID)
          if (rebound) return rebound
          return yield* ensure(workspaceID, blockID)
        }
        yield* events.publish(ChatRelay.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: candidate.id,
          generation: 0,
          revision: claim.instance.revision,
        })
        return toBinding(claim.instance, candidate.id, directory, 0)
      })

    const reset: Interface["reset"] = (workspaceID, blockID, expectedSessionID, expectedRevision) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:chat-relay")
        if (!instance) return yield* new InstanceNotFoundError({ workspaceID, blockID })
        if (instance.revision !== expectedRevision) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        const config = parseConfiguration(instance.configuration)
        const currentBinding = config.sessionBinding
        if (!currentBinding || currentBinding.mode !== "owned" || currentBinding.sessionID !== expectedSessionID) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        if ((yield* hasPendingInput(expectedSessionID)) || (yield* isActive(expectedSessionID))) {
          return yield* new BusyError({ sessionID: expectedSessionID })
        }
        // Resolve the directory binding before creating the replacement session;
        // a fixed binding survives resets.
        const directory = resolveDirectory(workspace, config)
        const candidate = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory),
            workspaceID,
          },
        })
        const generation = currentBinding.generation + 1
        const next = ChatRelay.InstanceConfiguration.make({
          version: 1,
          directoryBinding: config.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation },
        })
        const claim = yield* swapConfiguration(instance, next)
        if (claim.type === "conflict") {
          // Another caller persisted a transition first; drop our unbound
          // candidate and surface the current revision for a retry.
          yield* sessions.cleanupLosingCandidate(candidate.id)
          return yield* new StaleBindingError({ currentRevision: claim.current.revision })
        }
        yield* events.publish(ChatRelay.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: candidate.id,
          generation,
          revision: claim.instance.revision,
        })
        return toBinding(claim.instance, candidate.id, directory, generation)
      })

    return Service.of({ get, ensure, reset })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, WorkspaceService.node, FunctionalityInstance.node, EventV2.node, sessionPortLive],
})
