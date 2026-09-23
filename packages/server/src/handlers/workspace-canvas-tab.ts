import { Effect, Schema, DateTime } from "effect"
import { and, eq, isNull } from "drizzle-orm"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { CanvasTabService } from "@opencode-ai/core/workspace/canvas-tab"
import { FunctionalityInstanceTable } from "@opencode-ai/core/workspace/sql"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { OperatingChatSessionService } from "@opencode-ai/core/workspace/operating-chat-session"
import {
  CanvasTabAccessDeniedError,
  CanvasTabBusyError,
  CanvasTabConflictError,
  CanvasTabDeletedBlockError,
  CanvasTabInvalidRequestError,
  CanvasTabNotFoundError,
  CanvasTabStaleRevisionError,
  CanvasTabWrongKindError,
} from "@opencode-ai/protocol/groups/workspace-canvas-tab"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { Api } from "../api"
import { ChatProxyService, makeChatProxyTabs } from "../chat-proxy"
import { requestUser } from "../middleware/authorization"

type Params = { workspaceID: Workspace.ID; kind: CanvasTab.Kind; blockID: string }

export function makeWorkspaceCanvasTabHandler(worker = ChatProxyService) {
  return HttpApiBuilder.group(Api, "server.workspace.canvasTab", (handlers) =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const tabs = yield* CanvasTabService.Service
      const master = yield* MasterAgentService.Service
      const operating = yield* OperatingChatSessionService.Service
      const events = yield* EventV2.Service
      const database = yield* Database.Service
      const scope = yield* Effect.scope
      const relay = makeChatProxyTabs({ workspace, tabs, events, scope, worker })

      const authorize = (workspaceID: Workspace.ID) =>
        Effect.gen(function* () {
          const user = yield* requestUser
          yield* workspace
            .get(workspaceID, user.id)
            .pipe(
              Effect.mapError(
                () => new CanvasTabAccessDeniedError({ workspaceID, message: "Workspace access denied" }),
              ),
            )
          return user.id
        })
      const block = (params: Params) =>
        Effect.gen(function* () {
          const descriptor = yield* workspace.block.get(params.workspaceID, params.blockID)
          if (!descriptor) {
            // Preserve the durable deleted-block fence rather than reporting a missing layout descriptor.
            yield* tabs.block(params.workspaceID, params.kind, params.blockID)
            return yield* new CanvasTabService.NotFoundError(params)
          }
          if (
            descriptor.functionality !==
            (params.kind === "operating-chat" ? "builtin:operating-chat-session" : `builtin:${params.kind}`)
          )
            return yield* new CanvasTabService.WrongKindError(params)
        })
      const state = (params: Params) =>
        tabs
          .block(params.workspaceID, params.kind, params.blockID)
          .pipe(Effect.catchTag("CanvasTab.NotFoundError", () => Effect.succeed(undefined)))
      const revision = (params: Params, expectedRevision: number) =>
        Effect.gen(function* () {
          const current = yield* state(params)
          if ((current?.revision ?? 0) !== expectedRevision)
            return yield* new CanvasTabService.StaleRevisionError({
              ...params,
              expectedRevision,
              currentRevision: current?.revision ?? 0,
            })
          return current
        })
      const changed = (params: Params, revision: number) =>
        events.publish(WorkspaceEvent.CanvasTabChanged, { ...params, revision })
      const bindingRevision = (params: Params, value: number | undefined) =>
        value === undefined
          ? Effect.fail(
              new CanvasTabInvalidRequestError({
                ...params,
                message: "expectedBindingRevision is required for V2 tabs",
              }),
            )
          : Effect.succeed(value)
      const target = (params: Params, tabID: string, restoring: boolean) =>
        Effect.gen(function* () {
          const entry = yield* tabs.get(params.workspaceID, params.kind, tabID)
          if (!entry) {
            const others = yield* Effect.forEach(["master-agent", "operating-chat", "chat-relay"] as const, (kind) =>
              tabs.get(params.workspaceID, kind, tabID),
            )
            if (others.some(Boolean)) return yield* new CanvasTabService.WrongKindError({ ...params, tabID })
            return yield* new CanvasTabService.NotFoundError({ ...params, tabID })
          }
          if (
            restoring
              ? entry.archivedAt === undefined
              : entry.archivedAt !== undefined || entry.blockID !== params.blockID
          )
            return yield* new CanvasTabConflictError({
              ...params,
              tabID,
              message: restoring ? "Tab is not archived" : "Tab is not owned by this block",
            })
          return entry
        })
      // Mutation responses must report live revisions; this read never enrolls.
      const instanceRevision = (params: Params) =>
        Effect.gen(function* () {
          const instance = yield* database.db
            .select({ revision: FunctionalityInstanceTable.revision })
            .from(FunctionalityInstanceTable)
            .where(
              and(
                eq(FunctionalityInstanceTable.workspace_id, params.workspaceID),
                eq(FunctionalityInstanceTable.block_id, params.blockID),
                eq(
                  FunctionalityInstanceTable.functionality_id,
                  params.kind === "master-agent" ? "builtin:master-agent" : "builtin:operating-chat-session",
                ),
                isNull(FunctionalityInstanceTable.deleted_at),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!instance) return yield* new CanvasTabService.NotFoundError({ ...params })
          return instance.revision
        })
      const select = (
        params: Params,
        payload: { tabID: string; expectedRevision: number; expectedBindingRevision?: number },
        restoring: boolean,
      ) =>
        Effect.gen(function* () {
          const user = yield* authorize(params.workspaceID)
          yield* block(params)
          if (params.kind === "chat-relay") {
            yield* target(params, payload.tabID, restoring)
            const result = yield* (restoring ? relay.restoreTab : relay.selectTab)(
              user,
              params.workspaceID,
              params.blockID,
              payload.tabID,
              payload.expectedRevision,
            )
            return result
          }
          const expectedBindingRevision = yield* bindingRevision(params, payload.expectedBindingRevision)
          return yield* events.atomic(
            Effect.gen(function* () {
              yield* target(params, payload.tabID, restoring)
              const service = params.kind === "master-agent" ? master : operating
              const result = yield* service.selectTab(
                params.workspaceID,
                params.blockID,
                payload.tabID,
                expectedBindingRevision,
                payload.expectedRevision,
              )
              const current = yield* tabs.block(params.workspaceID, params.kind, params.blockID)
              yield* changed(params, result.tabRevision)
              return {
                selected: current.selected,
                revision: result.tabRevision,
                bindingRevision: result.binding.revision,
              }
            }),
          )
        })

      return handlers
        .handle("workspace.canvasTab.listOwned", (ctx) =>
          Effect.gen(function* () {
            const user = yield* authorize(ctx.params.workspaceID)
            yield* block(ctx.params)
            const cursor =
              ctx.query.cursor === undefined
                ? undefined
                : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CanvasTab.Cursor))(ctx.query.cursor)
            const previous = yield* state(ctx.params)
            const binding =
              ctx.params.kind === "chat-relay"
                ? undefined
                : yield* (ctx.params.kind === "master-agent" ? master : operating).ensure(
                    ctx.params.workspaceID,
                    ctx.params.blockID,
                  )
            // Ensure owns its mutations; polling only needs a deferred read snapshot.
            const result = yield* database.db
              .transaction(() =>
                Effect.gen(function* () {
                  const current = yield* state(ctx.params)
                  // Binding and registry revisions must describe the same snapshot.
                  // Lifecycle get() can enroll tabs, so use the SELECT-only instance read.
                  const instance = binding
                    ? yield* database.db
                        .select({ revision: FunctionalityInstanceTable.revision })
                        .from(FunctionalityInstanceTable)
                        .where(
                          and(
                            eq(FunctionalityInstanceTable.workspace_id, ctx.params.workspaceID),
                            eq(FunctionalityInstanceTable.block_id, ctx.params.blockID),
                            eq(
                              FunctionalityInstanceTable.functionality_id,
                              ctx.params.kind === "master-agent"
                                ? "builtin:master-agent"
                                : "builtin:operating-chat-session",
                            ),
                            isNull(FunctionalityInstanceTable.deleted_at),
                          ),
                        )
                        .get()
                        .pipe(Effect.orDie)
                    : undefined
                  if (binding && !instance) return yield* new CanvasTabService.NotFoundError(ctx.params)
                  const page = yield* tabs.listOwned(
                    ctx.params.workspaceID,
                    ctx.params.kind,
                    ctx.params.blockID,
                    cursor,
                    ctx.query.limit ?? 6,
                  )
                  return {
                    ...page,
                    selectedTabID: current?.selected.id ?? null,
                    revision: current?.revision ?? 0,
                    ...(instance ? { bindingRevision: instance.revision } : {}),
                  }
                }),
              )
              .pipe(Effect.catchTag("SqlError", Effect.die))
            if (binding && result.revision !== previous?.revision) yield* changed(ctx.params, result.revision)
            // Browser liveness probes and event delivery must not hold the read snapshot.
            return {
              ...result,
              items:
                ctx.params.kind === "chat-relay"
                  ? yield* Effect.forEach(result.items, (entry) => relay.materialize(user, entry))
                  : result.items,
            }
          }).pipe(Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params))),
        )
        .handle("workspace.canvasTab.listArchived", (ctx) =>
          Effect.gen(function* () {
            const user = yield* authorize(ctx.params.workspaceID)
            const cursor =
              ctx.query.cursor === undefined
                ? undefined
                : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CanvasTab.Cursor))(ctx.query.cursor)
            const page = yield* tabs.listArchived(
              ctx.params.workspaceID,
              ctx.params.kind,
              ctx.query.search ?? "",
              cursor,
              ctx.query.limit ?? 6,
            )
            return {
              ...page,
              items:
                ctx.params.kind === "chat-relay"
                  ? yield* Effect.forEach(page.items, (entry) => relay.materialize(user, entry))
                  : page.items,
            }
          }).pipe(Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params))),
        )
        .handle("workspace.canvasTab.create", (ctx) =>
          Effect.gen(function* () {
            const user = yield* authorize(ctx.params.workspaceID)
            yield* block(ctx.params)
            if (ctx.params.kind === "chat-relay") {
              const result = yield* relay.createTab(
                user,
                ctx.params.workspaceID,
                ctx.params.blockID,
                ctx.payload.requestID,
                ctx.payload.expectedRevision,
              )
              return result
            }
            const expectedBindingRevision = yield* bindingRevision(ctx.params, ctx.payload.expectedBindingRevision)
            return yield* events.atomic(
              Effect.gen(function* () {
                // Exact retries reconcile their durable identity before rejecting the old revision.
                if (!(yield* tabs.get(ctx.params.workspaceID, ctx.params.kind, ctx.payload.requestID)))
                  yield* revision(ctx.params, ctx.payload.expectedRevision)
                const service = ctx.params.kind === "master-agent" ? master : operating
                const result = yield* service.createTab(
                  ctx.params.workspaceID,
                  ctx.params.blockID,
                  expectedBindingRevision,
                  ctx.payload.requestID,
                )
                const current = yield* tabs.block(ctx.params.workspaceID, ctx.params.kind, ctx.params.blockID)
                yield* changed(ctx.params, result.tabRevision)
                return {
                  selected: current.selected,
                  revision: result.tabRevision,
                  bindingRevision: result.binding.revision,
                }
              }),
            )
          }).pipe(Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params))),
        )
        .handle("workspace.canvasTab.select", (ctx) =>
          select(ctx.params, ctx.payload, false).pipe(
            Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params)),
          ),
        )
        .handle("workspace.canvasTab.restore", (ctx) =>
          select(ctx.params, ctx.payload, true).pipe(
            Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params)),
          ),
        )
        .handle("workspace.canvasTab.archive", (ctx) =>
          Effect.gen(function* () {
            const user = yield* authorize(ctx.params.workspaceID)
            yield* block(ctx.params)
            if (ctx.params.kind === "chat-relay")
              return yield* relay.archiveTab(
                user,
                ctx.params.workspaceID,
                ctx.params.blockID,
                ctx.payload.tabID,
                ctx.payload.expectedRevision,
              )
            yield* bindingRevision(ctx.params, ctx.payload.expectedBindingRevision)
            return yield* events.atomic(
              Effect.gen(function* () {
                const entry = yield* target(ctx.params, ctx.payload.tabID, false)
                const result = yield* tabs.archiveTab(
                  { ...ctx.params, tabID: ctx.payload.tabID },
                  ctx.payload.expectedRevision,
                )
                // Archiving the conversation also retires its V2 archive state so
                // active-session lists stop presenting it.
                const sessionID = SessionSchema.ID.make(entry.conversationID)
                const session = yield* database.db
                  .select()
                  .from(SessionTable)
                  .where(eq(SessionTable.id, sessionID))
                  .get()
                  .pipe(Effect.orDie)
                if (!session || session.workspace_id !== ctx.params.workspaceID || session.runtime !== "v2")
                  return yield* new CanvasTabConflictError({
                    ...ctx.params,
                    tabID: ctx.payload.tabID,
                    message: "Archived tab session does not belong to this workspace",
                  })
                yield* events.publish(SessionEvent.ArchiveStateChanged, {
                  sessionID,
                  timestamp: yield* DateTime.now,
                  archived: true,
                })
                yield* changed(ctx.params, result.revision)
                return {
                  selected: result.selected,
                  revision: result.revision,
                  bindingRevision: yield* instanceRevision(ctx.params),
                }
              }),
            )
          }).pipe(Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params))),
        )
        .handle("workspace.canvasTab.archiveAndRemove", (ctx) =>
          Effect.gen(function* () {
            const user = yield* authorize(ctx.params.workspaceID)
            const remove = Effect.gen(function* () {
              const deleted = yield* state(ctx.params).pipe(
                Effect.as(false),
                Effect.catchTag("CanvasTab.DeletedBlockError", () => Effect.succeed(true)),
              )
              if (ctx.params.kind === "chat-relay" && !deleted)
                yield* relay.prepareArchive(user, ctx.params.workspaceID, ctx.params.blockID)
              const result = yield* events.atomic(
                Effect.gen(function* () {
                  if (!deleted) yield* revision(ctx.params, ctx.payload.expectedRevision)
                  const result = yield* workspace.block.archiveAndRemove(
                    ctx.params.workspaceID,
                    ctx.params.blockID,
                    ctx.params.kind,
                    { ...ctx.payload.tuple, user },
                    ctx.payload.expectedLayoutRevision,
                    ctx.payload.clientID,
                    user,
                  )
                  yield* changed(ctx.params, result.tabRevision)
                  return result
                }),
              )
              if (ctx.params.kind === "chat-relay")
                yield* relay.archiveBlock(user, ctx.params.workspaceID, ctx.params.blockID)
              return result
            })
            return yield* ctx.params.kind === "chat-relay"
              ? relay.withBlock(ctx.params.workspaceID, ctx.params.blockID, remove)
              : remove
          }).pipe(Effect.mapError((error) => toCanvasTabHttpError(error, ctx.params))),
        )
    }),
  )
}

export const WorkspaceCanvasTabHandler = makeWorkspaceCanvasTabHandler()

/** Compatibility lifecycle reads can enroll an existing binding for the first time. */
export function observeCanvasTabs<A, E, R>(
  tabs: CanvasTabService.Interface,
  events: EventV2.Interface,
  params: Params,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const state = tabs.block(params.workspaceID, params.kind, params.blockID).pipe(
      Effect.map((value) => value.revision),
      Effect.catchTags({
        "CanvasTab.NotFoundError": () => Effect.succeed(undefined),
        "CanvasTab.DeletedBlockError": () => Effect.succeed(undefined),
      }),
    )
    const previous = yield* state
    const result = yield* effect
    const revision = yield* state
    if (revision !== undefined && revision !== previous)
      yield* events.publish(WorkspaceEvent.CanvasTabChanged, { ...params, revision })
    return result
  })
}

export function toCanvasTabHttpError(
  error: unknown,
  params: { workspaceID: Workspace.ID; kind: CanvasTab.Kind; blockID?: string },
) {
  const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
  const fields = { ...params, message: error instanceof Error ? error.message : tag || "Canvas tab operation failed" }
  if (
    error instanceof CanvasTabAccessDeniedError ||
    error instanceof CanvasTabConflictError ||
    error instanceof CanvasTabInvalidRequestError
  )
    return error
  if (tag.includes("Stale") || tag === "Workspace.LayoutConflictError")
    return new CanvasTabStaleRevisionError({
      ...fields,
      currentRevision:
        typeof error === "object" &&
        error !== null &&
        "currentRevision" in error &&
        typeof error.currentRevision === "number"
          ? error.currentRevision
          : undefined,
    })
  if (tag.includes("Busy")) return new CanvasTabBusyError(fields)
  if (tag.includes("DeletedBlock")) return new CanvasTabDeletedBlockError(fields)
  if (tag.includes("WrongKind") || tag.includes("WrongFunctionality") || tag.includes("WrongTab"))
    return new CanvasTabWrongKindError(fields)
  if (tag.includes("NotFound")) return new CanvasTabNotFoundError(fields)
  if (tag === "Workspace.LayoutHandedOverError") return new CanvasTabConflictError(fields)
  return new CanvasTabInvalidRequestError(fields)
}
