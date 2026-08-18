// Workspace-wide Coder model controller: owns the coderModel, pending, and
// error signals for the workspace and pushes updates through the
// manager-provided port. The server response is authoritative; optimistic
// results are dropped when stale and rolled back on failure.

import { createSignal, type Accessor } from "solid-js"

export type CoderTaskPermission = "allow" | "deny" | "ask" | "default"

export type CoderModelError<Model> =
  | { type: "permission-denied" }
  | { type: "model-unavailable"; model: Model }
  | { type: "no-workspace" }
  | { type: "patch-failed"; cause: unknown }

export interface CoderControllerInput<Model> {
  workspaceID: () => string | undefined
  coderModel: () => Model | null
  patchCoderModel: (
    workspaceID: string,
    coderModel: Model | null,
    signal?: AbortSignal,
  ) => Promise<{ coderModel: Model | null }>
  onServerModel?: (model: Model | null) => void
  taskPermission: () => CoderTaskPermission
  isModelAvailable: (model: Model) => boolean
}

export interface CoderController<Model> {
  model: Accessor<Model | null>
  enabled: Accessor<boolean>
  pending: Accessor<boolean>
  error: Accessor<unknown | null>
  set: (model: Model) => Promise<void>
  clear: () => Promise<void>
  retry: () => Promise<void>
}

export function createCoderController<Model>(input: CoderControllerInput<Model>): CoderController<Model> {
  const [model, setModel] = createSignal<Model | null>(input.coderModel())
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<unknown | null>(null)
  const enabled = () => model() !== null

  let requestSeq = 0
  let inflight: AbortController | undefined
  let lastRequest: { op: "set"; model: Model } | { op: "clear" } | undefined

  function fail(coderError: CoderModelError<Model>): never {
    setError(coderError)
    throw coderError
  }

  function requireWorkspace(): string {
    const workspaceID = input.workspaceID()
    if (!workspaceID) fail({ type: "no-workspace" })
    return workspaceID
  }

  function requirePermission() {
    if (input.taskPermission() === "deny") fail({ type: "permission-denied" })
  }

  async function patch(workspaceID: string, next: Model | null) {
    const id = ++requestSeq
    inflight?.abort()
    inflight = new AbortController()
    setPending(true)
    setError(null)
    setModel(next)
    try {
      const result = await input.patchCoderModel(
        workspaceID,
        next,
        inflight.signal,
      )
      if (id !== requestSeq) return
      if (input.workspaceID() !== workspaceID) {
        setModel(input.coderModel())
        return
      }
      setModel(result.coderModel)
      input.onServerModel?.(result.coderModel)
    } catch (cause) {
      if (id !== requestSeq || input.workspaceID() !== workspaceID) return
      setModel(input.coderModel())
      setError({ type: "patch-failed", cause })
      throw cause
    } finally {
      if (id === requestSeq) setPending(false)
    }
  }

  async function set(modelToSet: Model) {
    const workspaceID = requireWorkspace()
    requirePermission()
    if (!input.isModelAvailable(modelToSet)) {
      fail({ type: "model-unavailable", model: modelToSet })
    }
    lastRequest = { op: "set", model: modelToSet }
    await patch(workspaceID, modelToSet)
  }

  async function clear() {
    const workspaceID = requireWorkspace()
    requirePermission()
    lastRequest = { op: "clear" }
    await patch(workspaceID, null)
  }

  async function retry() {
    if (pending()) return
    const request = lastRequest
    if (!request) {
      setError(null)
      const workspaceID = input.workspaceID()
      if (!workspaceID) fail({ type: "no-workspace" })
      setModel(input.coderModel())
      return
    }
    if (request.op === "set") {
      await set(request.model)
      return
    }
    await clear()
  }

  return {
    model,
    enabled,
    pending,
    error,
    set,
    clear,
    retry,
  }
}
