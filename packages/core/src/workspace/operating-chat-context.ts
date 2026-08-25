export * as OperatingChatContext from "./operating-chat-context"

import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionContextProfile } from "../session/context-profile"
import { SessionTable } from "../session/sql"
import { FunctionalityInstanceTable } from "./sql"
import { WorkspaceService } from "./service"

const layer = Layer.effect(
  SessionContextProfile.Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const workspaces = yield* WorkspaceService.Service
    const isConfiguration = Schema.is(OperatingChat.InstanceConfiguration)

    const resolve: SessionContextProfile.Interface["resolve"] = (sessionID) =>
      Effect.gen(function* () {
        const rows = yield* database.db
          .select({
            workspaceID: FunctionalityInstanceTable.workspace_id,
            location: SessionTable.directory,
            functionalityInstanceID: FunctionalityInstanceTable.id,
            blockID: FunctionalityInstanceTable.block_id,
            revision: FunctionalityInstanceTable.revision,
            configuration: FunctionalityInstanceTable.configuration,
          })
          .from(SessionTable)
          .innerJoin(
            FunctionalityInstanceTable,
            and(
              eq(FunctionalityInstanceTable.workspace_id, SessionTable.workspace_id),
              eq(FunctionalityInstanceTable.functionality_id, "builtin:operating-chat-session"),
              isNull(FunctionalityInstanceTable.deleted_at),
            ),
          )
          .where(eq(SessionTable.id, sessionID))
          .all()
          .pipe(Effect.orDie)
        const matches = rows.flatMap((row) => {
          if (!isConfiguration(row.configuration)) return []
          const binding = row.configuration.sessionBinding
          if (!binding || binding.mode !== "owned" || binding.sessionID !== sessionID) return []
          return [{ row, configuration: row.configuration, binding }]
        })
        if (matches.length > 1)
          return yield* new SessionContextProfile.AmbiguousError({ sessionID, matches: matches.length })
        const match = matches[0]
        if (!match) return { kind: "generic" as const }
        const workspace = yield* workspaces.get(match.row.workspaceID).pipe(Effect.orDie)
        if (!workspace.operatingAgent) {
          return yield* Effect.die(new Error(`OperatingChat workspace ${workspace.id} has no OperatingAgent`))
        }
        return {
          kind: "operating-chat" as const,
          workspaceID: workspace.id,
          workspaceName: workspace.name,
          blockID: match.row.blockID,
          functionalityID: "builtin:operating-chat-session" as const,
          functionalityInstanceID: match.row.functionalityInstanceID,
          generation: match.binding.generation,
          revision: match.row.revision,
          location: match.row.location,
          directory:
            match.configuration.directoryBinding.mode === "fixed"
              ? match.configuration.directoryBinding.directory
              : (workspace.directories[0] ?? process.cwd()),
          operatingAgent: workspace.operatingAgent,
        }
      })

    const revalidate: SessionContextProfile.Interface["revalidate"] = (sessionID, profile) =>
      Effect.gen(function* () {
        const current = yield* resolve(sessionID)
        if (current.kind === "generic" && profile.kind === "generic") return
        if (
          current.kind === "operating-chat" &&
          profile.kind === "operating-chat" &&
          current.workspaceID === profile.workspaceID &&
          current.workspaceName === profile.workspaceName &&
          current.blockID === profile.blockID &&
          current.functionalityID === profile.functionalityID &&
          current.functionalityInstanceID === profile.functionalityInstanceID &&
          current.generation === profile.generation &&
          current.revision === profile.revision &&
          current.location === profile.location &&
          current.directory === profile.directory &&
          current.operatingAgent === profile.operatingAgent
        )
          return
        return yield* new SessionContextProfile.StaleError({ sessionID })
      })

    return SessionContextProfile.Service.of({ resolve, revalidate })
  }),
)

export const node = makeGlobalNode({
  service: SessionContextProfile.Service,
  layer,
  deps: [Database.node, WorkspaceService.node],
})
