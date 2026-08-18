import "./master-agent.css"
import type { JSX } from "solid-js"
import { MasterAgentStatusView } from "./status-view"

export type MasterAgentBindingStatus =
  | "uninitialized"
  | "loading"
  | "ready"
  | "permission-denied"
  | "unavailable"
  | "error"

export interface MasterAgentBlockShellProps {
  status: MasterAgentBindingStatus
  focused: boolean
  canReset: boolean
  resetDisabledReason?: string
  onFocus(): void
  onRetry(): void
  onReset(): void
  onOpenFullPage?(): void
  sessionSlot?: JSX.Element
  coderSlot?: JSX.Element
}

export function MasterAgentBlockShell(props: MasterAgentBlockShellProps) {
  if (props.status !== "ready") {
    return (
      <div
        class="master-agent-shell"
        classList={{ focused: props.focused }}
        data-status={props.status}
        onClick={() => props.onFocus()}
      >
        <MasterAgentStatusView status={props.status} onRetry={props.onRetry} />
      </div>
    )
  }
  return (
    <div
      class="master-agent-shell"
      classList={{ focused: props.focused }}
      data-status={props.status}
      onClick={() => props.onFocus()}
    >
      <div class="master-agent-body">
        {props.sessionSlot ? (
          <div class="master-agent-session-slot" data-slot="session">
            {props.sessionSlot}
          </div>
        ) : null}
      </div>
      <div class="master-agent-footer">
        {props.coderSlot ? (
          <div class="master-agent-coder-slot" data-slot="coder">
            {props.coderSlot}
          </div>
        ) : null}
        <div class="master-agent-actions">
          {!props.canReset && props.resetDisabledReason ? (
            <span class="master-agent-reset-reason">{props.resetDisabledReason}</span>
          ) : null}
          {props.onOpenFullPage ? (
            <button
              type="button"
              class="master-agent-button"
              aria-label="Open in full page"
              onClick={() => props.onOpenFullPage?.()}
            >
              Full page
            </button>
          ) : null}
          <button
            type="button"
            class="master-agent-button primary"
            aria-disabled={!props.canReset}
            disabled={!props.canReset}
            title={props.canReset ? undefined : props.resetDisabledReason}
            onClick={() => props.onReset()}
          >
            Reset session
          </button>
        </div>
      </div>
    </div>
  )
}
