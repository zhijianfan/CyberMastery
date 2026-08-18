import type { JSX } from "solid-js"
import type { MasterAgentBindingStatus } from "./block-shell"

export interface MasterAgentStatusViewProps {
  status: Exclude<MasterAgentBindingStatus, "ready">
  onRetry(): void
}

interface StatusCopy {
  title: string
  note: string
  icon: () => JSX.Element
}

const STATUS_COPY: Record<MasterAgentStatusViewProps["status"], StatusCopy> = {
  loading: {
    title: "Connecting session…",
    note: "Resolving the workspace MasterAgent session.",
    icon: iconSpinner,
  },
  uninitialized: {
    title: "Session not initialized",
    note: "The MasterAgent session has not been created yet.",
    icon: iconSpark,
  },
  "permission-denied": {
    title: "Permission denied",
    note: "You don't have access to this MasterAgent session.",
    icon: iconLock,
  },
  unavailable: {
    title: "Session unavailable",
    note: "The session is missing or was deleted. Reconnect to start over.",
    icon: iconAlert,
  },
  error: {
    title: "Something went wrong",
    note: "The session hit an unexpected error. Try again.",
    icon: iconAlert,
  },
}

export function MasterAgentStatusView(props: MasterAgentStatusViewProps) {
  const copy = STATUS_COPY[props.status]
  const canRetry = props.status === "unavailable" || props.status === "error"
  return (
    <div
      class="master-agent-status"
      classList={{
        "is-loading": props.status === "loading",
        "is-denied": props.status === "permission-denied",
        "is-error": canRetry,
      }}
      data-status={props.status}
      role="status"
    >
      <div class="master-agent-status-icon" aria-hidden="true">
        {copy.icon()}
      </div>
      <div class="master-agent-status-title">{copy.title}</div>
      <div class="master-agent-status-note">{copy.note}</div>
      {canRetry ? (
        <button type="button" class="master-agent-retry-button" onClick={() => props.onRetry()}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

function iconSpinner() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v6h-6" />
    </svg>
  )
}

function iconSpark() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </svg>
  )
}

function iconLock() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <path d="M12 15v2" />
    </svg>
  )
}

function iconAlert() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 4 3.5 19h17L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}
