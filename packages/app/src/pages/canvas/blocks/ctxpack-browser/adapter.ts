/**
 * CtxPackBrowser — projected block runtime adapter for `builtin:ctxpack-browser`.
 *
 * Consumes U2's frozen view contract (`CtxPackBrowserView` / `CtxPackBrowserCommand`)
 * and the generated client at `serverSDK().client.v2.workspace.ctxpack`.
 *
 * The host owns EventV2 subscriptions and debouncing. Refresh updates this
 * projection in place so selected detail survives events and reconnects.
 */

import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
  RuntimeEventKey,
} from "../../runtime/contracts"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import type {
  CtxPackInfo,
  CtxPackListQuery,
  CtxPackSensitivity,
  CtxPackSort,
  CtxPackSourceKind,
  CtxPackSummary,
} from "./types"

// ---------------------------------------------------------------------------
// Frozen resolved state (extended with status + errorCode per the R1 brief)
// ---------------------------------------------------------------------------

export type CtxPackBrowserStatus = "loading" | "ready" | "stale" | "permission-denied" | "unavailable" | "error"

export interface CtxPackBrowserResolved {
  workspaceID: string
  blockID: string
  functionalityID: "builtin:ctxpack-browser"
  status: CtxPackBrowserStatus
  errorCode: string | null
  query: CtxPackListQuery
  items: CtxPackSummary[]
  nextCursor: string | null
  selected: CtxPackInfo | null
  revisionByPackID: Map<string, number>
  requestGeneration: number
}

// ---------------------------------------------------------------------------
// Internal runtime bookkeeping (kept OUT of the frozen resolved shape)
// ---------------------------------------------------------------------------

interface CtxPackBrowserRuntime {
  services: BlockRuntimeServices
  requestAbort: AbortController | null
  disposed: boolean
}

const runtimes = new WeakMap<CtxPackBrowserResolved, CtxPackBrowserRuntime>()

const LIST_LIMIT = 30
const LOCAL_VIEW_KEY_PREFIX = "opencode.canvas.local-view.v1:ctxpack-browser:"

type RoutedServerEvent = { type: string; properties: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const localViewKey = (blockID: string): string => `${LOCAL_VIEW_KEY_PREFIX}${blockID}`

const createResolved = (workspaceID: string, blockID: string, query: CtxPackListQuery): CtxPackBrowserResolved => ({
  workspaceID,
  blockID,
  functionalityID: "builtin:ctxpack-browser",
  status: "loading",
  errorCode: null,
  query,
  items: [],
  nextCursor: null,
  selected: null,
  revisionByPackID: new Map(),
  requestGeneration: 0,
})

const defaultCtxPackQuery = (workspaceID: string): CtxPackListQuery => ({
  workspaceID,
  query: "",
  keyword: null,
  sourceBlockID: null,
  sourceFunctionalityID: null,
  sourceKind: null,
  sensitivity: null,
  createdAfter: null,
  createdBefore: null,
  includeDeleted: false,
  sort: "created-desc",
  cursor: null,
  limit: LIST_LIMIT,
})

// Restore a previously persisted query defensively: only well-typed fields are
// copied, the cursor is always reset (page cursors do not survive sessions),
// and the workspaceID is pinned to the current workspace.
const sanitizeQuery = (candidate: unknown, workspaceID: string): CtxPackListQuery => {
  const out = defaultCtxPackQuery(workspaceID)
  if (!isRecord(candidate)) return out
  if (typeof candidate.query === "string") out.query = candidate.query
  if (typeof candidate.keyword === "string") out.keyword = candidate.keyword
  if (typeof candidate.sourceBlockID === "string") out.sourceBlockID = candidate.sourceBlockID
  if (typeof candidate.sourceFunctionalityID === "string") out.sourceFunctionalityID = candidate.sourceFunctionalityID
  if (typeof candidate.sourceKind === "string") out.sourceKind = candidate.sourceKind as CtxPackSourceKind
  if (typeof candidate.sensitivity === "string") out.sensitivity = candidate.sensitivity as CtxPackSensitivity
  if (typeof candidate.createdAfter === "number" && Number.isFinite(candidate.createdAfter))
    out.createdAfter = candidate.createdAfter
  if (typeof candidate.createdBefore === "number" && Number.isFinite(candidate.createdBefore))
    out.createdBefore = candidate.createdBefore
  if (typeof candidate.includeDeleted === "boolean") out.includeDeleted = candidate.includeDeleted
  if (typeof candidate.sort === "string") out.sort = candidate.sort as CtxPackSort
  if (typeof candidate.limit === "number" && Number.isFinite(candidate.limit)) {
    out.limit = Math.min(Math.max(Math.floor(candidate.limit), 1), 200)
  }
  out.workspaceID = workspaceID
  out.cursor = null
  return out
}

// "Changing any field except cursor forces cursor = null."
const applyQueryPatch = (
  current: CtxPackListQuery,
  patch: Partial<CtxPackListQuery>,
  workspaceID: string,
): CtxPackListQuery => {
  const merged: CtxPackListQuery = { ...current, ...patch }
  const onlyCursor = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, "cursor")
  if (!onlyCursor) merged.cursor = null
  merged.workspaceID = workspaceID
  return merged
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type SdkErrorKind = "permission-denied" | "unavailable" | "other"

const sdkErrorRecord = (error: unknown): Record<string, unknown> => {
  const record = isRecord(error) ? error : {}
  const cause = isRecord(record.cause) ? record.cause : undefined
  // The generated SDK preserves HTTP status and the decoded error body in cause.
  if (cause && isRecord(cause.body)) return { ...cause.body, status: cause.status }
  return record
}

const classifySdkError = (error: unknown): SdkErrorKind => {
  const record = sdkErrorRecord(error)
  const status = record.status ?? record.statusCode
  if (typeof status === "number") {
    if (status === 401 || status === 403) return "permission-denied"
    if (status === 502 || status === 503 || status === 504) return "unavailable"
  }
  const code = extractErrorCode(error).toLowerCase()
  if (/permission|forbidden|denied|unauthori[sz]ed/.test(code)) return "permission-denied"
  if (/unavailable|offline|no.?host/.test(code)) return "unavailable"
  const name = typeof record.name === "string" ? record.name.toLowerCase() : ""
  if (/permission|forbidden|denied|unauthori[sz]ed/.test(name)) return "permission-denied"
  if (/unavailable|offline/.test(name)) return "unavailable"
  if (error instanceof TypeError) return "unavailable"
  return "other"
}

const extractErrorCode = (error: unknown): string => {
  const record = sdkErrorRecord(error)
  if (typeof record.code === "string" && record.code.length > 0) return record.code
  if (typeof record._tag === "string" && record._tag.length > 0) return record._tag
  if (typeof record.name === "string" && record.name.length > 0) return record.name
  return "error"
}

const isDeletedOrMissing = (error: unknown): boolean => {
  const record = sdkErrorRecord(error)
  const status = record.status ?? record.statusCode
  if (typeof status === "number" && (status === 404 || status === 410)) return true
  const code = extractErrorCode(error).toLowerCase()
  return /not.?found|deleted|gone|missing/.test(code)
}

// ---------------------------------------------------------------------------
// Request lifecycle
// ---------------------------------------------------------------------------

const chainAbort = (controller: AbortController, signals: Array<AbortSignal | undefined>): (() => void) => {
  const handlers: Array<[AbortSignal, () => void]> = []
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort()
      continue
    }
    const handler = () => controller.abort()
    signal.addEventListener("abort", handler, { once: true })
    handlers.push([signal, handler])
  }
  return () => {
    for (const [signal, handler] of handlers) {
      signal.removeEventListener("abort", handler)
    }
  }
}

// Begins an in-flight SDK request: aborts any prior request (set-query must
// cancel the previous fetch), registers the controller so dispose can abort it.
const beginRequest = (runtime: CtxPackBrowserRuntime, signals: Array<AbortSignal | undefined>) => {
  if (runtime.requestAbort !== null) runtime.requestAbort.abort()
  const controller = new AbortController()
  runtime.requestAbort = controller
  const detach = chainAbort(controller, signals)
  return { controller, detach }
}

const endRequest = (runtime: CtxPackBrowserRuntime, controller: AbortController, detach: () => void) => {
  detach()
  if (runtime.requestAbort === controller) runtime.requestAbort = null
}

// Guards every state mutation: late responses from an old generation, an old
// workspace epoch, or an aborted request can never overwrite current state.
const canMutate = (
  resolved: CtxPackBrowserResolved,
  runtime: CtxPackBrowserRuntime,
  generation: number,
  epochAtStart: number,
  workspaceID: string,
): boolean =>
  !runtime.disposed &&
  resolved.requestGeneration === generation &&
  resolved.workspaceID === workspaceID &&
  runtime.services.workspace.epoch() === epochAtStart

const getCtxPackSdk = (services: BlockRuntimeServices) => services.serverSDK().client.v2.workspace.ctxpack

// ---------------------------------------------------------------------------
// Authoritative list fetch (replace, or append for load-more)
// ---------------------------------------------------------------------------

const performList = async (
  resolved: CtxPackBrowserResolved,
  options: { signal?: AbortSignal; append?: boolean; minimumItems?: number } = {},
): Promise<void> => {
  const runtime = runtimes.get(resolved)
  if (!runtime || runtime.disposed) return

  const generation = resolved.requestGeneration + 1
  resolved.requestGeneration = generation

  const epochAtStart = runtime.services.workspace.epoch()
  const workspaceID = resolved.workspaceID

  const { controller, detach } = beginRequest(runtime, [options.signal])
  const query: CtxPackListQuery =
    options.append === true ? { ...resolved.query, cursor: resolved.nextCursor } : resolved.query
  const request = {
    workspaceID: query.workspaceID,
    query: query.query,
    keyword: query.keyword ?? undefined,
    sourceBlockID: query.sourceBlockID ?? undefined,
    sourceFunctionalityID: query.sourceFunctionalityID ?? undefined,
    sourceKind: query.sourceKind ?? undefined,
    sensitivity: query.sensitivity ?? undefined,
    createdAfter: query.createdAfter?.toString(),
    createdBefore: query.createdBefore?.toString(),
    includeDeleted: String(query.includeDeleted),
    sort: query.sort,
    cursor: query.cursor ?? undefined,
    limit: String(query.limit),
  }

  let payload: { items: CtxPackSummary[]; nextCursor: string | null }
  try {
    payload = (await getCtxPackSdk(runtime.services).list(request, { signal: controller.signal, throwOnError: true }))
      .data
    // Stage the loaded range atomically; a later-page failure keeps the old projection.
    while (payload.nextCursor !== null && payload.items.length < (options.minimumItems ?? 0)) {
      if (!canMutate(resolved, runtime, generation, epochAtStart, workspaceID) || controller.signal.aborted) break
      const next = await getCtxPackSdk(runtime.services).list(
        { ...request, cursor: payload.nextCursor },
        { signal: controller.signal, throwOnError: true },
      )
      payload = { ...next.data, items: [...payload.items, ...next.data.items] }
    }
  } catch (error) {
    endRequest(runtime, controller, detach)
    if (controller.signal.aborted || runtime.disposed) return
    resolved.errorCode = extractErrorCode(error)
    const kind = classifySdkError(error)
    if (kind === "permission-denied") {
      resolved.items = []
      resolved.selected = null
      resolved.nextCursor = null
      resolved.revisionByPackID.clear()
      resolved.status = "permission-denied"
      return
    }
    // Transient refetch failure keeps the last valid items; the initial fetch
    // (nothing to keep) classifies the failure instead.
    if (resolved.items.length > 0) {
      resolved.status = "stale"
    } else {
      resolved.status = kind === "unavailable" ? "unavailable" : "error"
    }
    return
  }
  endRequest(runtime, controller, detach)

  if (!canMutate(resolved, runtime, generation, epochAtStart, workspaceID) || controller.signal.aborted) return

  if (options.append === true) {
    const seen = new Set(resolved.items.map((item) => item.id))
    const fresh = payload.items.filter((item) => !seen.has(item.id))
    resolved.items = [...resolved.items, ...fresh]
    for (const item of payload.items) resolved.revisionByPackID.set(item.id, item.revision)
  } else {
    resolved.items = payload.items
    resolved.revisionByPackID = new Map(payload.items.map((item) => [item.id, item.revision]))
  }
  resolved.nextCursor = payload.nextCursor
  resolved.status = "ready"
  resolved.errorCode = null
}

// ---------------------------------------------------------------------------
// Detail fetch (open / post-mutation refresh)
// ---------------------------------------------------------------------------

const fetchDetail = async (resolved: CtxPackBrowserResolved, targetID: string, signal: AbortSignal): Promise<void> => {
  const runtime = runtimes.get(resolved)
  if (!runtime || runtime.disposed) return

  // Opening the already-selected pack with an unchanged revision reuses the
  // current detail (no redundant get).
  if (resolved.selected !== null && resolved.selected.id === targetID) {
    const cachedRevision = resolved.revisionByPackID.get(targetID)
    if (cachedRevision !== undefined && cachedRevision === resolved.selected.revision) return
  }

  const epochAtStart = runtime.services.workspace.epoch()
  const { controller, detach } = beginRequest(runtime, [signal])
  let result
  try {
    result = await getCtxPackSdk(runtime.services).get(
      { workspaceID: resolved.workspaceID, ctxPackID: targetID },
      { signal: controller.signal, throwOnError: true },
    )
  } catch (error) {
    endRequest(runtime, controller, detach)
    if (controller.signal.aborted || runtime.disposed) return
    if (isDeletedOrMissing(error) || classifySdkError(error) === "permission-denied") {
      // Deleted/missing: close the detail and run an authoritative refetch.
      resolved.selected = null
      resolved.errorCode = extractErrorCode(error)
      await performList(resolved, { signal })
      return
    }
    resolved.errorCode = extractErrorCode(error)
    return
  }
  endRequest(runtime, controller, detach)
  if (controller.signal.aborted || runtime.disposed || runtime.services.workspace.epoch() !== epochAtStart) return

  resolved.selected = result.data
  resolved.revisionByPackID.set(result.data.id, result.data.revision)
  resolved.errorCode = null
}

// ---------------------------------------------------------------------------
// Mutations (patch-metadata / remove / restore)
// ---------------------------------------------------------------------------

const mutateAndRefetch = async (
  resolved: CtxPackBrowserResolved,
  signal: AbortSignal,
  call: () => Promise<unknown>,
): Promise<void> => {
  const runtime = runtimes.get(resolved)
  if (!runtime || runtime.disposed) return

  const epochAtStart = runtime.services.workspace.epoch()
  try {
    await call()
  } catch (error) {
    if (signal.aborted || runtime.disposed || runtime.services.workspace.epoch() !== epochAtStart) return
    resolved.errorCode = extractErrorCode(error)
    throw Object.assign(new Error("CtxPackMutationFailed"), { code: resolved.errorCode })
  }
  if (signal.aborted || runtime.disposed || runtime.services.workspace.epoch() !== epochAtStart) return

  // Authoritatively refresh the loaded range, plus detail when still listed.
  await performList(resolved, { signal, minimumItems: resolved.items.length })
  if (resolved.selected !== null) {
    const selectedID = resolved.selected.id
    if (resolved.items.some((item) => item.id === selectedID)) {
      await fetchDetail(resolved, selectedID, signal)
    } else {
      resolved.selected = null
    }
  }
}

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

const disposeResolved = (resolved: CtxPackBrowserResolved): void => {
  const runtime = runtimes.get(resolved)
  if (!runtime) return
  runtime.disposed = true
  if (runtime.requestAbort !== null) {
    runtime.requestAbort.abort()
    runtime.requestAbort = null
  }
  runtimes.delete(resolved)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const ctxPackBrowserRegistration: BlockRuntimeRegistration<
  CtxPackBrowserResolved,
  CtxPackBrowserView,
  CtxPackBrowserCommand
> = {
  functionalityID: "builtin:ctxpack-browser",
  mode: "projected",
  refreshAfterDispatch: false,
  eventDebounceMs: 150,

  async resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<CtxPackBrowserResolved> {
    const { workspaceID, block, services, signal } = input

    try {
      await services.workspace.awaitDescriptorPersisted(block.id, signal)
    } catch (error) {
      if (signal.aborted) return createResolved(workspaceID, block.id, defaultCtxPackQuery(workspaceID))
      throw error
    }

    // Restore the persisted query (never items/selected/contents).
    const stored = services.localView.read<{ query?: unknown }>(localViewKey(block.id))
    const query = sanitizeQuery(stored?.query, workspaceID)

    if (signal.aborted) return createResolved(workspaceID, block.id, query)

    const resolved = createResolved(workspaceID, block.id, query)
    const runtime: CtxPackBrowserRuntime = {
      services,
      requestAbort: null,
      disposed: false,
    }
    runtimes.set(resolved, runtime)

    // ONE initial list with the (restored or default) query.
    await performList(resolved, { signal })

    if (signal.aborted) {
      // Aborted: stop mutating state and hand back an inert loading stub.
      disposeResolved(resolved)
      return createResolved(workspaceID, block.id, query)
    }
    return resolved
  },

  async refresh({ resolved, signal }) {
    await performList(resolved, { signal, minimumItems: resolved.items.length })
    if (resolved.status !== "ready" || resolved.selected === null) return
    await fetchDetail(resolved, resolved.selected.id, signal)
  },

  eventKeys(resolved: CtxPackBrowserResolved): readonly RuntimeEventKey[] {
    return [{ type: "workspace.ctxpack.changed", workspaceID: resolved.workspaceID }]
  },

  onEvent(input: {
    event: RoutedServerEvent
    resolved: CtxPackBrowserResolved
    services: BlockRuntimeServices
  }): "ignore" | "invalidate" {
    const { event, resolved } = input
    if (event.type !== "workspace.ctxpack.changed") return "ignore"
    const properties = isRecord(event.properties) ? event.properties : {}
    if (properties.workspaceID !== undefined && properties.workspaceID !== resolved.workspaceID) return "ignore"
    return "invalidate"
  },

  select(input: { resolved: CtxPackBrowserResolved; projection: unknown; localView: unknown }): CtxPackBrowserView {
    const { resolved } = input
    return {
      status: resolved.status,
      query: resolved.query,
      items: resolved.items,
      nextCursor: resolved.nextCursor,
      selected: resolved.selected,
      loadingMore: false,
      errorCode: resolved.errorCode,
      // v1 capability flags — real capability projection arrives post-M1.
      canCreate: true,
      canPatch: true,
      canDelete: true,
      canMaterialize: true,
    }
  },

  async dispatch(input: {
    resolved: CtxPackBrowserResolved
    command: CtxPackBrowserCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<void> {
    const { resolved, command, services, signal } = input
    const runtime = runtimes.get(resolved)
    if (!runtime || runtime.disposed) return
    const sdk = getCtxPackSdk(services)

    switch (command.type) {
      case "set-query": {
        const next = applyQueryPatch(resolved.query, command.patch, resolved.workspaceID)
        resolved.query = next
        resolved.nextCursor = null
        // Persist the whole local view object `{ query }` (never items or
        // selected); the cursor is restored as null.
        services.localView.write(localViewKey(resolved.blockID), { query: next })
        await performList(resolved, { signal })
        return
      }
      case "load-more": {
        if (resolved.nextCursor === null || resolved.status === "loading") return
        await performList(resolved, { signal, append: true })
        return
      }
      case "open": {
        await fetchDetail(resolved, command.ctxPackID, signal)
        return
      }
      case "close-detail": {
        resolved.selected = null
        return
      }
      case "patch-metadata": {
        await mutateAndRefetch(resolved, signal, () =>
          sdk.patch(
            {
              workspaceID: resolved.workspaceID,
              ctxPackID: command.ctxPackID,
              ctxPackPatchPayload: {
                expectedRevision: command.expectedRevision,
                patch: { ...command.patch, tags: command.patch.tags?.slice() },
                idempotencyKey: crypto.randomUUID(),
              },
            },
            { signal, throwOnError: true },
          ),
        )
        return
      }
      case "remove": {
        await mutateAndRefetch(resolved, signal, () =>
          sdk.remove(
            {
              workspaceID: resolved.workspaceID,
              ctxPackID: command.ctxPackID,
              ctxPackRevisionPayload: { expectedRevision: command.expectedRevision },
            },
            { signal, throwOnError: true },
          ),
        )
        return
      }
      case "restore": {
        await mutateAndRefetch(resolved, signal, () =>
          sdk.restore(
            {
              workspaceID: resolved.workspaceID,
              ctxPackID: command.ctxPackID,
              ctxPackRevisionPayload: { expectedRevision: command.expectedRevision },
            },
            { signal, throwOnError: true },
          ),
        )
        return
      }
    }
  },

  dispose(resolved: CtxPackBrowserResolved): void {
    disposeResolved(resolved)
  },
}
