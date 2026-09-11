// CtxPack service: the frozen v1 service boundary. Policy (capability checks,
// workspace scoping, privacy filtering), validation, normalization, event
// emission — all mutations go through the S1 repository and publish a
// minimal workspace-scoped change event after commit.

import { Context, Effect, Layer, Option } from "effect"
import { CtxPack } from "@opencode-ai/schema/ctxpack"
import type {
  CtxPackCreateRequest,
  CtxPackError,
  CtxPackListRequest,
  CtxPackListResult,
  CtxPackPatchRequest,
} from "@opencode-ai/schema/ctxpack"
import * as CapabilityService from "../capability/service"
import type { CapabilitySubject } from "../capability/subjects"
import { makeGlobalNode } from "../effect/app-node"
import { CtxPackEvents } from "./events"
import * as CtxPackRepository from "./sql"
import { buildFtsQuery } from "./search"
import { validateCreate, validateListRequest, validatePatch } from "./validation"

// Actor + event port ----------------------------------------------------------

export interface CtxPackActor {
  userID: string
  workspaceID: string
}

// The data payload of S1's CtxPackChanged definition, wrapped in the frozen
// event envelope `{ type, properties }`.
export interface WorkspaceCtxPackChangedEvent {
  type: "workspace.ctxpack.changed"
  properties: {
    workspaceID: string
    ctxPackID: string
    revision: number
    change: "created" | "metadata-updated" | "deleted" | "restored" | "used"
  }
}

export interface CtxPackEventPort {
  publish(event: WorkspaceCtxPackChangedEvent): Effect.Effect<void>
}

export class CtxPackEventPortService extends Context.Service<CtxPackEventPortService, CtxPackEventPort>()(
  "@opencode/v2/CtxPackEventPort",
) {}

// Isolated service-layer tests can record events without the global event bus.
// The production node below always supplies the live publisher explicitly.
export function recordingEventPort(
  events: WorkspaceCtxPackChangedEvent[] = [],
): CtxPackEventPort & { events: WorkspaceCtxPackChangedEvent[] } {
  return {
    events,
    publish: (event) =>
      Effect.sync(() => {
        events.push(event)
      }),
  }
}

// Service interface (frozen) --------------------------------------------------

export interface CtxPackService {
  create(actor: CtxPackActor, request: CtxPackCreateRequest): Effect.Effect<CtxPack.Info, CtxPackError>
  get(actor: CtxPackActor, ctxPackID: CtxPack.ID, includeDeleted?: boolean): Effect.Effect<CtxPack.Info, CtxPackError>
  list(actor: CtxPackActor, request: CtxPackListRequest): Effect.Effect<CtxPackListResult, CtxPackError>
  patch(actor: CtxPackActor, request: CtxPackPatchRequest): Effect.Effect<CtxPack.Info, CtxPackError>
  remove(
    actor: CtxPackActor,
    input: { ctxPackID: CtxPack.ID; expectedRevision: number },
  ): Effect.Effect<CtxPack.Info, CtxPackError>
  restore(
    actor: CtxPackActor,
    input: { ctxPackID: CtxPack.ID; expectedRevision: number },
  ): Effect.Effect<CtxPack.Info, CtxPackError>
}

export class Service extends Context.Service<Service, CtxPackService>()("@opencode/v2/CtxPack") {}

// Helpers ---------------------------------------------------------------------

const permissionDenied = (operation: string) =>
  Effect.fail<CtxPackError>({ _tag: "CtxPackPermissionDenied", operation })

const requireCapability = (
  capability: CapabilityService.Interface,
  input: CapabilityService.CapabilityCheckInput,
): Effect.Effect<void, CtxPackError> =>
  capability
    .require(input)
    .pipe(
      Effect.catch((error) =>
        Effect.fail({ _tag: "CtxPackPermissionDenied", operation: error.operation } satisfies CtxPackError),
      ),
    )

const ctxPackSubject = (info: CtxPack.Info): CapabilitySubject => ({
  type: "CtxPack",
  workspaceID: info.workspaceID,
  ctxPackID: info.id,
  sensitivity: info.sensitivity,
  createdByUserID: info.createdByUserID,
})

// Event publish is fire-and-forget from the caller's perspective: a port
// failure is logged and swallowed, it never rolls back the committed mutation
// (the port records failures on its own error path).
const publishEvent = (port: CtxPackEventPort, event: WorkspaceCtxPackChangedEvent): Effect.Effect<void> =>
  port
    .publish(event)
    .pipe(
      Effect.catch((error) =>
        Effect.logError(`ctxpack event publish failed for ${event.properties.change}`, error).pipe(
          Effect.as(undefined),
        ),
      ),
    )

// Layer -----------------------------------------------------------------------

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repository = yield* CtxPackRepository.CtxPackRepositoryService
    const capability = yield* CapabilityService.Service
    const port = Context.getOption(yield* Effect.context(), CtxPackEventPortService).pipe(
      Option.getOrElse(() => recordingEventPort()),
    )
    const create: CtxPackService["create"] = Effect.fn("CtxPack.create")(function* (actor, request) {
      if (actor.workspaceID !== request.workspaceID) return yield* permissionDenied("ctxpack.create")
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.create",
        subject: { type: "Workspace", workspaceID: actor.workspaceID },
      })
      const validated = yield* validateCreate(request)

      const result = yield* repository.createWithStatus({
        workspaceID: actor.workspaceID,
        createdByUserID: actor.userID,
        title: validated.title,
        keywords: validated.keywords,
        tags: validated.tags,
        sensitivity: validated.sensitivity,
        fragments: validated.fragments,
        idempotencyKey: request.idempotencyKey,
        now: Date.now(),
      })
      if (result.created)
        yield* publishEvent(port, {
          type: "workspace.ctxpack.changed",
          properties: {
            workspaceID: result.info.workspaceID,
            ctxPackID: result.info.id,
            revision: result.info.revision,
            change: "created",
          },
        })
      return result.info
    })

    const get: CtxPackService["get"] = Effect.fn("CtxPack.get")(function* (actor, ctxPackID, includeDeleted) {
      // Fetch first (the capability subject needs sensitivity + owner), then
      // check, then re-check the deleted state.
      const info = yield* repository.get(actor.workspaceID, ctxPackID, true)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.read",
        subject: ctxPackSubject(info),
      })
      if (info.deletedAt !== null && !(includeDeleted ?? false))
        return yield* Effect.fail<CtxPackError>({ _tag: "CtxPackDeleted", ctxPackID })
      return info
    })

    const list: CtxPackService["list"] = Effect.fn("CtxPack.list")(function* (actor, request) {
      if (actor.workspaceID !== request.workspaceID) return yield* permissionDenied("ctxpack.read")
      yield* validateListRequest(request)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.read",
        subject: { type: "Workspace", workspaceID: actor.workspaceID },
      })

      return yield* repository.list({
        ...request,
        query: buildFtsQuery(request.query) ?? "",
        viewerUserID: actor.userID,
      })
    })

    const patch: CtxPackService["patch"] = Effect.fn("CtxPack.patch")(function* (actor, request) {
      if (actor.workspaceID !== request.workspaceID) return yield* permissionDenied("ctxpack.patch")
      const current = yield* repository.get(actor.workspaceID, request.ctxPackID, true)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.patch",
        subject: ctxPackSubject(current),
      })
      if (current.deletedAt !== null)
        return yield* Effect.fail<CtxPackError>({ _tag: "CtxPackDeleted", ctxPackID: request.ctxPackID })

      const validated = yield* validatePatch(
        request.patch,
        current.fragments.map((fragment) => fragment.source),
      )
      const info = yield* repository.patchMetadata({
        workspaceID: actor.workspaceID,
        ctxPackID: request.ctxPackID,
        expectedRevision: request.expectedRevision,
        patch: validated,
        now: Date.now(),
      })
      yield* publishEvent(port, {
        type: "workspace.ctxpack.changed",
        properties: {
          workspaceID: info.workspaceID,
          ctxPackID: info.id,
          revision: info.revision,
          change: "metadata-updated",
        },
      })
      return info
    })

    const remove: CtxPackService["remove"] = Effect.fn("CtxPack.remove")(function* (actor, input) {
      const current = yield* repository.get(actor.workspaceID, input.ctxPackID, true)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.remove",
        subject: ctxPackSubject(current),
      })
      const info = yield* repository.softDelete(actor.workspaceID, input.ctxPackID, input.expectedRevision)
      yield* publishEvent(port, {
        type: "workspace.ctxpack.changed",
        properties: { workspaceID: info.workspaceID, ctxPackID: info.id, revision: info.revision, change: "deleted" },
      })
      return info
    })

    const restore: CtxPackService["restore"] = Effect.fn("CtxPack.restore")(function* (actor, input) {
      const current = yield* repository.get(actor.workspaceID, input.ctxPackID, true)
      yield* requireCapability(capability, {
        userID: actor.userID,
        operation: "ctxpack.restore",
        subject: ctxPackSubject(current),
      })
      const info = yield* repository.restore(actor.workspaceID, input.ctxPackID, input.expectedRevision)
      // Only a real state change publishes `restored`; restoring a live pack
      // is a no-op at the repository level.
      if (current.deletedAt !== null) {
        yield* publishEvent(port, {
          type: "workspace.ctxpack.changed",
          properties: {
            workspaceID: info.workspaceID,
            ctxPackID: info.id,
            revision: info.revision,
            change: "restored",
          },
        })
      }
      return info
    })

    return Service.of({ create, get, list, patch, remove, restore })
  }),
)

export { layer }

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(
    Layer.provide(
      Layer.effect(
        CtxPackEventPortService,
        Effect.gen(function* () {
          const publisher = yield* CtxPackEvents.CtxPackEventPublisherService
          return CtxPackEventPortService.of({ publish: publisher.publish })
        }),
      ),
    ),
  ),
  deps: [CtxPackRepository.node, CapabilityService.node, CtxPackEvents.node],
})
