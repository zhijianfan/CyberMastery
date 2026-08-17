export * as MasterAgentService from "./master-agent"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { FunctionalityInstance } from "./functionality-instance"
import { WorkspaceService } from "./service"

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "MasterAgent.WorkspaceNotFoundError",
  { workspaceID: Workspace.ID },
) {}

export class WrongFunctionalityError extends Schema.TaggedErrorClass<WrongFunctionalityError>()(
  "MasterAgent.WrongFunctionalityError",
  { blockID: Schema.String },
) {}

export class StaleBindingError extends Schema.TaggedErrorClass<StaleBindingError>()("MasterAgent.StaleBindingError", {
  currentRevision: Schema.Number,
}) {}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("MasterAgent.BusyError", {
  sessionID: SessionSchema.ID,
}) {}

// Narrow session port: the MasterAgent service only needs session creation
// and liveness, so it does not drag the full session execution engine into
// its dependency graph. The opencode/server composition provides the live
// adapter (sessionPortLive); tests provide a lightweight stub.
export interface SessionPort {
  readonly create: (input: {
    id?: SessionSchema.ID
    location: { directory: typeof AbsolutePath.Type; workspaceID?: Workspace.ID }
  }) => Effect.Effect<SessionSchema.Info>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
}

export class SessionPortService extends Context.Service<SessionPortService, SessionPort>()(
  "@opencode/v2/MasterAgentSessionPort",
) {}

export const sessionPort = LayerNode.unbound(SessionPortService, tags.values.global)

export const sessionPortLive = LayerNode.make({
  name: "MasterAgentSessionPortLive",
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
      })
    }),
  ),
  deps: [SessionV2.node],
})

export interface Interface {
  readonly get: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    MasterAgent.Binding | undefined,
    WorkspaceNotFoundError | WrongFunctionalityError
  >
  readonly ensure: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<
    MasterAgent.Binding,
    WorkspaceNotFoundError | WrongFunctionalityError
  >
  readonly reset: (
    workspaceID: Workspace.ID,
    blockID: string,
    expectedSessionID: SessionSchema.ID,
    expectedRevision: number,
  ) => Effect.Effect<
    MasterAgent.Binding,
    WorkspaceNotFoundError | WrongFunctionalityError | StaleBindingError | BusyError
  >
  readonly tombstone: (workspaceID: Workspace.ID, blockID: string) => Effect.Effect<void, WorkspaceNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MasterAgent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const workspaceService = yield* WorkspaceService.Service
    const instances = yield* FunctionalityInstance.Service
    const sessions = yield* SessionV2.Service
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
          "master-agent-service",
        )
        const block = layout.blocks.find((entry) => entry.id === blockID)
        if (!block || block.functionality !== "builtin:master-agent") {
          return yield* new WrongFunctionalityError({ blockID })
        }
        return block
      })
    }

    function directoryFor(workspace: Workspace.Info, configuration: unknown) {
      const config = MasterAgent.InstanceConfiguration.make(
        (configuration ?? {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: null,
        }) as MasterAgent.InstanceConfiguration,
      )
      if (config.directoryBinding.mode === "fixed") return config.directoryBinding.directory
      return workspace.directories[0]
    }

    function toBinding(
      instance: FunctionalityInstance.Instance,
      sessionID: SessionSchema.ID,
      directory: string,
      generation: number,
    ): MasterAgent.Binding {
      return MasterAgent.Binding.make({
        workspaceID: instance.workspaceID,
        blockID: instance.blockID,
        functionalityInstanceID: instance.id,
        sessionID,
        directory,
        generation,
        revision: instance.revision,
      })
    }

    function readBinding(workspaceID: Workspace.ID, blockID: string) {
      return Effect.gen(function* () {
        const instance = yield* instances.get(workspaceID, blockID, "builtin:master-agent")
        if (!instance) return undefined
        const workspace = yield* requireWorkspace(workspaceID)
        const config = (instance.configuration ?? {}) as Partial<MasterAgent.InstanceConfiguration>
        const binding = config.sessionBinding
        if (!binding || binding.mode !== "owned") return undefined
        return toBinding(instance, binding.sessionID, directoryFor(workspace, instance.configuration) ?? "", binding.generation)
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

        const directory = workspace.directories[0]
        const session = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory ?? process.cwd()),
            workspaceID,
          },
        })
        const configuration = MasterAgent.InstanceConfiguration.make({
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: { mode: "owned", sessionID: session.id, generation: 0 },
        })
        const instance = yield* instances.upsert({
          workspaceID,
          blockID,
          functionalityID: "builtin:master-agent",
          configuration,
        })
        yield* events.publish(MasterAgent.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: session.id,
          generation: 0,
          revision: instance.revision,
        })
        return toBinding(instance, session.id, directory ?? "", 0)
      })

    const reset: Interface["reset"] = (workspaceID, blockID, expectedSessionID, expectedRevision) =>
      Effect.gen(function* () {
        const workspace = yield* requireWorkspace(workspaceID)
        yield* verifyBlock(workspaceID, blockID)
        const instance = yield* instances.get(workspaceID, blockID, "builtin:master-agent")
        if (!instance) {
          return yield* ensure(workspaceID, blockID)
        }
        if (instance.revision !== expectedRevision) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        const config = (instance.configuration ?? {}) as Partial<MasterAgent.InstanceConfiguration>
        const currentBinding = config.sessionBinding
        if (!currentBinding || currentBinding.mode !== "owned" || currentBinding.sessionID !== expectedSessionID) {
          return yield* new StaleBindingError({ currentRevision: instance.revision })
        }
        if ((yield* hasPendingInput(expectedSessionID)) || (yield* isActive(expectedSessionID))) {
          return yield* new BusyError({ sessionID: expectedSessionID })
        }
        const directory = workspace.directories[0]
        const session = yield* sessions.create({
          location: {
            directory: AbsolutePath.make(directory ?? process.cwd()),
            workspaceID,
          },
        })
        const generation = currentBinding.generation + 1
        const next = yield* instances.upsert({
          workspaceID,
          blockID,
          functionalityID: "builtin:master-agent",
          configuration: MasterAgent.InstanceConfiguration.make({
            version: 1,
            directoryBinding: { mode: "workspace-primary" },
            sessionBinding: { mode: "owned", sessionID: session.id, generation },
          }),
        })
        yield* events.publish(MasterAgent.BindingUpdated, {
          workspaceID,
          blockID,
          sessionID: session.id,
          generation,
          revision: next.revision,
        })
        return toBinding(next, session.id, directory ?? "", generation)
      })

    const tombstone: Interface["tombstone"] = (workspaceID, blockID) =>
      Effect.gen(function* () {
        yield* requireWorkspace(workspaceID)
        // Preserves the host Session record, running work, and queued inputs;
        // only the visible functionality instance is removed.
        yield* instances.tombstone(workspaceID, blockID, "builtin:master-agent")
      })

    return Service.of({ get, ensure, reset, tombstone })
  }),
)

// The service requires the Session domain service via context; the full
// Session node (with its execution engine) is provided by the server/opencode
// composition layer, keeping this node composable in lightweight tests.
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, WorkspaceService.node, FunctionalityInstance.node, EventV2.node],
})
