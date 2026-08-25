// MasterAgent session integration tests (Track V1).
//
// Exercises the real, committed layers — MasterAgentService (F4),
// FunctionalityInstance (F1 CAS), WorkspaceService (D4), the real SessionV2
// session domain, and the real EventV2 bus — over the shared test SQLite
// database. Unlike the leaf unit tests (packages/core/test/workspace/
// master-agent.test.ts), no session port is stubbed: session rows, admitted
// inputs, and bindings are all created through the real services and checked
// against real durable rows.
//
// The Session execution engine is intentionally not started: SessionExecution
// is replaced with its noop layer (the same pattern as session-create.test.ts)
// and ProjectV2 resolves to the global project, so the session domain records
// durably without spawning runners. The "active session" reset guard therefore
// never triggers here; the busy path is exercised through real pending inputs.

import { describe, expect, test } from "bun:test"
import path from "path"
import { and, eq } from "drizzle-orm"
import { Effect, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { ChatRelaySessionService } from "@opencode-ai/core/workspace/chat-relay-session"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { Workspace } from "@opencode-ai/schema/workspace"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"
import { managedNotReadySessionContext } from "../fixture/session-context"

// The session domain resolves the project for a directory; the global project
// keeps creation deterministic without touching the filesystem.
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const buildRealLayer = () =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      WorkspaceService.node,
      FunctionalityInstance.node,
      MasterAgentService.node,
    ]),
    [...managedNotReadySessionContext, [ProjectV2.node, projects], [SessionExecution.node, SessionExecution.noopLayer]],
  )

const it = testEffect(buildRealLayer())

const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })

// Adds a block to the workspace layout while preserving existing blocks.
function withBlock(workspaceID: Workspace.ID, blockID: string, functionality = "builtin:master-agent") {
  return Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const layout = yield* workspace.layout.get(workspaceID, tuple, "master-agent-integration")
    const blocks = [
      { id: blockID, functionality, transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } },
      ...layout.blocks.filter((entry) => entry.id !== blockID),
    ]
    yield* workspace.layout.save(workspaceID, tuple, blocks, layout.revision, "master-agent-integration")
  })
}

describe("master-agent session integration", () => {
  it.effect("two blocks produce distinct durable top-level sessions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const info = yield* workspace.create({ name: "ma-int-two" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")

      const a = yield* masterAgent.ensure(info.id, "block-a")
      const b = yield* masterAgent.ensure(info.id, "block-b")
      expect(a.sessionID).not.toBe(b.sessionID)

      // Durable top-level rows: readable through the real session service,
      // bound to the workspace, and not child sessions.
      for (const binding of [a, b]) {
        const session = yield* sessions.get(binding.sessionID)
        expect(session.id).toBe(binding.sessionID)
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, binding.sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(row?.workspace_id).toBe(info.id)
        expect(row?.parent_id).toBeNull()
      }
      const listed = yield* sessions.list({ workspaceID: info.id })
      const ids = listed.map((session) => session.id)
      expect(ids).toContain(a.sessionID)
      expect(ids).toContain(b.sessionID)
    }),
  )

  it.effect("simultaneous ensure yields one persisted binding; any losing candidate stays empty", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const info = yield* workspace.create({ name: "ma-int-race" })
      yield* withBlock(info.id, "block-a")

      const fiberA = yield* masterAgent.ensure(info.id, "block-a").pipe(Effect.forkChild)
      const fiberB = yield* masterAgent.ensure(info.id, "block-a").pipe(Effect.forkChild)
      const [a, b] = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)])

      // Both callers observe the same single binding.
      expect(a.sessionID).toBe(b.sessionID)
      const persisted = yield* masterAgent.get(info.id, "block-a")
      expect(persisted?.sessionID).toBe(a.sessionID)

      // Exactly one durable instance row for the block.
      const instances = yield* db
        .select()
        .from(FunctionalityInstanceTable)
        .where(
          and(eq(FunctionalityInstanceTable.workspace_id, info.id), eq(FunctionalityInstanceTable.block_id, "block-a")),
        )
        .all()
        .pipe(Effect.orDie)
      expect(instances).toHaveLength(1)

      // Any session the losing caller created is unbound and carries no queue
      // state: no visible messages and no admitted inputs, so the best-effort
      // cleanup has nothing to preserve.
      const created = yield* sessions.list({ workspaceID: info.id })
      for (const session of created) {
        if (session.id === a.sessionID) continue
        const messages = yield* sessions.messages({ sessionID: session.id })
        expect(messages).toHaveLength(0)
        const inputs = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie)
        expect(inputs).toHaveLength(0)
      }
    }),
  )

  it.effect("reset rejects stale expected session/revision and a busy session", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const info = yield* workspace.create({ name: "ma-int-guards" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")

      const staleRevision = yield* masterAgent
        .reset(info.id, "block-a", binding.sessionID, binding.revision + 10)
        .pipe(Effect.flip)
      expect(staleRevision._tag).toBe("MasterAgent.StaleBindingError")

      const staleSession = yield* masterAgent
        .reset(info.id, "block-a", SessionSchema.ID.create(), binding.revision)
        .pipe(Effect.flip)
      expect(staleSession._tag).toBe("MasterAgent.StaleBindingError")

      // Admit a queued input through the real admission path; the service's
      // pending-input check reads the same rows.
      yield* sessions.prompt({
        sessionID: binding.sessionID,
        prompt: { text: "pending work" },
        delivery: "queue",
        resume: false,
      })
      const busy = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision).pipe(Effect.flip)
      expect(busy._tag).toBe("MasterAgent.BusyError")

      // Promotion at the safe boundary (the serialized runner's job) unblocks
      // the reset; the old session remains the reset guard's only concern.
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.session_id, binding.sessionID))
        .run()
        .pipe(Effect.orDie)
      const reset = yield* masterAgent.reset(info.id, "block-a", binding.sessionID, binding.revision)
      expect(reset.sessionID).not.toBe(binding.sessionID)
    }),
  )

  it.effect("reset affects only the target block and preserves the old session's history", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const info = yield* workspace.create({ name: "ma-int-reset" })
      yield* withBlock(info.id, "block-a")
      yield* withBlock(info.id, "block-b")
      const a = yield* masterAgent.ensure(info.id, "block-a")
      const b = yield* masterAgent.ensure(info.id, "block-b")

      // Real admission, then promotion so the input becomes history and no
      // longer blocks the reset.
      yield* sessions.prompt({
        sessionID: a.sessionID,
        prompt: { text: "remember me" },
        delivery: "queue",
        resume: false,
      })
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.session_id, a.sessionID))
        .run()
        .pipe(Effect.orDie)

      const reset = yield* masterAgent.reset(info.id, "block-a", a.sessionID, a.revision)
      expect(reset.sessionID).not.toBe(a.sessionID)
      expect(reset.generation).toBe(a.generation + 1)
      expect(reset.revision).toBe(a.revision + 1)

      // The old session and its admitted history survive the reset.
      const old = yield* sessions.get(a.sessionID)
      expect(old.id).toBe(a.sessionID)
      const inputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, a.sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(inputs).toHaveLength(1)

      // The sibling block's binding is untouched.
      const untouched = yield* masterAgent.get(info.id, "block-b")
      expect(untouched?.sessionID).toBe(b.sessionID)
      expect(untouched?.revision).toBe(b.revision)
    }),
  )

  it.effect("tombstone preserves the session and its admitted queue", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const info = yield* workspace.create({ name: "ma-int-tomb" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      yield* sessions.prompt({
        sessionID: binding.sessionID,
        prompt: { text: "queued task" },
        delivery: "queue",
        resume: false,
      })

      yield* masterAgent.tombstone(info.id, "block-a")
      const after = yield* masterAgent.get(info.id, "block-a")
      expect(after).toBeUndefined()

      // The host session row and its queued input are preserved.
      const session = yield* sessions.get(binding.sessionID)
      expect(session.id).toBe(binding.sessionID)
      const inputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, binding.sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(inputs).toHaveLength(1)
      expect(inputs[0]?.delivery).toBe("queue")

      // Re-ensure resurrects the instance with a fresh session; the old queue
      // is untouched.
      const rebound = yield* masterAgent.ensure(info.id, "block-a")
      expect(rebound.sessionID).not.toBe(binding.sessionID)
      const oldInputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, binding.sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(oldInputs).toHaveLength(1)
    }),
  )

  it.effect("coderModel set/clear/reload through the real service alongside the binding lifecycle", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-int-coder" })
      yield* withBlock(info.id, "block-a")

      const set = yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      expect(set.coderModel).toBe("anthropic/claude-haiku")

      // The binding lifecycle must not disturb the workspace-wide selection.
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      expect(binding.sessionID.startsWith("ses_")).toBe(true)
      const afterEnsure = yield* workspace.get(info.id)
      expect(afterEnsure?.coderModel).toBe("anthropic/claude-haiku")

      // Reload: a fresh read from the row keeps the selection.
      const reloaded = yield* workspace.get(info.id)
      expect(reloaded?.coderModel).toBe("anthropic/claude-haiku")

      // Explicit null clears it workspace-wide.
      const cleared = yield* workspace.update(info.id, { coderModel: null })
      expect(cleared.coderModel).toBeUndefined()
      const afterClear = yield* workspace.get(info.id)
      expect(afterClear?.coderModel).toBeUndefined()
    }),
  )
})

describe("master-agent binding reload", () => {
  test("reload/reconnect preserves the binding across independent service stacks", async () => {
    // A fresh service stack over the SAME database file simulates a server
    // reload/reconnect: nothing is shared except the persisted rows. The
    // test preload forces :memory:, so both stacks explicitly share a
    // file-backed database (same pattern as session-create.test.ts).
    const tmp = await tmpdir()
    const database = Database.layerFromPath(path.join(tmp.path, "reload.sqlite"))
    const layer = () =>
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          SessionProjector.node,
          SessionStore.node,
          SessionV2.node,
          WorkspaceService.node,
          FunctionalityInstance.node,
          MasterAgentService.node,
        ]),
        [
          ...managedNotReadySessionContext,
          [ProjectV2.node, projects],
          [SessionExecution.node, SessionExecution.noopLayer],
          [Database.node, database],
        ],
      )

    const setup = await Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const masterAgent = yield* MasterAgentService.Service
      const info = yield* workspace.create({ name: "ma-int-reload" })
      yield* withBlock(info.id, "block-a")
      const binding = yield* masterAgent.ensure(info.id, "block-a")
      return { workspaceID: info.id, binding }
    }).pipe(Effect.provide(layer()), Effect.runPromise)

    // A fresh stack over the same database file simulates a server
    // reload/reconnect: nothing is shared except the persisted rows.
    await Effect.gen(function* () {
      const masterAgent = yield* MasterAgentService.Service
      const sessions = yield* SessionV2.Service
      const binding = yield* masterAgent.get(setup.workspaceID, "block-a")
      expect(binding?.sessionID).toBe(setup.binding.sessionID)
      expect(binding?.revision).toBe(setup.binding.revision)

      // ensure on the reloaded stack is idempotent against the persisted row.
      const ensured = yield* masterAgent.ensure(setup.workspaceID, "block-a")
      expect(ensured.sessionID).toBe(setup.binding.sessionID)
      expect(ensured.revision).toBe(setup.binding.revision)

      // The bound session row itself is durable and readable.
      const session = yield* sessions.get(setup.binding.sessionID)
      expect(session.id).toBe(setup.binding.sessionID)
    }).pipe(Effect.provide(layer()), Effect.runPromise)

    await tmp[Symbol.asyncDispose]()
  })

  test("ChatRelay and OperatingChat bindings survive independent file-backed service stacks", async () => {
    const tmp = await tmpdir()
    const database = Database.layerFromPath(path.join(tmp.path, "session-bindings-reload.sqlite"))
    const layer = () =>
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          SessionProjector.node,
          SessionStore.node,
          SessionV2.node,
          WorkspaceService.node,
          FunctionalityInstance.node,
          ChatRelaySessionService.node,
          OperatingChatSessionService.node,
        ]),
        [
          ...managedNotReadySessionContext,
          [ProjectV2.node, projects],
          [SessionExecution.node, SessionExecution.noopLayer],
          [Database.node, database],
        ],
      )

    const setup = await Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const chatRelay = yield* ChatRelaySessionService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const info = yield* workspace.create({ name: "session-bindings-reload" })
      yield* workspace.update(info.id, { operatingAgent: "ollama:qwen3-coder-30b" })
      yield* withBlock(info.id, "relay-1", "builtin:chat-relay")
      yield* withBlock(info.id, "operating-1", "builtin:operating-chat-session")
      return {
        workspaceID: info.id,
        chatRelay: yield* chatRelay.ensure(info.id, "relay-1"),
        operatingChat: yield* operatingChat.ensure(info.id, "operating-1"),
      }
    }).pipe(Effect.provide(layer()), Effect.runPromise)

    await Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const chatRelay = yield* ChatRelaySessionService.Service
      const operatingChat = yield* OperatingChatSessionService.Service
      const relayReloaded = yield* chatRelay.get(setup.workspaceID, "relay-1")
      const operatingReloaded = yield* operatingChat.get(setup.workspaceID, "operating-1")
      expect(relayReloaded?.sessionID).toBe(setup.chatRelay.sessionID)
      expect(relayReloaded?.revision).toBe(setup.chatRelay.revision)
      expect(operatingReloaded?.sessionID).toBe(setup.operatingChat.sessionID)
      expect(operatingReloaded?.revision).toBe(setup.operatingChat.revision)

      const relayEnsured = yield* chatRelay.ensure(setup.workspaceID, "relay-1")
      const operatingEnsured = yield* operatingChat.ensure(setup.workspaceID, "operating-1")
      expect(relayEnsured.sessionID).toBe(setup.chatRelay.sessionID)
      expect(relayEnsured.revision).toBe(setup.chatRelay.revision)
      expect(operatingEnsured.sessionID).toBe(setup.operatingChat.sessionID)
      expect(operatingEnsured.revision).toBe(setup.operatingChat.revision)
      expect((yield* sessions.get(relayEnsured.sessionID)).id).toBe(relayEnsured.sessionID)
      expect((yield* sessions.get(operatingEnsured.sessionID)).id).toBe(operatingEnsured.sessionID)
    }).pipe(Effect.provide(layer()), Effect.runPromise)

    await tmp[Symbol.asyncDispose]()
  })
})
