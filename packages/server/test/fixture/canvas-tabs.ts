import { DateTime, Effect, FileSystem, Layer, Path } from "effect"
import { Etag, HttpPlatform } from "effect/unstable/http"
import { HttpApi, HttpApiTest } from "effect/unstable/httpapi"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { CanvasTabGroup } from "@opencode-ai/protocol/groups/workspace-canvas-tab"
import { MasterAgentGroup } from "@opencode-ai/protocol/groups/workspace-master-agent"
import { OperatingChatGroup } from "@opencode-ai/protocol/groups/operating-chat"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { ChatProxyService } from "../../src/chat-proxy"
import { makeWorkspaceCanvasTabHandler } from "../../src/handlers/workspace-canvas-tab"
import { WorkspaceMasterAgentHandler } from "../../src/handlers/workspace-master-agent"
import { OperatingChatHandler } from "../../src/handlers/operating-chat"
import { masterAgentAccessLive } from "../../src/handlers/workspace-master-agent-access"
import { operatingChatAccessLive } from "../../src/handlers/operating-chat-access"
import { requestUser } from "../../src/middleware/authorization"

export const pages = new Map<string, ChatProxy.Relay>()
export const active = new Set<SessionSchema.ID>()
export const worker = {
  ...ChatProxyService,
  async createTab(user: string, workspaceID: string, blockID: string, tabID: string) {
    const page = new ChatProxy.Relay({
      providerID: "chatgpt",
      workspaceID: Workspace.ID.make(workspaceID),
      blockID,
      tabID,
      status: "idle",
      messages: [],
      title: tabID,
      createdAt: Date.now(),
      readonly: false,
    })
    pages.set(tabID, page)
    return page
  },
  async snapshotTab(user: string, workspaceID: string, blockID: string, tabID: string) {
    const page = pages.get(tabID)
    if (!page || page.workspaceID !== workspaceID || page.blockID !== blockID) throw new Error("Missing live page")
    return page
  },
  async selectTab(user: string, workspaceID: string, blockID: string, tabID: string) {
    return this.snapshotTab(user, workspaceID, blockID, tabID)
  },
  async restoreTab(user: string, workspaceID: string, blockID: string, tabID: string) {
    const page = pages.get(tabID)
    if (!page || page.workspaceID !== workspaceID || page.blockID) throw new Error("Missing archived page")
    const restored = new ChatProxy.Relay({ ...page, blockID })
    pages.set(tabID, restored)
    return restored
  },
  async isLiveTab(user: string, workspaceID: string, tabID: string) {
    return pages.get(tabID)?.workspaceID === workspaceID
  },
  async archiveBlock(user: string, workspaceID: string, blockID: string) {
    pages.forEach((page, id) => {
      if (page.workspaceID === workspaceID && page.blockID === blockID)
        pages.set(id, new ChatProxy.Relay({ ...page, blockID: "" }))
    })
  },
}

const sessionPort = Effect.gen(function* () {
  const database = yield* Database.Service
  return {
    create: (input: Parameters<MasterAgentService.SessionPort["create"]>[0]) =>
      Effect.gen(function* () {
        const id = SessionSchema.ID.create()
        const now = Date.now()
        yield* database.db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* database.db
          .insert(SessionTable)
          .values({
            id,
            runtime: "v2",
            project_id: Project.ID.global,
            workspace_id: input.location.workspaceID,
            slug: id,
            directory: input.location.directory,
            title: "Conversation",
            version: "test",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return SessionSchema.Info.make({
          id,
          runtime: "v2",
          projectID: Project.ID.global,
          location: input.location,
          title: "Conversation",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: DateTime.makeUnsafe(now), updated: DateTime.makeUnsafe(now) },
        })
      }),
    configure: () => Effect.void,
    active: Effect.sync(() => active),
    reserveIdle: (id: SessionSchema.ID) => Effect.sync(() => !active.has(id)),
    cleanupLosingCandidate: () => Effect.succeed("removed" as const),
  }
})

export const core = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    WorkspaceService.node,
    CanvasTabService.node,
    MasterAgentService.node,
    OperatingChatSessionService.node,
    EventV2.node,
  ]),
  [
    [Database.node, makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(":memory:"), deps: [] })],
    [
      MasterAgentService.sessionPortLive,
      LayerNode.make({
        service: MasterAgentService.SessionPortService,
        layer: Layer.effect(MasterAgentService.SessionPortService, sessionPort),
        deps: [Database.node],
      }),
    ],
    [
      OperatingChatSessionService.sessionPortLive,
      LayerNode.make({
        service: OperatingChatSessionService.SessionPortService,
        layer: Layer.effect(OperatingChatSessionService.SessionPortService, sessionPort),
        deps: [Database.node],
      }),
    ],
  ],
)

export const layer = Layer.mergeAll(
  makeWorkspaceCanvasTabHandler(worker),
  WorkspaceMasterAgentHandler,
  OperatingChatHandler,
).pipe(
  Layer.provideMerge(masterAgentAccessLive),
  Layer.provideMerge(operatingChatAccessLive),
  Layer.provideMerge(core),
  Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(FileSystem.layerNoop({})))),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(Etag.layer),
  Layer.provideMerge(
    Layer.succeed(
      Authorization,
      Authorization.of((effect) => effect.pipe(Effect.provideService(requestUser, { id: "tab-user" }))),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      SchemaErrorMiddleware,
      SchemaErrorMiddleware.of((effect) => effect),
    ),
  ),
)

export const fixture = (kind: CanvasTab.Kind = "chat-relay") =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceService.Service
    const tabs = yield* CanvasTabService.Service
    const info = yield* workspace.create({ name: "HTTP canvas tabs", user: "tab-user" })
    yield* workspace.update(info.id, { model: "ollama:qwen3-coder-30b" }, "tab-user")
    const tuple = Workspace.Layout.Tuple.make({ user: "tab-user", style: "default", deviceClass: "desktop" })
    const initial = yield* workspace.layout.get(info.id, tuple, "tab-client")
    yield* workspace.layout.save(
      info.id,
      tuple,
      ["one", "two"].map((id) => ({
        id,
        functionality: kind === "operating-chat" ? "builtin:operating-chat-session" : `builtin:${kind}`,
        transform: { x: 0, y: 0, w: 4, h: 4, z: 0 },
      })),
      initial.revision,
      "tab-client",
    )
    const groups = yield* HttpApiTest.groups(
      HttpApi.make("server").add(CanvasTabGroup).add(MasterAgentGroup).add(OperatingChatGroup),
      ["server.workspace.canvasTab", "server.workspace.masterAgent", "server.workspace.operatingChat"],
    )
    // A block that already has a conversation enrolls its bound session when
    // the block loads; simulate that here. Blocks without one stay empty.
    if (kind === "master-agent")
      yield* groups["server.workspace.masterAgent"]["workspace.masterAgent.ensure"]({
        params: { workspaceID: info.id, blockID: "one" },
      })
    if (kind === "operating-chat")
      yield* groups["server.workspace.operatingChat"]["workspace.operatingChat.ensure"]({
        params: { workspaceID: info.id, blockID: "one" },
      })
    return {
      workspace,
      tabs,
      info,
      tuple,
      params: { workspaceID: info.id, kind, blockID: "one" },
      client: groups["server.workspace.canvasTab"],
      master: groups["server.workspace.masterAgent"],
      operating: groups["server.workspace.operatingChat"],
    }
  })
