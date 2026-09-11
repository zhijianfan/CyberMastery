import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { OperatingChatContext } from "@opencode-ai/core/workspace/operating-chat-context"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { OperatingChat } from "@opencode-ai/schema/operating-chat"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, WorkspaceService.node, SessionContextProfile.node]),
    [[SessionContextProfile.node, OperatingChatContext.node]],
  ),
)

function createWorkspace(name: string, model = "openai:gpt-5") {
  return Effect.gen(function* () {
    const workspaces = yield* WorkspaceService.Service
    const workspace = yield* workspaces.create({ name })
    return yield* workspaces.update(workspace.id, { model, operatingAgent: "openai:deprecated" })
  })
}

function createSession(workspaceID: Workspace.ID, directory: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const sessionID = SessionSchema.ID.create()
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        workspace_id: workspaceID,
        slug: "operating-chat-context-test",
        directory: AbsolutePath.make(directory),
        title: "operating-chat-context-test",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return sessionID
  })
}

function createBinding(input: {
  workspaceID: Workspace.ID
  sessionID: SessionSchema.ID
  blockID?: string
  generation?: number
  revision?: number
  deletedAt?: number | null
}) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const instanceID = crypto.randomUUID()
    yield* db
      .insert(FunctionalityInstanceTable)
      .values({
        id: instanceID,
        workspace_id: input.workspaceID,
        block_id: input.blockID ?? crypto.randomUUID(),
        functionality_id: "builtin:operating-chat-session",
        revision: input.revision ?? 0,
        configuration: OperatingChat.InstanceConfiguration.make({
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: {
            mode: "owned",
            sessionID: input.sessionID,
            generation: input.generation ?? 0,
          },
        }),
        deleted_at: input.deletedAt ?? null,
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
    return instanceID
  })
}

function expectStale(effect: Effect.Effect<void, SessionContextProfile.Error>) {
  return Effect.gen(function* () {
    const error = yield* effect.pipe(Effect.flip)
    expect(error._tag).toBe("SessionContextProfile.StaleError")
  })
}

describe("OperatingChat session context profile", () => {
  it.effect("resolves the complete live binding proof", () =>
    Effect.gen(function* () {
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`profile-${crypto.randomUUID()}`, "anthropic:claude-sonnet-4-5")
      const directory = AbsolutePath.make(`${process.cwd()}\\profile-live-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, directory)
      const instanceID = yield* createBinding({
        workspaceID: workspace.id,
        sessionID,
        blockID: "block-live",
        generation: 3,
        revision: 7,
      })

      expect(yield* profileService.resolve(sessionID)).toEqual({
        kind: "operating-chat",
        workspaceID: workspace.id,
        workspaceName: workspace.name,
        blockID: "block-live",
        functionalityID: "builtin:operating-chat-session",
        functionalityInstanceID: instanceID,
        generation: 3,
        revision: 7,
        directory,
        operatingAgent: "anthropic:claude-sonnet-4-5",
      })
    }),
  )

  it.effect("returns generic only after checking ordinary, losing, and tombstoned Sessions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`generic-${crypto.randomUUID()}`)
      const ordinaryDirectory = AbsolutePath.make(`${process.cwd()}\\ordinary-${crypto.randomUUID()}`)
      const ordinary = yield* createSession(workspace.id, ordinaryDirectory)
      const winner = yield* createSession(workspace.id, `${process.cwd()}\\winner-${crypto.randomUUID()}`)
      const loserDirectory = AbsolutePath.make(`${process.cwd()}\\loser-${crypto.randomUUID()}`)
      const loser = yield* createSession(workspace.id, loserDirectory)
      const tombstonedDirectory = AbsolutePath.make(`${process.cwd()}\\tombstoned-${crypto.randomUUID()}`)
      const tombstoned = yield* createSession(workspace.id, tombstonedDirectory)
      yield* createBinding({ workspaceID: workspace.id, sessionID: winner, blockID: "block-winner" })
      yield* createBinding({
        workspaceID: workspace.id,
        sessionID: tombstoned,
        blockID: "block-tombstoned",
        deletedAt: Date.now(),
      })
      const before = yield* db.select().from(SessionTable).where(eq(SessionTable.id, ordinary)).get().pipe(Effect.orDie)

      expect(yield* profileService.resolve(ordinary)).toEqual({
        kind: "generic",
        workspaceID: workspace.id,
        directory: ordinaryDirectory,
      })
      expect(yield* profileService.resolve(loser)).toEqual({
        kind: "generic",
        workspaceID: workspace.id,
        directory: loserDirectory,
      })
      expect(yield* profileService.resolve(tombstoned)).toEqual({
        kind: "generic",
        workspaceID: workspace.id,
        directory: tombstonedDirectory,
      })
      expect(
        yield* db.select().from(SessionTable).where(eq(SessionTable.id, ordinary)).get().pipe(Effect.orDie),
      ).toEqual(before)
    }),
  )

  it.effect("fails with typed ambiguity instead of choosing a live row", () =>
    Effect.gen(function* () {
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`ambiguous-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, `${process.cwd()}\\ambiguous-${crypto.randomUUID()}`)
      yield* createBinding({ workspaceID: workspace.id, sessionID, blockID: "block-a" })
      yield* createBinding({ workspaceID: workspace.id, sessionID, blockID: "block-b" })

      const error = yield* profileService.resolve(sessionID).pipe(Effect.flip)
      expect(error._tag).toBe("SessionContextProfile.AmbiguousError")
      expect(error.matches).toBe(2)
    }),
  )

  it.effect("revalidates unchanged authority and rejects reset and tombstone", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`revalidate-${crypto.randomUUID()}`)
      const directory = AbsolutePath.make(`${process.cwd()}\\revalidate-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, directory)
      const instanceID = yield* createBinding({ workspaceID: workspace.id, sessionID, blockID: "block-revalidate" })
      const profile = yield* profileService.resolve(sessionID)
      yield* profileService.revalidate(sessionID, profile)

      const replacement = yield* createSession(
        workspace.id,
        AbsolutePath.make(`${process.cwd()}\\reset-${crypto.randomUUID()}`),
      )
      yield* db
        .update(FunctionalityInstanceTable)
        .set({
          revision: 1,
          configuration: OperatingChat.InstanceConfiguration.make({
            version: 1,
            directoryBinding: { mode: "workspace-primary" },
            sessionBinding: { mode: "owned", sessionID: replacement, generation: 1 },
          }),
          time_updated: Date.now(),
        })
        .where(eq(FunctionalityInstanceTable.id, instanceID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(sessionID, profile))
      expect(yield* profileService.resolve(sessionID)).toEqual({
        kind: "generic",
        workspaceID: workspace.id,
        directory,
      })

      const reset = yield* profileService.resolve(replacement)
      expect(reset.kind).toBe("operating-chat")
      if (reset.kind === "operating-chat") {
        expect(reset.generation).toBe(1)
        expect(reset.revision).toBe(1)
      }
      yield* db
        .update(FunctionalityInstanceTable)
        .set({ deleted_at: Date.now(), time_updated: Date.now() })
        .where(eq(FunctionalityInstanceTable.id, instanceID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(replacement, reset))
    }),
  )

  it.effect("rejects workspace, Main model, and Session location proof changes", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const profileService = yield* SessionContextProfile.Service
      const workspaces = yield* WorkspaceService.Service
      const workspace = yield* createWorkspace(`move-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, `${process.cwd()}\\move-${crypto.randomUUID()}`)
      yield* createBinding({ workspaceID: workspace.id, sessionID, blockID: "block-move" })

      const original = yield* profileService.resolve(sessionID)
      yield* workspaces.update(workspace.id, { name: `${workspace.name}-renamed` })
      yield* expectStale(profileService.revalidate(sessionID, original))

      const renamed = yield* profileService.resolve(sessionID)
      yield* workspaces.update(workspace.id, { operatingAgent: "openai:ignored" })
      yield* profileService.revalidate(sessionID, renamed)
      yield* workspaces.update(workspace.id, { model: "openai:gpt-5.1" })
      yield* expectStale(profileService.revalidate(sessionID, renamed))

      const reconfigured = yield* profileService.resolve(sessionID)
      yield* db
        .update(SessionTable)
        .set({ directory: AbsolutePath.make(`${process.cwd()}\\moved-${crypto.randomUUID()}`) })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(sessionID, reconfigured))

      const movedDirectory = yield* profileService.resolve(sessionID)
      const destination = yield* createWorkspace(`destination-${crypto.randomUUID()}`)
      yield* db
        .update(SessionTable)
        .set({ workspace_id: destination.id })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(sessionID, movedDirectory))
    }),
  )

  it.effect("rejects a generic proof when a live binding appears", () =>
    Effect.gen(function* () {
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`generic-bound-${crypto.randomUUID()}`)
      const directory = AbsolutePath.make(`${process.cwd()}\\generic-bound-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, directory)
      const generic = yield* profileService.resolve(sessionID)
      expect(generic).toEqual({ kind: "generic", workspaceID: workspace.id, directory })

      yield* createBinding({ workspaceID: workspace.id, sessionID, blockID: "block-new" })
      yield* expectStale(profileService.revalidate(sessionID, generic))
    }),
  )

  it.effect("rejects a generic proof when the persisted Session location changes", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const profileService = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace(`generic-location-${crypto.randomUUID()}`)
      const sessionID = yield* createSession(workspace.id, `${process.cwd()}\\generic-location-${crypto.randomUUID()}`)
      const original = yield* profileService.resolve(sessionID)

      yield* db
        .update(SessionTable)
        .set({ directory: AbsolutePath.make(`${process.cwd()}\\generic-moved-${crypto.randomUUID()}`) })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(sessionID, original))

      const movedDirectory = yield* profileService.resolve(sessionID)
      const destination = yield* createWorkspace(`generic-destination-${crypto.randomUUID()}`)
      yield* db
        .update(SessionTable)
        .set({ workspace_id: destination.id })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* expectStale(profileService.revalidate(sessionID, movedDirectory))
    }),
  )
})
