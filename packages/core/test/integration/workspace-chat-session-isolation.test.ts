import { expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { managedNotReadySessionContext } from "../fixture/session-context"
import { tmpdir } from "../fixture/tmpdir"

test("Operating and Master keep independent sessions across reload and reset", async () => {
  await using tmp = await tmpdir()
  const database = Database.layerFromPath(path.join(tmp.path, "chat-session-isolation.sqlite"))
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
        OperatingChatSessionService.node,
        MasterAgentService.node,
      ]),
      [
        ...managedNotReadySessionContext,
        [Database.node, database],
        [SessionExecution.node, SessionExecution.noopLayer],
        [
          ProjectV2.node,
          Layer.succeed(
            ProjectV2.Service,
            ProjectV2.Service.of({
              resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
              directories: () => Effect.succeed([]),
              commit: () => Effect.void,
            }),
          ),
        ],
      ],
    )

  const setup = await Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const operating = yield* OperatingChatSessionService.Service
    const master = yield* MasterAgentService.Service
    const sessions = yield* SessionV2.Service
    const info = yield* workspace.create({ name: "chat-session-isolation" })
    yield* workspace.update(info.id, { directories: [tmp.path], model: "ollama:qwen3-coder-30b" })
    const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })
    const layout = yield* workspace.layout.get(info.id, tuple, "chat-session-isolation")
    yield* workspace.layout.save(
      info.id,
      tuple,
      ["operating-chat-session", "master-agent"].map((role) => ({
        id: role,
        functionality: `builtin:${role}`,
        transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
      })),
      layout.revision,
      "chat-session-isolation",
    )
    const bindings = yield* Effect.all([
      operating.ensure(info.id, "operating-chat-session"),
      master.ensure(info.id, "master-agent"),
    ])
    expect(new Set(bindings.map((binding) => binding.sessionID)).size).toBe(2)
    expect(new Set(bindings.map((binding) => binding.functionalityInstanceID)).size).toBe(2)
    yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(binding.sessionID)
        expect(session.location.directory).toBe(AbsolutePath.make(tmp.path))
        expect(session.location.workspaceID).toBe(info.id)
        expect(session.parentID).toBeUndefined()
      }),
    )
    expect(
      yield* Effect.all([operating.ensure(info.id, "operating-chat-session"), master.ensure(info.id, "master-agent")]),
    ).toEqual(bindings)
    return { workspaceID: info.id, bindings }
  }).pipe(Effect.provide(layer()), Effect.runPromise)

  // Only the database survives; each service stack has independent process state.
  await Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const operating = yield* OperatingChatSessionService.Service
    const master = yield* MasterAgentService.Service
    const sessions = yield* SessionV2.Service
    const roles = [operating, master].map((service, index) => ({ service, binding: setup.bindings[index]! }))
    const movedDirectory = path.join(tmp.path, "moved")
    yield* workspace.update(setup.workspaceID, { directories: [movedDirectory] })
    yield* Effect.forEach(roles, (role) =>
      Effect.gen(function* () {
        expect(yield* role.service.get(setup.workspaceID, role.binding.blockID)).toEqual(role.binding)
        expect(yield* role.service.ensure(setup.workspaceID, role.binding.blockID)).toEqual(role.binding)
      }),
    )
    const foreignWorkspace = yield* workspace.create({ name: "foreign-session-owner" })
    const db = (yield* Database.Service).db
    yield* Effect.forEach(roles, (role) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({ workspace_id: foreignWorkspace.id })
          .where(eq(SessionTable.id, role.binding.sessionID))
          .run()
          .pipe(Effect.orDie)
        const exit = yield* Effect.exit(
          role.service.get(setup.workspaceID, role.binding.blockID) as Effect.Effect<unknown, unknown>,
        )
        expect(Exit.isFailure(exit)).toBeTrue()
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("does not belong to workspace")
        yield* db
          .update(SessionTable)
          .set({ workspace_id: setup.workspaceID })
          .where(eq(SessionTable.id, role.binding.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* Effect.forEach(roles, (role) =>
      Effect.gen(function* () {
        const before = yield* Effect.forEach(roles, (entry) =>
          Effect.gen(function* () {
            return yield* entry.service.get(setup.workspaceID, entry.binding.blockID)
          }),
        )
        const reset = yield* role.service.reset(
          setup.workspaceID,
          role.binding.blockID,
          role.binding.sessionID,
          role.binding.revision,
        )
        expect(reset.sessionID).not.toBe(role.binding.sessionID)
        expect(reset.generation).toBe(role.binding.generation + 1)
        expect(reset.directory).toBe(movedDirectory)
        expect((yield* sessions.get(reset.sessionID)).location.directory).toBe(AbsolutePath.make(movedDirectory))
        expect(yield* role.service.ensure(setup.workspaceID, role.binding.blockID)).toEqual(reset)
        expect((yield* sessions.get(role.binding.sessionID)).id).toBe(role.binding.sessionID)
        expect(
          yield* Effect.forEach(roles, (entry) =>
            Effect.gen(function* () {
              return yield* entry.service.get(setup.workspaceID, entry.binding.blockID)
            }),
          ),
        ).toEqual(before.map((binding) => (binding?.blockID === role.binding.blockID ? reset : binding)))
      }),
    )
  }).pipe(Effect.provide(layer()), Effect.runPromise)
})
