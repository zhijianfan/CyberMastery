import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionContextProfile } from "@opencode-ai/core/session/context-profile"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { OperatingChatContext } from "@opencode-ai/core/workspace/operating-chat-context"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { WorkspaceService } from "@opencode-ai/core/workspace/service"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "./lib/effect"

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
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      OperatingChatSessionService.node,
      SessionContextProfile.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      [SessionContextProfile.node, OperatingChatContext.node],
    ],
  ),
)

const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

function createWorkspace(name: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const directory = AbsolutePath.make(path.join(process.cwd(), name))
    const created = yield* workspace.create({ name })
    const info = yield* workspace.update(created.id, {
      directories: [directory],
      operatingAgent: "openai:gpt-5",
    })
    return { info, directory }
  })
}

function withBlock(workspaceID: Workspace.ID, blockID: string) {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "operating-chat-context-test")
    yield* workspace.layout.save(
      workspaceID,
      tuple,
      [
        {
          id: blockID,
          functionality: "builtin:operating-chat-session",
          transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
        },
        ...layout.blocks.filter((entry) => entry.id !== blockID),
      ],
      layout.revision,
      "operating-chat-context-test",
    )
  })
}

function createSession(workspaceID: Workspace.ID, directory: typeof AbsolutePath.Type) {
  return Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    return yield* sessions.create({ location: { workspaceID, directory } })
  })
}

describe("OperatingChat context profile", () => {
  it.effect("resolves the complete live OperatingChat authority proof", () =>
    Effect.gen(function* () {
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-live")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")

      expect(yield* profiles.resolve(binding.sessionID)).toEqual({
        kind: "operating-chat",
        workspaceID: workspace.info.id,
        workspaceName: "operating-profile-live",
        blockID: "block-a",
        functionalityID: "builtin:operating-chat-session",
        functionalityInstanceID: binding.functionalityInstanceID,
        generation: binding.generation,
        revision: binding.revision,
        location: workspace.directory,
        directory: workspace.directory,
        operatingAgent: "openai:gpt-5",
      })
    }),
  )

  it.effect("keeps ordinary and losing-candidate Sessions generic", () =>
    Effect.gen(function* () {
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-generic")
      yield* withBlock(workspace.info.id, "block-a")
      yield* operatingChat.ensure(workspace.info.id, "block-a")
      const ordinary = yield* createSession(workspace.info.id, workspace.directory)
      const losingCandidate = yield* createSession(workspace.info.id, workspace.directory)

      expect(yield* profiles.resolve(ordinary.id)).toEqual({ kind: "generic" })
      expect(yield* profiles.resolve(losingCandidate.id)).toEqual({ kind: "generic" })
    }),
  )

  it.effect("follows reset authority and stops resolving the replaced Session", () =>
    Effect.gen(function* () {
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-reset")
      yield* withBlock(workspace.info.id, "block-a")
      const first = yield* operatingChat.ensure(workspace.info.id, "block-a")
      const reset = yield* operatingChat.reset(workspace.info.id, "block-a", first.sessionID, first.revision)

      expect(yield* profiles.resolve(first.sessionID)).toEqual({ kind: "generic" })
      expect(yield* profiles.resolve(reset.sessionID)).toMatchObject({
        kind: "operating-chat",
        functionalityInstanceID: first.functionalityInstanceID,
        generation: first.generation + 1,
        revision: first.revision + 1,
      })
    }),
  )

  it.effect("ignores tombstoned FunctionalityInstance rows", () =>
    Effect.gen(function* () {
      const instances = yield* FunctionalityInstance.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-tombstone")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")
      const tombstoned = yield* instances.tombstone({
        instanceID: binding.functionalityInstanceID,
        expectedRevision: binding.revision,
      })

      expect(tombstoned).toEqual({ type: "tombstoned" })
      expect(yield* profiles.resolve(binding.sessionID)).toEqual({ kind: "generic" })
    }),
  )

  it.effect("fails with typed ambiguity when two live instances own one Session", () =>
    Effect.gen(function* () {
      const instances = yield* FunctionalityInstance.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-ambiguous")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")
      yield* instances.upsert({
        workspaceID: workspace.info.id,
        blockID: "block-b",
        functionalityID: "builtin:operating-chat-session",
        configuration: {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: { mode: "owned", sessionID: binding.sessionID, generation: 3 },
        },
      })

      const error = yield* profiles.resolve(binding.sessionID).pipe(Effect.flip)
      expect(error._tag).toBe("SessionContextProfile.AmbiguousError")
      expect(error.matches).toBe(2)
    }),
  )

  it.effect("revalidates unchanged proof and rejects reset or reconfiguration", () =>
    Effect.gen(function* () {
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspaceService = yield* WorkspaceService.Service
      const workspace = yield* createWorkspace("operating-profile-revalidate")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")
      const resolved = yield* profiles.resolve(binding.sessionID)

      yield* profiles.revalidate(binding.sessionID, resolved)
      const reset = yield* operatingChat.reset(workspace.info.id, "block-a", binding.sessionID, binding.revision)
      const resetError = yield* profiles.revalidate(binding.sessionID, resolved).pipe(Effect.flip)
      expect(resetError._tag).toBe("SessionContextProfile.StaleError")

      const current = yield* profiles.resolve(reset.sessionID)
      yield* workspaceService.rename(workspace.info.id, "operating-profile-renamed")
      const reconfigured = yield* profiles.revalidate(reset.sessionID, current).pipe(Effect.flip)
      expect(reconfigured._tag).toBe("SessionContextProfile.StaleError")
    }),
  )

  it.effect("rejects Session location and workspace moves without an instance revision change", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-move")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")
      const resolved = yield* profiles.resolve(binding.sessionID)
      const movedDirectory = AbsolutePath.make(path.join(process.cwd(), "operating-profile-moved"))
      yield* database.db
        .update(SessionTable)
        .set({ directory: movedDirectory })
        .where(eq(SessionTable.id, binding.sessionID))
        .run()
        .pipe(Effect.orDie)

      const locationError = yield* profiles.revalidate(binding.sessionID, resolved).pipe(Effect.flip)
      expect(locationError._tag).toBe("SessionContextProfile.StaleError")

      yield* database.db
        .update(SessionTable)
        .set({ directory: workspace.directory })
        .where(eq(SessionTable.id, binding.sessionID))
        .run()
        .pipe(Effect.orDie)
      const restored = yield* profiles.resolve(binding.sessionID)
      const other = yield* createWorkspace("operating-profile-other-workspace")
      yield* database.db
        .update(SessionTable)
        .set({ workspace_id: other.info.id })
        .where(eq(SessionTable.id, binding.sessionID))
        .run()
        .pipe(Effect.orDie)

      const workspaceError = yield* profiles.revalidate(binding.sessionID, restored).pipe(Effect.flip)
      expect(workspaceError._tag).toBe("SessionContextProfile.StaleError")
      expect(
        yield* database.db
          .select({ revision: FunctionalityInstanceTable.revision })
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.id, binding.functionalityInstanceID))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ revision: binding.revision })
    }),
  )

  it.effect("rejects generic proof after the Session acquires a live binding", () =>
    Effect.gen(function* () {
      const instances = yield* FunctionalityInstance.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-generic-race")
      const session = yield* createSession(workspace.info.id, workspace.directory)
      const generic = yield* profiles.resolve(session.id)
      expect(generic).toEqual({ kind: "generic" })

      yield* instances.upsert({
        workspaceID: workspace.info.id,
        blockID: "block-a",
        functionalityID: "builtin:operating-chat-session",
        configuration: {
          version: 1,
          directoryBinding: { mode: "workspace-primary" },
          sessionBinding: { mode: "owned", sessionID: session.id, generation: 0 },
        },
      })

      const error = yield* profiles.revalidate(session.id, generic).pipe(Effect.flip)
      expect(error._tag).toBe("SessionContextProfile.StaleError")
    }),
  )

  it.effect("does not write tables, Session metadata, or authority rows", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const profiles = yield* SessionContextProfile.Service
      const workspace = yield* createWorkspace("operating-profile-read-only")
      yield* withBlock(workspace.info.id, "block-a")
      const binding = yield* operatingChat.ensure(workspace.info.id, "block-a")
      const tablesBefore = (yield* database.db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )).map((row) => row.name)
      const sessionBefore = yield* database.db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, binding.sessionID))
        .get()
        .pipe(Effect.orDie)
      const instancesBefore = yield* database.db
        .select()
        .from(FunctionalityInstanceTable)
        .where(eq(FunctionalityInstanceTable.workspace_id, workspace.info.id))
        .all()
        .pipe(Effect.orDie)

      const resolved = yield* profiles.resolve(binding.sessionID)
      yield* profiles.revalidate(binding.sessionID, resolved)

      expect(
        (yield* database.db.all<{ name: string }>(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
        )).map((row) => row.name),
      ).toEqual(tablesBefore)
      expect(tablesBefore).not.toContain("session_context_target")
      expect(
        yield* database.db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, binding.sessionID))
          .get()
          .pipe(Effect.orDie),
      ).toEqual(sessionBefore)
      expect(sessionBefore?.metadata).toBeNull()
      expect(
        yield* database.db
          .select()
          .from(FunctionalityInstanceTable)
          .where(eq(FunctionalityInstanceTable.workspace_id, workspace.info.id))
          .all()
          .pipe(Effect.orDie),
      ).toEqual(instancesBefore)
    }),
  )
})
