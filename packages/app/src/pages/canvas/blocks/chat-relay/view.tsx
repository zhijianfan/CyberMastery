import { ChatProxyRelaySurface } from "./proxy-surface"
import { type JSX, Show } from "solid-js"
import { createMasterAgentSessionOptions } from "../../master-agent/session-options"
import { permissionDenied } from "../../permissions"
import { useBlockRuntimeHandle } from "../../runtime/block-runtime-host"
import type { ChatRelayView } from "./runtime"
import type { ChatRelayBodyProps } from "./types"

export const iconRelay = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
    <path d="M13 7h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-4" />
  </svg>
)

export const iconClose = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
)

export const iconSpin = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v6h-6" />
  </svg>
)

export function ChatRelayBody(props: ChatRelayBodyProps): JSX.Element {
  const handle = useBlockRuntimeHandle()
  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")
  const status = () => handle?.status() ?? "unavailable"
  const denied = () => networkDenied() || status() === "permission-denied"
  const view = (): ChatRelayView | undefined => handle?.view() as ChatRelayView | undefined
  const sessionOptions = () => {
    const current = view()
    if (!current?.sessionID || !current.directory) return
    return createMasterAgentSessionOptions(current)
  }

  return (
    <div
      class="canvas-relay-layout"
      data-runtime-status={status()}
      data-runtime-has-view={view() ? "true" : "false"}
    >
      <Show when={denied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">Permission denied</div>
          <div class="canvas-relay-state-note">
            The project config denies network access (webfetch/websearch). Edit the project config to allow it.
          </div>
        </div>
      </Show>
      <Show when={!denied() && status() === "resolving"}>
        <div class="canvas-relay-state">
          <div class="canvas-relay-spinner" aria-hidden="true">
            {iconSpin()}
          </div>
          <div class="canvas-relay-state-title">Preparing chat relay</div>
          <div class="canvas-relay-state-note">Creating or loading the chat relay session for this block.</div>
        </div>
      </Show>
      <Show when={!denied() && status() === "unavailable"}>
        <div class="canvas-relay-state">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconRelay()}
          </div>
          <div class="canvas-relay-state-title">Block needs a chat relay binding</div>
          <div class="canvas-relay-state-note">
            This block relays to your chat account and cannot route until a session is bound.
          </div>
        </div>
      </Show>
      <Show when={!denied() && status() === "error"}>
        <div class="canvas-relay-state error">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">Relay unavailable</div>
          <div class="canvas-relay-state-note">The chat relay binding failed. Retry initialization.</div>
        </div>
      </Show>
      <Show when={!denied() && (status() === "ready" || status() === "stale") && !sessionOptions()}>
        <div class="canvas-relay-state error" role="status">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">Relay view unavailable</div>
          <div class="canvas-relay-state-note">
            Runtime status: {status()}. Diagnostic history is available at window.__CHAT_RELAY_TRACE__.
          </div>
        </div>
      </Show>
      <Show when={!denied() && status() !== "resolving" && status() !== "unavailable" && sessionOptions()}>
        <ChatProxyRelaySurface relayID={`${props.workspaceID}:${props.block.id}`} />
      </Show>
    </div>
  )
}
