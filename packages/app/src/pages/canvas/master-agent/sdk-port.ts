import type { OpencodeClient, WorkspaceUpdatePayload } from "@opencode-ai/sdk/v2/client"
import type { MasterAgentError, MasterAgentTransport, ModelSelection, WorkspaceInfo, WorkspacePatch } from "./types"

/**
 * Adapter from the G1-generated SDK client (`@opencode-ai/sdk/v2/client`,
 * the surface the app consumes via `createOpencodeClient`) to the M1
 * `MasterAgentTransport` port. Generated values are converted to the
 * client-domain models in `./types` at this boundary; nothing generated
 * escapes this file. Server failures are normalized to the
 * `MasterAgentError` union; aborts and unrecognized errors pass through.
 */
export function createMasterAgentSdkPort(client: OpencodeClient): MasterAgentTransport {
  const masterAgent = client.workspace.masterAgent
  const workspace = client.workspace
  return {
    async get(request, signal) {
      try {
        const result = await masterAgent.get(
          { workspaceID: request.workspaceID, blockID: request.blockID },
          { signal, throwOnError: true },
        )
        return result.data.status === "unbound" ? null : result.data.binding
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async ensure(request, signal) {
      try {
        const result = await masterAgent.ensure(
          { workspaceID: request.workspaceID, blockID: request.blockID },
          { signal, throwOnError: true },
        )
        return result.data
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async reset(request, signal) {
      try {
        const result = await masterAgent.reset(
          {
            workspaceID: request.workspaceID,
            blockID: request.blockID,
            masterAgentResetPayload: {
              expectedSessionID: request.expectedSessionID,
              expectedRevision: request.expectedRevision,
            },
          },
          { signal, throwOnError: true },
        )
        if (result.data.status === "reset") return result.data.binding
        if (result.data.status === "stale") throw { type: "stale-binding" } as const
        throw resetBusyError(result.data.reason)
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
    async patchWorkspace(workspaceID, patch, signal) {
      try {
        const result = await workspace.update(
          { workspaceUpdatePayload: encodeCoderModelPatch(workspaceID, patch) },
          { signal, throwOnError: true },
        )
        return decodeWorkspaceInfo(result.data)
      } catch (error) {
        throw normalizeTransportError(error, signal)
      }
    },
  }
}

/**
 * The wire schema (`WorkspaceCoder.Patch`) accepts explicit `null` to clear,
 * but G1's generated `WorkspaceUpdatePayload` dropped the null branch, so the
 * clear case needs a type-only escape at this single boundary.
 */
function encodeCoderModelPatch(workspaceID: string, patch: WorkspacePatch): WorkspaceUpdatePayload {
  const coderModel = patch.coderModel
  if (coderModel === undefined) return { id: workspaceID, patch: {} }
  if (coderModel === null) return { id: workspaceID, patch: { coderModel: null } as unknown as WorkspaceUpdatePayload["patch"] }
  return { id: workspaceID, patch: { coderModel: formatModelSelection(coderModel) } }
}

type WorkspaceInfoWire = {
  model?: string
  operatingAgent?: string
  coderModel?: string | null
}

function decodeWorkspaceInfo(info: WorkspaceInfoWire): WorkspaceInfo {
  return {
    model: parseModelSelection(info.model),
    operatingAgent: info.operatingAgent ?? null,
    coderModel: parseModelSelection(info.coderModel),
  }
}

function formatModelSelection(selection: ModelSelection): string {
  if (!selection.variant) return `${selection.providerID}:${selection.modelID}`
  return `${selection.providerID}:${selection.modelID}:${selection.variant}`
}

function parseModelSelection(value: string | null | undefined): ModelSelection | null {
  if (!value) return null
  const [providerID, modelID, variant] = value.split(":")
  if (!providerID || !modelID) return null
  if (!variant) return { providerID, modelID }
  return { providerID, modelID, variant }
}

function resetBusyError(reason: string): MasterAgentError {
  // The server reports a busy reset with a free-text reason; a pending-input
  // policy failure carries a "pending" marker.
  return reason.toLowerCase().includes("pending") ? { type: "reset-has-pending-input" } : { type: "reset-busy" }
}

function normalizeTransportError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return signal.reason instanceof Error ? signal.reason : createAbortError()
  if (isAbortError(error)) return error
  const { body, status } = errorBody(error)
  if (status === 401) return { type: "access-denied" }
  const tag = body?._tag
  if (tag === "MasterAgentWorkspaceNotFoundError") return { type: "workspace-not-found" }
  if (tag === "MasterAgentBlockNotFoundError") return { type: "block-not-found" }
  if (tag === "MasterAgentInstanceNotFoundError") return { type: "instance-not-found" }
  if (tag === "MasterAgentWrongFunctionalityError") {
    const actual = body?.actual
    return typeof actual === "string" ? { type: "wrong-functionality", actual } : { type: "wrong-functionality" }
  }
  if (tag === "MasterAgentAccessDeniedError") return { type: "access-denied" }
  if (tag === "MasterAgentConflictError") return { type: "concurrent-conflict" }
  if (tag === "MasterAgentStaleBindingError") return { type: "stale-binding" }
  if (tag === "MasterAgentBusyError") return { type: "reset-busy" }
  return error
}

function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

type ErrorBody = { _tag?: unknown; actual?: unknown }

function errorBody(error: unknown): { body?: ErrorBody; status?: number } {
  if (!(error instanceof Error)) return {}
  const cause = error.cause
  if (cause === null || typeof cause !== "object" || !("body" in cause)) return {}
  const body = cause.body
  if (body === null || typeof body !== "object" || !("_tag" in body)) return {}
  const status = "status" in cause && typeof cause.status === "number" ? cause.status : undefined
  return { body: body as ErrorBody, status }
}
