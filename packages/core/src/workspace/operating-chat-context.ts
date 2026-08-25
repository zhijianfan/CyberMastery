export * as OperatingChatContext from "./operating-chat-context"

import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Layer, Option, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionContextProfile } from "../session/context-profile"
import { SessionTable } from "../session/sql"
import { FunctionalityInstanceTable, WorkspaceV2Table } from "./sql"

const layer = Layer.effect(
  SessionContextProfile.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeConfiguration = Schema.decodeUnknownOption(OperatingChat.InstanceConfiguration)

    const resolve: SessionContextProfile.Interface["resolve"] = Effect.fn("SessionContextProfile.resolve")(
      function* (sessionID) {
        const session = yield* db
          .select({ workspaceID: SessionTable.workspace_id, directory: SessionTable.directory })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        const generic = session
          ? { kind: "generic" as const, workspaceID: session.workspaceID ?? undefined, directory: session.directory }
          : { kind: "generic" as const }
        if (!session?.workspaceID) return generic
        const rows = yield* db
          .select({
            functionalityInstanceID: FunctionalityInstanceTable.id,
            blockID: FunctionalityInstanceTable.block_id,
            revision: FunctionalityInstanceTable.revision,
            configuration: FunctionalityInstanceTable.configuration,
          })
          .from(FunctionalityInstanceTable)
          .where(
            and(
              eq(FunctionalityInstanceTable.workspace_id, session.workspaceID),
              eq(FunctionalityInstanceTable.functionality_id, "builtin:operating-chat-session"),
              isNull(FunctionalityInstanceTable.deleted_at),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        const matches = rows.flatMap((row) => {
          const configuration = decodeConfiguration(row.configuration)
          if (Option.isNone(configuration)) return []
          const binding = configuration.value.sessionBinding
          if (!binding || binding.mode !== "owned" || binding.sessionID !== sessionID) return []
          return [{ row, binding }]
        })
        if (matches.length > 1) {
          return yield* new SessionContextProfile.AmbiguousError({ sessionID, matches: matches.length })
        }
        const match = matches[0]
        if (!match) return generic
        const workspace = yield* db
          .select({ name: WorkspaceV2Table.name, operatingAgent: WorkspaceV2Table.operating_agent })
          .from(WorkspaceV2Table)
          .where(eq(WorkspaceV2Table.id, session.workspaceID))
          .get()
          .pipe(Effect.orDie)
        if (!workspace) return generic
        return {
          kind: "operating-chat" as const,
          workspaceID: session.workspaceID,
          workspaceName: workspace.name,
          blockID: match.row.blockID,
          functionalityID: "builtin:operating-chat-session" as const,
          functionalityInstanceID: match.row.functionalityInstanceID,
          generation: match.binding.generation,
          revision: match.row.revision,
          directory: session.directory,
          operatingAgent: workspace.operatingAgent ?? "",
        }
      },
    )

    return SessionContextProfile.Service.of({
      resolve,
      revalidate: Effect.fn("SessionContextProfile.revalidate")(function* (sessionID, profile) {
        const current = yield* resolve(sessionID)
        if (sameProfile(current, profile)) return
        return yield* new SessionContextProfile.StaleError({ sessionID })
      }),
    })
  }),
)

function sameProfile(current: SessionContextProfile.Profile, expected: SessionContextProfile.Profile) {
  if (current.kind !== expected.kind) return false
  if (current.kind === "generic" || expected.kind === "generic") {
    return current.workspaceID === expected.workspaceID && current.directory === expected.directory
  }
  return (
    current.workspaceID === expected.workspaceID &&
    current.workspaceName === expected.workspaceName &&
    current.blockID === expected.blockID &&
    current.functionalityID === expected.functionalityID &&
    current.functionalityInstanceID === expected.functionalityInstanceID &&
    current.generation === expected.generation &&
    current.revision === expected.revision &&
    current.directory === expected.directory &&
    current.operatingAgent === expected.operatingAgent
  )
}

export const node = makeGlobalNode({ service: SessionContextProfile.Service, layer, deps: [Database.node] })
