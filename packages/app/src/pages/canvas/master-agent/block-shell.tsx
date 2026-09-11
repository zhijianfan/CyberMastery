import "./master-agent.css"
import { Show, type JSX } from "solid-js"
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
}

export function MasterAgentBlockShell(props: MasterAgentBlockShellProps) {
  return (() =>
    props.status !== "ready" ? (
      <div
        class="master-agent-shell"
        classList={{ focused: props.focused }}
        data-status={props.status}
        onClick={() => props.onFocus()}
      >
        <MasterAgentStatusView status={props.status} onRetry={props.onRetry} />
      </div>
    ) : (
      <div
        class="master-agent-shell"
        classList={{ focused: props.focused }}
        data-status={props.status}
        onClick={() => props.onFocus()}
      >
        <div class="master-agent-body">
          <Show when={props.sessionSlot}>
            {(slot) => (
              <div class="master-agent-session-slot" data-slot="session">
                {slot()}
              </div>
            )}
          </Show>
        </div>
        <div class="master-agent-footer">
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
    )) as unknown as JSX.Element
}
