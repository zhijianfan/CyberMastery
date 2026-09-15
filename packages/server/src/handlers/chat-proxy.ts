import { DefaultInteractiveContextBudget } from "@opencode-ai/core/context-broker/capsule"
import { CtxPackMaterializer, CtxPackUsage } from "@opencode-ai/core/ctxpack/index"
import { renderContextSidecar, type ContextSidecarAttachment } from "@opencode-ai/core/session/context-sidecar"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillSelection } from "@opencode-ai/core/skill/selection"
import { Hash } from "@opencode-ai/core/util/hash"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SkillV2 } from "@opencode-ai/core/skill"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { ChatProxyRequestError } from "@opencode-ai/protocol/groups/chat-proxy"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ChatProxyService } from "../chat-proxy"
import { requestUser } from "../middleware/authorization"

export function makeChatProxyHandler(service: typeof ChatProxyService) {
  return HttpApiBuilder.group(Api, "server.chatProxy", (handlers) =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const materializer = yield* CtxPackMaterializer.Service
      const usage = yield* CtxPackUsage.Service

      return handlers
        .handle(
          "chatProxy.skills",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            const info = yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            return yield* relaySkills(info.directories[0], SkillSelection.candidates({}))
          }),
        )
        .handle(
          "chatProxy.skillPreview",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            const info = yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            return (yield* relaySkills(info.directories[0], SkillSelection.resolve([ctx.query], {})))[0]!
          }),
        )
        .handle("chatProxy.status", () =>
          requestUser.pipe(Effect.flatMap((user) => request(() => service.status(user.id)))),
        )
        .handle("chatProxy.connect", () =>
          requestUser.pipe(Effect.flatMap((user) => request(() => service.connect(user.id)))),
        )
        .handle("chatProxy.open", () =>
          requestUser.pipe(Effect.flatMap((user) => request(() => service.open(user.id)))),
        )
        .handle(
          "chatProxy.relay",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            return yield* acquireRelay(service, workspace, ctx.params.workspaceID, ctx.params.blockID, user.id, () =>
              service.relay(user.id, ctx.params.workspaceID, ctx.params.blockID),
            )
          }),
        )
        .handle(
          "chatProxy.ensure",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            return yield* acquireRelay(service, workspace, ctx.params.workspaceID, ctx.params.blockID, user.id, () =>
              service.ensure(user.id, ctx.params.workspaceID, ctx.params.blockID),
            )
          }),
        )
        .handle(
          "chatProxy.reset",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            return yield* acquireRelay(service, workspace, ctx.params.workspaceID, ctx.params.blockID, user.id, () =>
              service.reset(user.id, ctx.params.workspaceID, ctx.params.blockID, ctx.payload.tabID),
            )
          }),
        )
        .handle(
          "chatProxy.prompt",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            const info = yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            if (!ctx.payload.contextAttachments?.length && !ctx.payload.skills?.length) {
              return yield* request(() =>
                service.prompt(
                  user.id,
                  ctx.params.workspaceID,
                  ctx.params.blockID,
                  ctx.payload.tabID,
                  ctx.payload.messageID,
                  ctx.payload.text,
                ),
              )
            }
            const identity = Hash.sha256(
              JSON.stringify({
                text: ctx.payload.text,
                skills: (ctx.payload.skills ?? []).map((skill) => ({
                  name: skill.name,
                  contentHash: skill.contentHash,
                })),
                contextAttachments: ctx.payload.contextAttachments ?? [],
              }),
            )
            const admitted = yield* request(() =>
              service.reconcilePrompt(
                user.id,
                ctx.params.workspaceID,
                ctx.params.blockID,
                ctx.payload.tabID,
                ctx.payload.messageID,
                identity,
              ),
            )
            if (admitted) return admitted
            const skills = ctx.payload.skills?.length
              ? yield* relaySkills(info.directories[0], SkillSelection.resolve(ctx.payload.skills, {}))
              : []
            const skillContext = skills.length
              ? `\n\n<selected-skills>\n${JSON.stringify({
                  notice: "User-selected skill instructions. Apply these instructions to the user's request.",
                  skills,
                }).replace(
                  /[&<>]/g,
                  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
                )}\n</selected-skills>`
              : ""
            const skillBytes = new TextEncoder().encode(skillContext).length
            if (
              skillBytes > DefaultInteractiveContextBudget.maximumBytes ||
              Math.ceil(skillBytes / 4) > DefaultInteractiveContextBudget.maximumEstimatedTokens
            ) {
              return yield* oversizedSelection()
            }
            const snapshot = ctx.payload.contextAttachments?.length
              ? yield* materializer
                  .snapshotForSessionInput({
                    actor: { userID: user.id, workspaceID: ctx.params.workspaceID },
                    targetInstanceID: ctx.params.blockID,
                    targetFunctionalityID: "builtin:chat-relay",
                    attachments: ctx.payload.contextAttachments,
                    budget: DefaultInteractiveContextBudget,
                  })
                  .pipe(Effect.mapError(invalidContextAttachment))
              : { attachments: [], createdAt: Date.now() }
            const attachments: ContextSidecarAttachment[] = snapshot.attachments.map((attachment) => ({
              selection: "explicit",
              contextCapsuleID: attachment.contextCapsuleID,
              sourceCtxPackID: attachment.sourceCtxPackID,
              label: attachment.label,
              ...(attachment.tags?.length ? { tags: attachment.tags } : {}),
              contentHash: attachment.contentHash,
              fragments: attachment.fragments.map((fragment) => ({
                contentHash: fragment.contentHash,
                text: fragment.text,
              })),
            }))
            const rendered = yield* renderContextSidecar({
              promptText: `${ctx.payload.text}${skillContext}`,
              attachments,
              recall: { policy: "disabled", status: "disabled" },
              budget: {
                maximumBytes: DefaultInteractiveContextBudget.maximumBytes - skillBytes,
                maximumEstimatedTokens:
                  DefaultInteractiveContextBudget.maximumEstimatedTokens - Math.ceil(skillBytes / 4),
              },
              createdAt: snapshot.createdAt,
            }).pipe(Effect.mapError(() => oversizedSelection()))
            const labels = snapshot.attachments.map((attachment) => JSON.stringify(attachment.label)).join(", ")
            const displayText = [
              ctx.payload.text,
              ...(labels ? [`Attached context: ${labels}`] : []),
              ...(skills.length
                ? [`Selected skills: ${skills.map((skill) => JSON.stringify(skill.name)).join(", ")}`]
                : []),
            ]
              .filter(Boolean)
              .join("\n\n")
            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const response = yield* restore(
                  request(() =>
                    service.prompt(
                      user.id,
                      ctx.params.workspaceID,
                      ctx.params.blockID,
                      ctx.payload.tabID,
                      ctx.payload.messageID,
                      displayText,
                      rendered.apiContent,
                      identity,
                    ),
                  ),
                )
                if (snapshot.attachments.length)
                  yield* usage
                    .recordAdmittedUse({
                      workspaceID: ctx.params.workspaceID,
                      userID: user.id,
                      ctxPackIDs: [...new Set(snapshot.attachments.map((attachment) => attachment.sourceCtxPackID))],
                      sessionInputID: JSON.stringify([
                        "chat-relay",
                        ctx.params.workspaceID,
                        ctx.params.blockID,
                        ctx.payload.tabID,
                        ctx.payload.messageID,
                      ]),
                      admittedAt: Date.now(),
                    })
                    .pipe(
                      Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                          ? Effect.interrupt
                          : Effect.logError(
                              `ChatRelay CtxPack usage recording failed: ${snapshot.attachments.length} attachments`,
                            ),
                      ),
                    )
                return response
              }),
            )
          }),
        )
        .handle(
          "chatProxy.openRelay",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            return yield* request(() =>
              service.openRelay(user.id, ctx.params.workspaceID, ctx.params.blockID, ctx.payload.tabID),
            )
          }),
        )
        .handle(
          "chatProxy.options",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            return yield* request(() =>
              service.options(user.id, ctx.params.workspaceID, ctx.params.blockID, ctx.payload.tabID),
            )
          }),
        )
        .handle(
          "chatProxy.configure",
          Effect.fn(function* (ctx) {
            const user = yield* requestUser
            yield* requireRelayBlock(workspace, ctx.params.workspaceID, ctx.params.blockID, user.id)
            return yield* request(() =>
              service.configure(
                user.id,
                ctx.params.workspaceID,
                ctx.params.blockID,
                ctx.payload.tabID,
                ctx.payload.model,
                ctx.payload.effort,
              ),
            )
          }),
        )
    }),
  )
}

export const ChatProxyHandler = makeChatProxyHandler(ChatProxyService)

function acquireRelay<A>(
  service: Pick<typeof ChatProxyService, "close">,
  workspace: WorkspaceService.Interface,
  workspaceID: Parameters<WorkspaceService.Interface["get"]>[0],
  blockID: string,
  user: string,
  acquire: () => Promise<A>,
) {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      yield* requireRelayBlock(workspace, workspaceID, blockID, user)
      const response = yield* request(acquire)
      yield* requireRelayBlock(workspace, workspaceID, blockID, user).pipe(
        Effect.onError(() => request(() => service.close(user, workspaceID, blockID)).pipe(Effect.ignore)),
      )
      return response
    }),
  )
}

function requireRelayBlock(
  workspace: WorkspaceService.Interface,
  workspaceID: Parameters<WorkspaceService.Interface["get"]>[0],
  blockID: string,
  user: string,
) {
  return Effect.gen(function* () {
    const info = yield* workspace.get(workspaceID, user).pipe(
      Effect.mapError(
        () =>
          new InvalidRequestError({
            message: `Workspace not found: ${workspaceID}`,
            kind: "chat_proxy_workspace",
          }),
      ),
    )
    const block = yield* workspace.block.get(workspaceID, blockID).pipe(
      Effect.mapError(
        () =>
          new InvalidRequestError({
            message: `Workspace not found: ${workspaceID}`,
            kind: "chat_proxy_workspace",
          }),
      ),
    )
    if (!block || block.functionality !== "builtin:chat-relay") {
      return yield* new InvalidRequestError({
        message: `Block ${blockID} is not a ChatRelay block in workspace ${workspaceID}`,
        kind: "chat_proxy_block",
      })
    }
    return info
  })
}

function relaySkills<A, E>(
  directory: string | undefined,
  effect: Effect.Effect<A, E, AgentV2.Service | SkillV2.Service>,
) {
  if (!directory)
    return Effect.fail(
      new InvalidRequestError({
        message: "This workspace has no primary directory for skill discovery.",
        kind: "chat_proxy_skill",
      }),
    )
  return effect.pipe(
    Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Effect.mapError(
      (error) =>
        new InvalidRequestError({
          message:
            error instanceof SkillSelection.UnavailableError
              ? error.message
              : "Skills are unavailable in this workspace.",
          kind: "chat_proxy_skill",
        }),
    ),
  )
}

function oversizedSelection() {
  return new InvalidRequestError({
    message:
      "Selected skills and context exceed the context budget. Remove a skill or context attachment and try again.",
    kind: "chat_proxy_context_attachment",
  })
}

function request<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ChatProxyRequestError({
        name: "ChatProxyRequestError",
        data: { message: cause instanceof Error ? cause.message : String(cause) },
      }),
  })
}

function invalidContextAttachment() {
  return new InvalidRequestError({
    message: "ChatRelay context attachments are invalid or unavailable",
    kind: "chat_proxy_context_attachment",
  })
}
