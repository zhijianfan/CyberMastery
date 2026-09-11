export * as MasterAgentContext from "./master-agent-context"

import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Session } from "./session"
import { SessionID } from "./schema"

// Track R1 — MasterAgent Session Context Resolver.
//
// Resolves a running Session to its owning builtin:master-agent binding and
// the trusted host state the binding points at: workspace policy (primary
// model, operating agent, nullable Coder model) and the bound directory.
// Ordinary sessions resolve to `not-master-agent`; the resolver never applies
// MasterAgent restrictions globally and never accepts model/provider/
// directory/workspace overrides from tool arguments.

export interface ModelSelection {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type TaskPermission = "allow" | "deny" | "ask" | "default"

export interface MasterAgentSessionContext {
  readonly workspaceID: Workspace.ID
  readonly blockID: string
  readonly functionalityInstanceID: string
  readonly parentSessionID: SessionID
  readonly directory: string
  readonly primaryModel: ModelSelection | null
  readonly operatingAgent: string | null
  readonly coderModel: ModelSelection | null
  readonly taskPermission: TaskPermission
}

export type MasterAgentContextResult =
  | { readonly status: "master-agent"; readonly context: MasterAgentSessionContext }
  | { readonly status: "not-master-agent" }

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "MasterAgentContext.SessionNotFoundError",
  { sessionID: SessionID },
) {}

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "MasterAgentContext.WorkspaceNotFoundError",
  { workspaceID: Workspace.ID },
) {}

export class UnresolvedDirectoryError extends Schema.TaggedErrorClass<UnresolvedDirectoryError>()(
  "MasterAgentContext.UnresolvedDirectoryError",
  { workspaceID: Workspace.ID, blockID: Schema.String },
) {}

export type MasterAgentContextError = SessionNotFoundError | WorkspaceNotFoundError | UnresolvedDirectoryError

// Trusted host-state port. The live source reads the session record, the
// workspace row, and the workspace's functionality-instance rows; tests and
// composition layers can substitute fakes. The port never accepts caller
// overrides — every value is resolved from host state.
export interface SessionRecord {
  readonly workspaceID?: Workspace.ID
  readonly parentID?: SessionID
  readonly permission?: PermissionV1.Ruleset
}

export interface WorkspaceRecord {
  readonly model?: string
  readonly operatingAgent?: string
  // Nullable: explicit null means the workspace-wide Coder model is cleared
  // (matches Workspace.Info.coderModel from the live source).
  readonly coderModel?: string | null
  readonly directories: readonly string[]
}

export interface MasterAgentInstance {
  readonly instanceID: string
  readonly blockID: string
  readonly revision: number
  readonly configuration: unknown
}

export interface MasterAgentContextSource {
  readonly session: (sessionID: SessionID) => Effect.Effect<SessionRecord | undefined>
  readonly workspace: (workspaceID: Workspace.ID) => Effect.Effect<WorkspaceRecord | undefined>
  readonly instances: (workspaceID: Workspace.ID) => Effect.Effect<readonly MasterAgentInstance[]>
}

export class Source extends Context.Service<Source, MasterAgentContextSource>()(
  "@opencode/MasterAgentContextSource",
) {}

const liveSource = Layer.effect(
  Source,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const workspaces = yield* WorkspaceService.Service
    const { db } = yield* Database.Service
    return Source.of({
      session: (sessionID) =>
        sessions.get(sessionID).pipe(
          Effect.map((info) => ({
            workspaceID: info.workspaceID,
            parentID: info.parentID,
            permission: info.permission,
          })),
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
        ),
      workspace: (workspaceID) =>
        workspaces.get(workspaceID).pipe(
          Effect.map((info) =>
            info
              ? {
                  model: info.model,
                  operatingAgent: info.operatingAgent,
                  coderModel: info.coderModel,
                  directories: info.directories,
                }
              : undefined,
          ),
          // Typed 404 from the workspace service (E): a missing workspace is
          // an empty context, not a session-level failure.
          Effect.catchTag("Workspace.NotFoundError", () => Effect.succeed(undefined)),
        ),
      // Live rows only: tombstoned instances (deleted_at set) can never own a
      // binding, and instances are scoped to the session's workspace so a
      // cross-workspace reference cannot claim the session.
      instances: (workspaceID) =>
        db
          .select()
          .from(FunctionalityInstanceTable)
          .where(
            and(
              eq(FunctionalityInstanceTable.workspace_id, workspaceID),
              eq(FunctionalityInstanceTable.functionality_id, "builtin:master-agent"),
              isNull(FunctionalityInstanceTable.deleted_at),
            ),
          )
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) =>
              rows.map((row) => ({
                instanceID: row.id,
                blockID: row.block_id,
                revision: row.revision,
                configuration: row.configuration,
              })),
            ),
          ),
    })
  }),
)

export const sourceNode = LayerNode.make({
  service: Source,
  layer: liveSource,
  deps: [Session.node, WorkspaceService.node, Database.node],
})

export interface Interface {
  readonly resolve: (sessionID: SessionID) => Effect.Effect<MasterAgentContextResult, MasterAgentContextError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MasterAgentContext") {}

export function makeResolver(source: MasterAgentContextSource): Interface {
  const resolve = Effect.fn("MasterAgentContext.resolve")(function* (sessionID: SessionID) {
    const record = yield* source.session(sessionID)
    if (!record) return yield* new SessionNotFoundError({ sessionID })

    // Child Coder sessions are never top-level bindings, and a bound
    // MasterAgent session always carries its workspace ID.
    if (record.parentID !== undefined || record.workspaceID === undefined) {
      return { status: "not-master-agent" as const }
    }

    const instances = yield* source.instances(record.workspaceID)
    const [binding] = instances.flatMap((instance) => ownedBinding(instance, sessionID))
    if (!binding) return { status: "not-master-agent" as const }

    const workspace = yield* source.workspace(record.workspaceID)
    if (!workspace) return yield* new WorkspaceNotFoundError({ workspaceID: record.workspaceID })

    const directory = directoryFor(binding, workspace)
    if (directory === undefined) {
      return yield* new UnresolvedDirectoryError({ workspaceID: record.workspaceID, blockID: binding.blockID })
    }

    return {
      status: "master-agent" as const,
      context: {
        workspaceID: record.workspaceID,
        blockID: binding.blockID,
        functionalityInstanceID: binding.instanceID,
        parentSessionID: sessionID,
        directory,
        primaryModel: parseModelSelection(workspace.model),
        operatingAgent: workspace.operatingAgent ?? null,
        coderModel: parseModelSelection(workspace.coderModel),
        taskPermission: taskPermission(record.permission),
      },
    }
  })
  return { resolve }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const source = yield* Source
    return Service.of(makeResolver(source))
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [sourceNode] })

// An instance owns the session only when its persisted configuration decodes
// and its owned binding references exactly this session. Anything else —
// corrupt configuration, unbound instance, or a binding for a different
// session (stale after reset) — is not this session's binding.
function ownedBinding(
  instance: MasterAgentInstance,
  sessionID: SessionID,
): { readonly instanceID: string; readonly blockID: string; readonly directoryBinding: MasterAgent.DirectoryBinding } | undefined {
  const configuration = Option.getOrUndefined(
    Schema.decodeUnknownOption(MasterAgent.InstanceConfiguration)(instance.configuration),
  )
  const binding = configuration?.sessionBinding
  if (!binding || binding.sessionID !== sessionID) return undefined
  return {
    instanceID: instance.instanceID,
    blockID: instance.blockID,
    directoryBinding: configuration.directoryBinding,
  }
}

function directoryFor(
  binding: { readonly directoryBinding: MasterAgent.DirectoryBinding },
  workspace: WorkspaceRecord,
): string | undefined {
  if (binding.directoryBinding.mode === "fixed") return binding.directoryBinding.directory
  return workspace.directories[0]
}

// Workspace model selections are stored as "providerID:modelID" keys — the
// canvas model picker's key format and the existing Workspace.Info.model
// schema (contract 02 §2), with an optional ":variant" suffix. Rows written
// before the contract snapshot may carry the legacy "providerID/modelID"
// form; both separators decode, and anything else decodes as null (cleared),
// never as a partial selection.
export function parseModelSelection(value: string | null | undefined): ModelSelection | null {
  return Workspace.ModelSelection.decode(value) ?? null
}

// The session ruleset decides delegation authority for the "coder" pattern,
// mirroring Permission.evaluate("task", "coder", ruleset). No matching rule
// means "default" (delegation proceeds through the normal ask flow).
function taskPermission(ruleset: PermissionV1.Ruleset | undefined): TaskPermission {
  if (!ruleset || ruleset.length === 0) return "default"
  const rule = ruleset.findLast(
    (entry) => Wildcard.match("task", entry.permission) && Wildcard.match("coder", entry.pattern),
  )
  if (!rule) return "default"
  return rule.action
}
