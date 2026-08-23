export * as OperatingChatSessionService from "./operating-chat-session"

import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { SessionV1 } from "../v1/session"
import { FunctionalityInstance } from "./functionality-instance"
import { ModelKey } from "./model-key"
import { WorkspaceService } from "./service"

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "OperatingChat.WorkspaceNotFoundError",
  { workspaceID: Workspace.ID },
) {}

export class BlockNotFoundError extends Schema.TaggedErrorClass<BlockNotFoundError>()(
  "OperatingChat.BlockNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class WrongFunctionalityError extends Schema.TaggedErrorClass<WrongFunctionalityError>()(
  "OperatingChat.WrongFunctionalityError",
  { blockID: Schema.String },
) {}

export class InstanceNotFoundError extends Schema.TaggedErrorClass<InstanceNotFoundError>()(
  "OperatingChat.InstanceNotFoundError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export class ConfigurationError extends Schema.TaggedErrorClass<ConfigurationError>()(
  "OperatingChat.ConfigurationError",
  { workspaceID: Workspace.ID },
) {}

export class StaleBindingError extends Schema.TaggedErrorClass<StaleBindingError>()("OperatingChat.StaleBindingError", {
  currentRevision: Schema.Number,
}) {}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("OperatingChat.BusyError", {
  sessionID: SessionSchema.ID,
}) {}

export interface SessionPort {
  readonly create: (input: {
    id?: SessionSchema.ID
    model: ModelV2.Ref
    location: { directory: typeof AbsolutePath.Type; workspaceID?: Workspace.ID }
  }) => Effect.Effect<SessionSchema.Info>
  readonly configure: (input: { sessionID: SessionSchema.ID; model: ModelV2.Ref }) => Effect.Effect<void>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly cleanupLosingCandidate: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<"removed" | "not-empty" | "unsupported">
}

export class SessionPortService extends Context.Service<SessionPortService, SessionPort>()(
  "@opencode/v2/OperatingChatSessionPort",
) {}

export const sessionPort = LayerNode.unbound(SessionPortService, tags.values.global)

export const sessionPortLive = LayerNode.make({
  service: SessionPortService,
  layer: Layer.effect(
    SessionPortService,
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const sessions = yield* SessionV2.Service
      return SessionPortService.of({
        create: (input) => sessions.create(input),
        configure: (input) =>
          Effect.gen(function* () {
            const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (
              current.model?.providerID === input.model.providerID &&
              current.model.id === input.model.id &&
              (current.model.variant ?? "default") === (input.model.variant ?? "default")
            )
              return
            yield* sessions.switchModel(input).pipe(Effect.orDie)
          }),
        active: sessions.active,
        cleanupLosingCandidate: (sessionID) =>
          sessions.messages({ sessionID, limit: 1 }).pipe(
            Effect.matchEffect({
              onSuccess: (messages) => {
                if (messages.length > 0) return Effect.succeed("not-empty" as const)
                return Effect.gen(function* () {
                  // Canonical deletion removes the projection and notifies clients that saw the candidate's create event.
                  const created = yield* events.durable({ aggregateID: sessionID }).pipe(Stream.take(1), Stream.runHead)
                  if (Option.isNone(created) || created.value.type !== SessionV1.Event.Created.type) {
                    return "unsupported" as const
                  }
                  const data = created.value.data as {
                    sessionID: SessionSchema.ID
                    info: typeof SessionV1.SessionInfo.Type
                  }
                  yield* events.publish(
                    SessionV1.Event.Deleted,
                    data,
                    created.value.location ? { location: created.value.location } : undefined,
                  )
                  return "removed" as const
                }).pipe(Effect.catchCause(() => Effect.succeed("unsupported" as const)))
              },
              onFailure: () => Effect.succeed("not-empty" as const),
            }),
          ),
      })
    }),
  ),
  deps: [EventV2.node, SessionV2.node],
})

type LookupError = WorkspaceNotFoundError | BlockNotFoundError | WrongFunctionalityError

export interface Interface {
  readonly get: (
    workspaceID: Workspace.ID,
    blockID: string,
  ) => Effect.Effect<OperatingChat.Binding | undefined, LookupError>
  readonly ensure: (
    workspaceID: Workspace.ID,
    blockID: string,
  ) => Effect.Effect<OperatingChat.Binding, LookupError | ConfigurationError>
  readonly reset: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedSessionID: SessionSchema.ID,
    expectedRevision: number,
  ) => Effect.Effect<
    OperatingChat.Binding,
    LookupError | InstanceNotFoundError | ConfigurationError | StaleBindingError | BusyError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/OperatingChatSession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const workspaceService = yield* WorkspaceService.Service
    const instances = yield* FunctionalityInstance.Service
    const sessions = yield* SessionPortService
    const events = yield* EventV2.Service

    function requireWorkspace(workspaceID: Workspace.ID) {
      return workspaceService
        .get(workspaceID)
        .pipe(Effect.catchTag("Workspace.NotFoundError", () => new WorkspaceNotFoundError({ workspaceID })))
    }

    function verifyBlock(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const block = yield* workspaceService.block
          .get(workspaceID, blockID)
          .pipe(Effect.catchTag("Workspace.NotFoundError", () => new WorkspaceNotFoundError({ workspaceID })))
        if (!block) return yield* new BlockNotFoundError({ workspaceID, blockID })
        if (block.functionality !== "builtin:operating-chat-session") {
          return yield* new WrongFunctionalityError({ blockID })
        }
        return block
      })
    }

    function requireModel(workspace: Workspace.Info) {
      const model = ModelKey.decode(workspace.operatingAgent)
      if (model) return Effect.succeed(model)
      return Effect.fail(new ConfigurationError({ workspaceID: workspace.id }))
    }

    function parseConfiguration(configuration: unknown) {
      return OperatingChat.InstanceConfiguration.make(
        (configuration ?? {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: null,
        }) as OperatingChat.InstanceConfiguration,
      )
    }

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
    ): OperatingChat.Binding {
      return OperatingChat.Binding.make({
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
    ): OperatingChat.Binding | undefined {
      const config = parseConfiguration(instance.configuration)
      const binding = config.sessionBinding
      if (!binding || binding.mode !== "owned") return undefined
      return toBinding(instance, binding.sessionID, resolveDirectory(workspace, config), binding.generation)
    }

    function readBinding(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const instance = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
        if (!instance) return undefined
        return bindingFromInstance(instance, yield* requireWorkspace(workspaceID))
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

    const claimInstance = Effect.fn("OperatingChat.claimInstance")(function* (
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
        functionalityID: "builtin:operating-chat-session",
        configuration: nextConfiguration,
      })
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
        const model = yield* requireModel(workspace)
        const existing = yield* readBinding(workspaceID, blockID)
        if (existing) {
          yield* sessions.configure({ sessionID: existing.sessionID, model })
          return existing
        }

        const previous = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
        const previousConfig = parseConfiguration(previous?.configuration)
        const directory = resolveDirectory(workspace, previousConfig)
        const candidate = yield* sessions.create({
          model,
          location: { directory: AbsolutePath.make(directory), workspaceID },
        })
        const nextConfiguration = OperatingChat.InstanceConfiguration.make({
          version: 1,
          directoryBinding: previousConfig.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation: 0 },
        })
        const claim = yield* claimInstance(workspaceID, blockID, previous, nextConfiguration)
        if (claim.type === "conflict") {
          yield* sessions.cleanupLosingCandidate(candidate.id)
          const winner = bindingFromInstance(claim.instance, workspace)
          if (winner) {
            yield* sessions.configure({ sessionID: winner.sessionID, model })
            return winner
          }
          const rebound = yield* readBinding(workspaceID, blockID)
          if (rebound) {
            yield* sessions.configure({ sessionID: rebound.sessionID, model })
            return rebound
          }
          return yield* ensure(workspaceID, blockID)
        }
        yield* events.publish(OperatingChat.BindingUpdated, {
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
        const model = yield* requireModel(workspace)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
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

        const directory = resolveDirectory(workspace, config)
        const candidate = yield* sessions.create({
          model,
          location: { directory: AbsolutePath.make(directory), workspaceID },
        })
        const generation = currentBinding.generation + 1
        const next = OperatingChat.InstanceConfiguration.make({
          version: 1,
          directoryBinding: config.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation },
        })
        const claim = yield* swapConfiguration(instance, next)
        if (claim.type === "conflict") {
          yield* sessions.cleanupLosingCandidate(candidate.id)
          return yield* new StaleBindingError({ currentRevision: claim.current.revision })
        }
        yield* events.publish(OperatingChat.BindingUpdated, {
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
