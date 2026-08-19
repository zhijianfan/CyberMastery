import { For, onCleanup, onMount, type JSX, createEffect, createSignal, Show } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { createMasterAgentSessionOptions } from "../../master-agent/session-options"
import { CanvasSessionSurface } from "../../session-surface"
import { permissionDenied } from "../../permissions"
import {
  ChatRelayRuntimeAdapter,
  createMockChatRelayContext,
  type ChatRelayRuntimeContext,
  type ChatRelayRuntimeView,
} from "./runtime"
import type { ChatRelayBodyProps, ChatRelayCommand, RuntimeResourceState, RuntimeSnapshot } from "./types"

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

function parseNumberCursor(cursor: string): number {
  const value = Number.parseInt(cursor, 10)
  return Number.isNaN(value) ? 0 : value
}

function parseRuntimeV2(): boolean {
  // Legacy path is the safe default (plan §H fallback policy). The block
  // runtime path activates only when the flag is explicitly set — the
  // integration layer flips it after wiring a real runtime context.
  const value = (globalThis as { __CHAT_RELAY_RUNTIME_V2__?: unknown }).__CHAT_RELAY_RUNTIME_V2__
  return value === true || value === "true" || value === 1 || value === "1"
}

interface RuntimeDescriptor {
  functionalityID: "builtin:chat-relay"
  id: string
  bindings: { sessionID?: string }
  layout: {
    x: number
    y: number
    width: number
    height: number
  }
}

function createRuntimeDescriptor(props: ChatRelayBodyProps): RuntimeDescriptor {
  return {
    functionalityID: "builtin:chat-relay",
    id: props.block.id,
    bindings: { sessionID: props.block.bindings?.sessionID },
    layout: { x: 0, y: 0, width: 0, height: 0 },
  }
}

function runtimeToState(snapshot: RuntimeSnapshot<RuntimeResourceState>, descriptor: RuntimeDescriptor) {
  return ChatRelayRuntimeAdapter.select(descriptor, snapshot.state)
}

function runtimeStateFromContext(context: ChatRelayRuntimeContext, descriptor: RuntimeDescriptor) {
  const initialState = (context as { state?: RuntimeResourceState }).state
  if (!initialState) {
    return {
      connectionStatus: "disconnected" as const,
      messages: [],
      pendingPermissions: [],
      errors: [],
    }
  }

  return runtimeToState(
    {
      cursor: "0",
      state: initialState,
    },
    descriptor,
  )
}

function getRuntimeContext(): ChatRelayRuntimeContext {
  const globalRuntimeContext = (globalThis as {
    __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext)
    window?: {
      __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext)
    }
  }).__CHAT_RELAY_RUNTIME_CONTEXT__
  const windowRuntimeContext =
    (globalThis as { window?: { __CHAT_RELAY_RUNTIME_CONTEXT__?: ChatRelayRuntimeContext | (() => ChatRelayRuntimeContext) } }).window
      ?.
      __CHAT_RELAY_RUNTIME_CONTEXT__

  const provided = globalRuntimeContext ?? windowRuntimeContext
  return typeof provided === "function" ? provided() : provided || createMockChatRelayContext()
}

function RuntimeChatRelayBody(props: ChatRelayBodyProps) {
  const [cursor, setCursor] = createSignal("0")
  const [error, setError] = createSignal<string>()
  const [promptText, setPromptText] = createSignal("")
  const [isSubmitting, setSubmitting] = createSignal(false)
  const initialContext = getRuntimeContext()
  let context: ChatRelayRuntimeContext | undefined
  context = initialContext
  const [runtimeState, setRuntimeState] = createSignal<ChatRelayRuntimeView>({
    ...runtimeStateFromContext(initialContext, createRuntimeDescriptor(props)),
  })

  const networkDenied = () =>
    permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")
  let unsubscribe: (() => void) | undefined

  const descriptor = createRuntimeDescriptor(props)
  const bindings = ChatRelayRuntimeAdapter.getBindings(descriptor)

  const applySnapshot = (snapshot: RuntimeSnapshot<RuntimeResourceState>) => {
    setCursor(snapshot.cursor)
    setRuntimeState(runtimeToState(snapshot, descriptor))
  }

  const refresh = async () => {
    if (!context) return
    const snapshot = await context.snapshot(bindings)
    applySnapshot(snapshot)
  }

  const dispatchCommand = async (command: ChatRelayCommand) => {
    if (!context) return
    await ChatRelayRuntimeAdapter.dispatch(descriptor, command, context)
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

onMount(() => {
    if (networkDenied()) return
    void refresh().then(async () => {
      const baseline = cursor()
      unsubscribe = context?.subscribe(bindings, baseline, async (event) => {
        if (parseNumberCursor(event.cursor) <= parseNumberCursor(cursor())) return
        const snapshot = await context?.snapshot(bindings)
        if (!snapshot) return
        applySnapshot(snapshot)
      })

      await context?.snapshot(bindings)
    })
  })

  onCleanup(() => {
    unsubscribe?.()
  })

  createEffect(() => {
    const nextError = runtimeState().errors.at(0)
    if (nextError) {
      setError(nextError)
    }
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
      <Show when={!networkDenied() && runtimeState().auth?.status === "awaiting-login"}>
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
      <Show when={!networkDenied() && runtimeState().auth?.status !== "awaiting-login"}>
        <Show when={runtimeState().connectionStatus === "disconnected"}>
          <div class="canvas-relay-banner">Disconnected from relay</div>
        </Show>
        <Show when={error()}>
          <div class="canvas-relay-error">{error()}</div>
        </Show>
          <For each={runtimeState().messages}>
            {(message) => <div class="canvas-relay-message-text">{message.text}</div>}
          </For>
          <Show when={runtimeState().pendingPermissions.length > 0}>
            <div class="canvas-relay-permission-panel" data-testid="chat-relay-permissions">
              <For each={runtimeState().pendingPermissions}>
              {(permission) => (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchCommand({ type: "permission.respond", requestID: permission.requestID, response: "allow-once" })
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
                    onClick={() => void dispatchCommand({ type: "permission.respond", requestID: permission.requestID, response: "deny" })}
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
            <CanvasSessionSurface
              target={options().target}
              surfaceID={`chat-relay-${props.block.id}`}
              focused={props.focused}
              onFocus={props.onFocus}
              queueEnabled={options().queueEnabled}
            />
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
