import type { BindingState, MasterAgent, MasterAgentError } from "./types"

export type MasterAgentEvent =
  | { type: "loading" }
  | { type: "binding"; binding: MasterAgent.Binding }
  | { type: "binding-updated"; event: MasterAgent.BindingUpdatedEvent }
  | { type: "binding-missing" }
  | { type: "permission-denied" }
  | { type: "unavailable"; reason: string }
  | { type: "error"; error: unknown; recoverable: boolean }
  | { type: "reconnect" }
  | { type: "removed" }

export function initialBindingState(): BindingState {
  return { status: "uninitialized" }
}

export function reduceMasterAgentBinding(state: BindingState, event: MasterAgentEvent): BindingState {
  switch (event.type) {
    case "loading":
      // A refetch hint must not degrade a healthy block.
      return state.status === "ready" ? state : { status: "loading" }
    case "binding":
      // Snapshots are authoritative but can race: never adopt an older revision.
      if (state.status === "ready" && event.binding.revision < state.binding.revision) return state
      return { status: "ready", binding: event.binding }
    case "binding-updated":
      return applyBindingUpdated(state, event.event)
    case "binding-missing":
      return initialBindingState()
    case "permission-denied":
      return { status: "permission-denied" }
    case "unavailable":
      return { status: "unavailable", reason: event.reason }
    case "error":
      return { status: "error", error: event.error, recoverable: event.recoverable }
    case "reconnect":
      // The server may have changed while disconnected: healthy blocks refresh
      // in place, everything else asks for an authoritative get/ensure.
      return state.status === "ready" ? state : { status: "loading" }
    case "removed":
      return initialBindingState()
  }
}

function applyBindingUpdated(state: BindingState, event: MasterAgent.BindingUpdatedEvent): BindingState {
  if (state.status !== "ready") return { status: "loading" }
  if (event.workspaceID !== state.binding.workspaceID || event.blockID !== state.binding.blockID) return state
  if (event.revision <= state.binding.revision) return state
  return {
    status: "ready",
    binding: {
      ...state.binding,
      sessionID: event.sessionID,
      generation: event.generation,
      revision: event.revision,
    },
  }
}

const MASTER_AGENT_ERROR_TYPES = [
  "workspace-not-found",
  "block-not-found",
  "wrong-functionality",
  "instance-not-found",
  "session-not-found",
  "access-denied",
  "stale-binding",
  "reset-busy",
  "reset-has-pending-input",
  "concurrent-conflict",
] as const

export function classifyMasterAgentError(error: unknown): MasterAgentEvent {
  if (!isMasterAgentError(error)) return { type: "error", error, recoverable: true }
  switch (error.type) {
    case "access-denied":
      return { type: "permission-denied" }
    case "stale-binding":
      if (error.current !== undefined) return { type: "binding", binding: error.current }
      return { type: "error", error, recoverable: true }
    case "reset-busy":
    case "reset-has-pending-input":
    case "concurrent-conflict":
      return { type: "error", error, recoverable: true }
    case "workspace-not-found":
    case "block-not-found":
    case "wrong-functionality":
    case "instance-not-found":
    case "session-not-found":
      return { type: "unavailable", reason: error.type }
  }
}

function isMasterAgentError(error: unknown): error is MasterAgentError {
  if (typeof error !== "object" || error === null || !("type" in error)) return false
  return MASTER_AGENT_ERROR_TYPES.some((type) => type === error.type)
}
