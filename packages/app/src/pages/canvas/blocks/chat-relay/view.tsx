import { For, onMount, type JSX, createEffect, createSignal, Show } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { createMasterAgentSessionOptions } from "../../master-agent/session-options"
import { CanvasSessionSurface } from "../../session-surface"
import { CanvasSessionSurfaceProviders } from "../../session-surface-providers"
import { permissionDenied } from "../../permissions"
import { useBlockRuntimeHandle } from "../../runtime/block-runtime-host"
import type { ChatRelayView } from "./runtime"
import type { ChatRelayBodyProps, ChatRelayCommand } from "./types"

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

function parseRuntimeV2(): boolean {
  // Legacy path is the safe default. The block runtime branch activates only
  // when the flag is explicitly set — VITE_CYBERMASTER_BLOCK_RUNTIME_V2 in
  // dev, or the global override used by the browser tests.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  const global = (globalThis as { __CYBERMASTER_BLOCK_RUNTIME_V2__?: unknown }).__CYBERMASTER_BLOCK_RUNTIME_V2__
  const value = env?.["VITE_CYBERMASTER_BLOCK_RUNTIME_V2"] ?? global
  return value === true || value === "true" || value === 1 || value === "1"
}

function RuntimeChatRelayBody(props: ChatRelayBodyProps) {
  const handle = useBlockRuntimeHandle()
  const [promptText, setPromptText] = createSignal("")
  const [isSubmitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")

  const status = () => handle?.status() ?? "unavailable"
  const view = (): ChatRelayView | undefined => handle?.view() as ChatRelayView | undefined

  const dispatchCommand = async (command: ChatRelayCommand) => {
    if (!handle) return
    await handle.dispatch(command)
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      await dispatchCommand({ type: "session.prompt", text: promptText(), delivery: "queue" })
      setPromptText("")
    } catch {
      setError("Submit failed")
    } finally {
      setSubmitting(false)
    }
  }

  const startSignIn = async () => {
    await dispatchCommand({ type: "auth.start", providerID: "opencode" })
  }

  createEffect(() => {
    const nextError = view()?.errors.at(0)
    if (nextError) setError(nextError)
  })

  return (
    <div class="canvas-relay-layout">
      <Show when={networkDenied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">Permission denied</div>
          <div class="canvas-relay-state-note">
            The project config denies network access (webfetch/websearch). Edit the project config to allow it.
          </div>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "resolving"}>
        <div class="canvas-relay-state">
          <div class="canvas-relay-spinner" aria-hidden="true">
            {iconSpin()}
          </div>
          <div class="canvas-relay-state-title">Preparing chat relay</div>
          <div class="canvas-relay-state-note">Creating or loading the chat relay session for this block.</div>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "unavailable"}>
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
      <Show when={!networkDenied() && status() === "error"}>
        <div class="canvas-relay-state error">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">Relay unavailable</div>
          <div class="canvas-relay-state-note">The chat relay binding failed. Retry initialization.</div>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "ready" && view()?.auth?.status === "awaiting-login"}>
        <div class="canvas-relay-state needs-login">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">Waiting for sign-in</div>
          <div class="canvas-relay-state-note">This relay requires authentication for this workspace.</div>
          <button type="button" class="canvas-relay-init-button" onClick={() => void startSignIn()}>
            Sign in
          </button>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "ready" && view()?.auth?.status !== "awaiting-login"}>
        <Show when={view()?.connectionStatus === "disconnected"}>
          <div class="canvas-relay-banner">Disconnected from relay</div>
        </Show>
        <Show when={error()}>
          <div class="canvas-relay-error">{error()}</div>
        </Show>
        <For each={view()?.messages ?? []}>
          {(message) => <div class="canvas-relay-message-text">{message.text}</div>}
        </For>
        <Show when={(view()?.pendingPermissions.length ?? 0) > 0}>
          <div class="canvas-relay-permission-panel" data-testid="chat-relay-permissions">
            <For each={view()?.pendingPermissions ?? []}>
              {(permission) => (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({
                        type: "permission.respond",
                        requestID: permission.requestID,
                        response: "allow-once",
                      })
                    }
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({
                        type: "permission.respond",
                        requestID: permission.requestID,
                        response: "allow-always",
                      })
                    }
                  >
                    Allow always
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({
                        type: "permission.respond",
                        requestID: permission.requestID,
                        response: "deny",
                      })
                    }
                  >
                    Deny
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <form onSubmit={handleSubmit}>
          <textarea
            value={promptText()}
            onInput={(event) => setPromptText((event.currentTarget as HTMLTextAreaElement).value)}
          />
          <button type="submit" disabled={isSubmitting()}>
            Send
          </button>
        </form>
      </Show>
    </div>
  )
}

function LegacyChatRelayBody(props: ChatRelayBodyProps) {
  const serverSDK = useServerSDK()
  const [binding, setBinding] = createSignal<{
    workspaceID: string
    blockID: string
    functionalityInstanceID: string
    sessionID: string
    directory?: string
    generation: number
    revision: number
  }>()
  const [status, setStatus] = createSignal<"uninitialized" | "loading" | "ready" | "error">("uninitialized")

  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")

  const ensureBinding = async () => {
    if (networkDenied()) return
    if (!props.workspaceID) return
    if (status() === "loading") return
    setStatus("loading")
    try {
      const result = await serverSDK().client.v2.workspace.chatRelay.ensure(
        { workspaceID: props.workspaceID, blockID: props.block.id },
        { throwOnError: true },
      )
      setBinding(result.data)
      setStatus("ready")
    } catch {
      setBinding(undefined)
      setStatus("error")
    }
  }

  onMount(() => {
    void ensureBinding()
  })

  // The canvas mounts blocks before the manager finishes resolving the
  // workspace ID (workspaceID is "" at mount). Retry the binding once the ID
  // arrives instead of leaving the block stuck on the uninitialized state.
  createEffect(() => {
    if (props.workspaceID && status() === "uninitialized") void ensureBinding()
  })

  const sessionOptions = () => {
    const current = binding()
    if (!current) return undefined
    return createMasterAgentSessionOptions({
      sessionID: current.sessionID,
      directory: current.directory,
      workspaceID: current.workspaceID,
    })
  }

  const statusTitle = () => {
    if (status() === "loading") return "Preparing chat relay"
    if (status() === "error") return "Relay unavailable"
    return "Block needs a chat relay binding"
  }

  const statusNote = () => {
    if (status() === "loading") return "Creating or loading the chat relay session for this block."
    if (status() === "error") return "The chat relay binding failed. Retry initialization."
    return "This block relays to your chat account and cannot route until a session is bound."
  }

  const statusIcon = () => {
    if (status() === "loading") return iconSpin()
    if (status() === "error") return iconClose()
    return iconRelay()
  }

  return (
    <div class="canvas-relay-layout">
      <Show when={networkDenied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">Permission denied</div>
          <div class="canvas-relay-state-note">
            The project config denies network access (webfetch/websearch). Edit the project config to allow it.
          </div>
        </div>
      </Show>
      <Show when={!networkDenied() && status() !== "ready"}>
        <div class="canvas-relay-state" classList={{ error: status() === "error" }}>
          <Show
            when={status() === "loading"}
            fallback={
              <div class="canvas-relay-state-icon" aria-hidden="true">
                {statusIcon()}
              </div>
            }
          >
            <div class="canvas-relay-spinner" aria-hidden="true">
              {statusIcon()}
            </div>
          </Show>
          <div class="canvas-relay-state-title">{statusTitle()}</div>
          <div class="canvas-relay-state-note">{statusNote()}</div>
          <Show when={status() === "error"}>
            <button type="button" class="canvas-relay-init-button" onClick={() => void ensureBinding()}>
              Retry
            </button>
          </Show>
        </div>
      </Show>
      <Show when={!networkDenied() && status() === "ready"}>
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurfaceProviders directory={options().target.directory}>
              <CanvasSessionSurface
                target={options().target}
                surfaceID={`chat-relay-${props.block.id}`}
                focused={props.focused}
                onFocus={props.onFocus}
                queueEnabled={options().queueEnabled}
              />
            </CanvasSessionSurfaceProviders>
          )}
        </Show>
      </Show>
    </div>
  )
}

export function ChatRelayBody(props: ChatRelayBodyProps): JSX.Element {
  if (parseRuntimeV2()) {
    return <RuntimeChatRelayBody {...props} />
  }
  return <LegacyChatRelayBody {...props} />
}
