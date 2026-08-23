import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { ChatRelaySessionService } from "@opencode-ai/core/workspace/chat-relay-session"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { Capability } from "@opencode-ai/core/capability/service"
import { ContextCapsule } from "@opencode-ai/core/context-broker/capsule"
import {
  CtxPackEvents,
  CtxPackMaterializer,
  CtxPackObservability,
  CtxPackSQL,
  CtxPackService,
  CtxPackUsage,
  ctxPackEventPortNode,
  ctxPackUsagePortNode,
  sessionCtxSnapshotPortNode,
  workspaceMembershipLive,
} from "@opencode-ai/core/ctxpack/index"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { masterAgentAccessLive } from "./handlers/workspace-master-agent-access"
import { chatRelaySessionAccessLive } from "./handlers/chat-relay-session-access"
import { operatingChatAccessLive } from "./handlers/operating-chat-access"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
  MasterAgentService.node,
  ChatRelaySessionService.node,
  OperatingChatSessionService.node,
  WorkspaceService.node,
  Capability.node,
  ContextCapsule.node,
  CtxPackSQL.node,
  CtxPackService.node,
  CtxPackMaterializer.node,
  CtxPackEvents.node,
  CtxPackUsage.node,
  CtxPackObservability.node,
  ctxPackEventPortNode,
  sessionCtxSnapshotPortNode,
  ctxPackUsagePortNode,
  // ChatRelay session binding is workspace-managed and owned by server lifecycle service.
])

export function createRoutes(password?: string) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "opencode", password: Option.some(password) })
      : ServerAuth.Config.layer,
  )
}

export function createEmbeddedRoutes() {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "opencode", password: Option.none() }))
}

function makeRoutes<AuthError, AuthServices>(auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>) {
  const serviceLayer = AppNodeBuilder.build(applicationServices, [
    [SessionExecution.node, SessionExecutionLocal.node],
    [Capability.workspaceMembershipLive, workspaceMembershipLive],
  ])

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    // ChatRelay caller-access port (S1): permissive live implementation;
    // a per-workspace policy can be injected here without touching handlers.
    Layer.provide(chatRelaySessionAccessLive),
    Layer.provide(operatingChatAccessLive),
    // MasterAgent caller-access port (S1): permissive live implementation;
    // a per-workspace policy can be injected here without touching handlers.
    Layer.provide(masterAgentAccessLive),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
