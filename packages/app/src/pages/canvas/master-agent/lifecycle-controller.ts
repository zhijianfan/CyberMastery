// MasterAgent lifecycle controller: orchestrates the binding lifecycle for one
// block against the M1 reducer and port. The host owns the authoritative
// binding; the controller owns only the per-block client projection. Requests
// are deduplicated while in flight, and stale responses are dropped after a
// workspace switch, block removal, or disposal.

import { createSignal, type Accessor } from "solid-js"
import { classifyMasterAgentError, initialBindingState, reduceMasterAgentBinding, type MasterAgentEvent } from "./reducer"
import type { BindingState, MasterAgent, MasterAgentPort } from "./types"

export interface LifecycleControllerInput {
  workspaceID: () => string | undefined
  blockID: string
  port: MasterAgentPort
  /** Client projection of whether the bound session is idle with no pending input. Reset is skipped while false; the host enforces it again. */
  idle?: () => boolean
}

export interface MasterAgentLifecycleController {
  state: Accessor<BindingState>
  dispatch: (event: MasterAgentEvent) => void
  ensure: () => Promise<void>
  retry: () => Promise<void>
  reset: () => Promise<void>
  refetch: () => Promise<void>
  removeLocalProjection: () => void
  dispose: () => void
}

type Operation = "ensure" | "reset" | "refetch"

interface Inflight {
  operation: Operation
  promise: Promise<void>
}

export function createMasterAgentLifecycleController(
  input: LifecycleControllerInput,
): MasterAgentLifecycleController {
  const [state, setState] = createSignal<BindingState>(initialBindingState())
  const isIdle = input.idle ?? (() => true)

  let disposed = false
  let inflight: Inflight | undefined
  let inflightAbort: AbortController | undefined

  function debug(message: string, payload?: unknown) {
    if (typeof globalThis !== "object" || !(globalThis as { __CANVAS_INTEGRATION_TRACE__?: boolean }).__CANVAS_INTEGRATION_TRACE__)
      return
    if (payload === undefined) console.error(`master-agent-controller ${input.blockID} ${message}`)
    else console.error(`master-agent-controller ${input.blockID} ${message}`, payload)
  }

  function dispatch(event: MasterAgentEvent) {
    if (disposed) return
    debug("dispatch", event)
    setState((current) => reduceMasterAgentBinding(current, event))
  }

  function stale(abort: AbortController, workspaceID: string): boolean {
    return disposed || abort.signal.aborted || input.workspaceID() !== workspaceID
  }

  function runRequest(
    operation: Operation,
    workspaceID: string,
    call: (signal: AbortSignal) => Promise<MasterAgent.Binding | null>,
  ): Promise<void> {
    inflightAbort?.abort()
    const abort = new AbortController()
    inflightAbort = abort
    const entry: Inflight = { operation, promise: Promise.resolve() }
    inflight = entry
    entry.promise = execute(operation, workspaceID, abort, call)
    return entry.promise
  }

  async function execute(
    operation: Operation,
    workspaceID: string,
    abort: AbortController,
    call: (signal: AbortSignal) => Promise<MasterAgent.Binding | null>,
  ) {
    try {
      debug("result:request", { operation, workspaceID })
      const binding = await call(abort.signal)
      if (stale(abort, workspaceID)) return
      if (binding === null) dispatch({ type: "binding-missing" })
      else dispatch({ type: "binding", binding })
    } catch (error) {
      if (stale(abort, workspaceID)) return
      if (isAbortError(error)) return
      dispatch(classifyMasterAgentError(error))
      if (operation !== "refetch" && isUnknownConflict(error)) void refetch()
    } finally {
      if (inflightAbort === abort) {
        inflightAbort = undefined
        inflight = undefined
      }
    }
  }

  function ensure(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (state().status === "ready") return Promise.resolve()
    if (inflight?.operation === "ensure") return inflight.promise
    const workspaceID = input.workspaceID()
    if (!workspaceID) return Promise.resolve()
    dispatch({ type: "loading" })
    return runRequest("ensure", workspaceID, (signal) => input.port.ensure(workspaceID, input.blockID, signal))
  }

  function retry(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (state().status === "ready") return Promise.resolve()
    return ensure()
  }

  function reset(): Promise<void> {
    if (disposed) return Promise.resolve()
    const current = state()
    if (current.status !== "ready") return Promise.resolve()
    if (!isIdle()) return Promise.resolve()
    if (input.workspaceID() !== current.binding.workspaceID) return Promise.resolve()
    if (inflight?.operation === "reset") return inflight.promise
    const request: MasterAgent.ResetRequest = {
      workspaceID: current.binding.workspaceID,
      blockID: current.binding.blockID,
      expectedSessionID: current.binding.sessionID,
      expectedRevision: current.binding.revision,
    }
    return runRequest("reset", request.workspaceID, (signal) => input.port.reset(request, signal))
  }

  function refetch(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (inflight?.operation === "refetch") return inflight.promise
    const workspaceID = input.workspaceID()
    if (!workspaceID) return Promise.resolve()
    return runRequest("refetch", workspaceID, (signal) => input.port.get(workspaceID, input.blockID, signal))
  }

  function removeLocalProjection() {
    if (disposed) return
    inflightAbort?.abort()
    inflight = undefined
    inflightAbort = undefined
    dispatch({ type: "removed" })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    inflightAbort?.abort()
    inflight = undefined
    inflightAbort = undefined
    setState(initialBindingState())
  }

  return {
    state,
    dispatch,
    ensure,
    retry,
    reset,
    refetch,
    removeLocalProjection,
    dispose,
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

function isUnknownConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("type" in error)) return false
  if (error.type === "concurrent-conflict") return true
  return error.type === "stale-binding" && !("current" in error)
}
