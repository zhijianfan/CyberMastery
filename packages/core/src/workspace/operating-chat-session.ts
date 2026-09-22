export * as OperatingChatSessionService from "./operating-chat-session"

import { DateTime, Effect, Layer, Option, Schema, Scope, Stream, Context } from "effect"
import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { and, eq, isNull } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { SessionStore } from "../session/store"
import { SessionV1 } from "../v1/session"
import { FunctionalityInstance } from "./functionality-instance"
import { ModelKey } from "./model-key"
import { WorkspaceService } from "./service"
import { CanvasTabService } from "./canvas-tab"

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

export class WrongTabError extends Schema.TaggedErrorClass<WrongTabError>()("OperatingChat.WrongTabError", {
  workspaceID: Workspace.ID,
  tabID: Schema.String,
}) {}

type RegistryError =
  | CanvasTabService.NotFoundError
  | CanvasTabService.WrongKindError
  | CanvasTabService.StaleRevisionError
  | CanvasTabService.BusyError
  | CanvasTabService.DeletedBlockError

export interface SessionPort {
  readonly create: (input: {
    id?: SessionSchema.ID
    model?: ModelV2.Ref
    location: { directory: typeof AbsolutePath.Type; workspaceID?: Workspace.ID }
  }) => Effect.Effect<SessionSchema.Info>
  readonly configure: (input: { sessionID: SessionSchema.ID; model?: ModelV2.Ref }) => Effect.Effect<void>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly reserveIdle: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, never, Scope.Scope>
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
              !input.model ||
              (current.model?.providerID === input.model.providerID &&
                current.model.id === input.model.id &&
                (current.model.variant ?? "default") === (input.model.variant ?? "default"))
            )
              return
            yield* sessions.switchModel({ sessionID: input.sessionID, model: input.model }).pipe(Effect.orDie)
          }),
        active: sessions.active,
        reserveIdle: sessions.reserveIdle,
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
  ) => Effect.Effect<OperatingChat.Binding | undefined, LookupError | RegistryError>
  readonly ensure: (
    workspaceID: Workspace.ID,
    blockID: string,
  ) => Effect.Effect<OperatingChat.Binding, LookupError | ConfigurationError | RegistryError>
  readonly reset: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedSessionID: SessionSchema.ID,
    expectedRevision: number,
  ) => Effect.Effect<
    OperatingChat.Binding,
    LookupError | InstanceNotFoundError | ConfigurationError | StaleBindingError | BusyError | RegistryError
  >
  readonly createTab: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedBindingRevision: number,
    requestID: string,
  ) => Effect.Effect<
    { readonly binding: OperatingChat.Binding; readonly tabRevision: number },
    LookupError | ConfigurationError | StaleBindingError | BusyError | WrongTabError | RegistryError
  >
  readonly selectTab: (
    workspaceID: Workspace.ID,
    blockID: string,
    tabID: string,
    expectedBindingRevision: number,
    expectedTabRevision: number,
  ) => Effect.Effect<
    { readonly binding: OperatingChat.Binding; readonly tabRevision: number },
    LookupError | ConfigurationError | StaleBindingError | BusyError | WrongTabError | RegistryError
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
    const sessionStore = yield* SessionStore.Service
    const tabs = yield* CanvasTabService.Service
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

    function bindingFromInstance(instance: FunctionalityInstance.Instance) {
      return Effect.gen(function* () {
        const config = parseConfiguration(instance.configuration)
        const binding = config.sessionBinding
        if (!binding || binding.mode !== "owned") return undefined
        const session = yield* sessionStore.get(binding.sessionID)
        if (!session) return yield* Effect.die(`Bound OperatingChat session ${binding.sessionID} is missing`)
        if (session.location.workspaceID !== instance.workspaceID) {
          return yield* Effect.die(
            `Bound OperatingChat session ${binding.sessionID} does not belong to workspace ${instance.workspaceID}`,
          )
        }
        return toBinding(instance, binding.sessionID, session.location.directory, binding.generation)
      })
    }

    function readBinding(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const instance = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
        if (!instance) return undefined
        return yield* bindingFromInstance(instance)
      })
    }

    function enrollBinding(workspaceID: Workspace.ID, blockID: string, binding: OperatingChat.Binding) {
      return Effect.gen(function* () {
        const session = yield* sessionStore.get(binding.sessionID)
        if (!session) return binding
        yield* tabs.enroll(
          workspaceID,
          "operating-chat",
          blockID,
          binding.sessionID,
          session.title,
          DateTime.toEpochMillis(session.time.created),
        )
        return binding
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
        const binding = yield* readBinding(workspaceID, blockID)
        if (!binding) return undefined
        return yield* enrollBinding(workspaceID, blockID, binding)
      })

    const ensure: Interface["ensure"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const model = ModelKey.decode(workspace.model)
        const existing = yield* readBinding(workspaceID, blockID)
        if (existing) {
          yield* sessions.configure({ sessionID: existing.sessionID, model })
          return yield* enrollBinding(workspaceID, blockID, existing)
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
        const claim = yield* events
          .atomic(
            Effect.gen(function* () {
              yield* verifyBlock(workspaceID, blockID)
              const claim = yield* claimInstance(workspaceID, blockID, previous, nextConfiguration)
              if (claim.type === "conflict") return claim
              yield* enrollBinding(workspaceID, blockID, toBinding(claim.instance, candidate.id, directory, 0))
              yield* events.publish(OperatingChat.BindingUpdated, {
                workspaceID,
                blockID,
                sessionID: candidate.id,
                generation: 0,
                revision: claim.instance.revision,
              })
              return claim
            }),
          )
          .pipe(Effect.tapError(() => sessions.cleanupLosingCandidate(candidate.id).pipe(Effect.asVoid)))
        if (claim.type === "conflict") {
          yield* sessions.cleanupLosingCandidate(candidate.id)
          const winner = yield* bindingFromInstance(claim.instance)
          if (winner) {
            yield* sessions.configure({ sessionID: winner.sessionID, model })
            return yield* enrollBinding(workspaceID, blockID, winner)
          }
          const rebound = yield* readBinding(workspaceID, blockID)
          if (rebound) {
            yield* sessions.configure({ sessionID: rebound.sessionID, model })
            return yield* enrollBinding(workspaceID, blockID, rebound)
          }
          return yield* ensure(workspaceID, blockID)
        }
        return toBinding(claim.instance, candidate.id, directory, 0)
      })

    const reset: Interface["reset"] = (workspaceID, blockID, expectedSessionID, expectedRevision) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const model = ModelKey.decode(workspace.model)
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

    const createTab: Interface["createTab"] = (workspaceID, blockID, expectedBindingRevision, requestID) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
        if (!instance) return yield* new StaleBindingError({ currentRevision: 0 })
        const current = yield* bindingFromInstance(instance)
        if (!current) return yield* new StaleBindingError({ currentRevision: instance.revision })

        const existingRequest = yield* tabs.get(workspaceID, "operating-chat", requestID)
        if (existingRequest) {
          if (existingRequest.blockID !== blockID || !existingRequest.writable) {
            return yield* new CanvasTabService.BusyError({
              workspaceID,
              kind: "operating-chat",
              blockID,
              tabID: requestID,
              ownerBlockID: existingRequest.blockID,
            })
          }
          const registry = yield* tabs.block(workspaceID, "operating-chat", blockID)
          if (registry.selected.id === requestID && current.sessionID === existingRequest.conversationID) {
            return { binding: current, tabRevision: registry.revision }
          }
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }

        if (instance.revision !== expectedBindingRevision) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }

        const registry = yield* tabs.block(workspaceID, "operating-chat", blockID)
        if ((yield* hasPendingInput(current.sessionID)) || (yield* isActive(current.sessionID))) {
          return yield* new BusyError({ sessionID: current.sessionID })
        }
        const model = ModelKey.decode(workspace.model)
        const config = parseConfiguration(instance.configuration)
        const candidate = yield* sessions.create({
          model,
          location: { directory: AbsolutePath.make(resolveDirectory(workspace, config)), workspaceID },
        })
        const generation = current.generation + 1
        const next = OperatingChat.InstanceConfiguration.make({
          version: 1,
          directoryBinding: config.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: candidate.id, generation },
        })
        const transition = events
          .atomic(
            Effect.gen(function* () {
              if (!(yield* sessions.reserveIdle(current.sessionID))) {
                return yield* new BusyError({ sessionID: current.sessionID })
              }
              if ((yield* hasPendingInput(current.sessionID)) || (yield* isActive(current.sessionID))) {
                return yield* new BusyError({ sessionID: current.sessionID })
              }
              const added = yield* tabs.add(
                {
                  workspaceID,
                  kind: "operating-chat",
                  blockID,
                  conversationID: candidate.id,
                  title: candidate.title,
                  createdAt: DateTime.toEpochMillis(candidate.time.created),
                },
                registry.revision,
                requestID,
              )
              if (added.selected.id !== requestID || added.selected.conversationID !== candidate.id) {
                return yield* new CanvasTabService.BusyError({
                  workspaceID,
                  kind: "operating-chat",
                  blockID,
                  tabID: requestID,
                  ownerBlockID: added.selected.blockID,
                })
              }
              const claim = yield* swapConfiguration(instance, next)
              if (claim.type === "conflict") {
                return yield* new StaleBindingError({ currentRevision: claim.current.revision })
              }
              yield* events.publish(OperatingChat.BindingUpdated, {
                workspaceID,
                blockID,
                sessionID: candidate.id,
                generation,
                revision: claim.instance.revision,
              })
              return { instance: claim.instance, tabRevision: added.revision }
            }),
          )
          .pipe(Effect.tapError(() => sessions.cleanupLosingCandidate(candidate.id).pipe(Effect.asVoid)))
        const committed = yield* transition
        const binding = toBinding(committed.instance, candidate.id, candidate.location.directory, generation)
        return { binding, tabRevision: committed.tabRevision }
      })

    const selectTab: Interface["selectTab"] = (
      workspaceID,
      blockID,
      tabID,
      expectedBindingRevision,
      expectedTabRevision,
    ) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:operating-chat-session")
        if (!instance) return yield* new StaleBindingError({ currentRevision: 0 })
        if (instance.revision !== expectedBindingRevision) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        const current = yield* bindingFromInstance(instance)
        if (!current) return yield* new StaleBindingError({ currentRevision: instance.revision })
        const target = yield* tabs.get(workspaceID, "operating-chat", tabID)
        if (!target) return yield* new CanvasTabService.NotFoundError({ workspaceID, kind: "operating-chat", tabID })
        const targetSession = yield* sessionStore.get(SessionSchema.ID.make(target.conversationID))
        if (!targetSession || targetSession.location.workspaceID !== workspaceID) {
          return yield* new WrongTabError({ workspaceID, tabID })
        }
        const restoring = target.archivedAt !== undefined
        if (target.blockID === blockID && !restoring && current.sessionID === target.conversationID) {
          const selected = yield* tabs.select(
            { workspaceID, kind: "operating-chat", blockID, tabID },
            expectedTabRevision,
          )
          return { binding: current, tabRevision: selected.revision }
        }
        if ((yield* hasPendingInput(current.sessionID)) || (yield* isActive(current.sessionID))) {
          return yield* new BusyError({ sessionID: current.sessionID })
        }
        const model = ModelKey.decode(workspace.model)
        const config = parseConfiguration(instance.configuration)
        const generation = current.generation + 1
        const next = OperatingChat.InstanceConfiguration.make({
          version: 1,
          directoryBinding: config.directoryBinding,
          sessionBinding: { mode: "owned", sessionID: targetSession.id, generation },
        })
        const transition = events.atomic(
          Effect.gen(function* () {
            if (!(yield* sessions.reserveIdle(current.sessionID))) {
              return yield* new BusyError({ sessionID: current.sessionID })
            }
            if (
              targetSession.id !== current.sessionID &&
              (!(yield* sessions.reserveIdle(targetSession.id)) || (yield* hasPendingInput(targetSession.id)))
            ) {
              return yield* new BusyError({ sessionID: targetSession.id })
            }
            const selected = restoring
              ? yield* tabs.restore({ workspaceID, kind: "operating-chat", blockID, tabID }, expectedTabRevision)
              : yield* tabs.select({ workspaceID, kind: "operating-chat", blockID, tabID }, expectedTabRevision)
            yield* sessions.configure({ sessionID: targetSession.id, model })
            if ((yield* hasPendingInput(current.sessionID)) || (yield* isActive(current.sessionID))) {
              return yield* new BusyError({ sessionID: current.sessionID })
            }
            if (restoring) {
              yield* events.publish(SessionEvent.ArchiveStateChanged, {
                sessionID: targetSession.id,
                timestamp: yield* DateTime.now,
                archived: false,
              })
            }
            const claim = yield* swapConfiguration(instance, next)
            if (claim.type === "conflict") {
              return yield* new StaleBindingError({ currentRevision: claim.current.revision })
            }
            yield* events.publish(OperatingChat.BindingUpdated, {
              workspaceID,
              blockID,
              sessionID: targetSession.id,
              generation,
              revision: claim.instance.revision,
            })
            return { instance: claim.instance, tabRevision: selected.revision }
          }),
        )
        const committed = yield* transition
        const rebound = toBinding(committed.instance, targetSession.id, targetSession.location.directory, generation)
        return { binding: rebound, tabRevision: committed.tabRevision }
      })

    return Service.of({ get, ensure, reset, createTab, selectTab })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    CanvasTabService.node,
    WorkspaceService.node,
    FunctionalityInstance.node,
    SessionStore.node,
    EventV2.node,
    sessionPortLive,
  ],
})
