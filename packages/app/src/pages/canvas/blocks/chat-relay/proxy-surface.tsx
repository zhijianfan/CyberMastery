import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import "./proxy-surface.css"

type Message = {
  id: string
  role: "user" | "assistant" | "error"
  text: string
  createdAt: number
}

type Configuration = {
  model?: string
  effort?: string
  models: string[]
  efforts: string[]
}

type Relay = {
  providerID: "chatgpt"
  relayID: string
  status: "disconnected" | "opening" | "login-required" | "idle" | "thinking" | "error"
  messages: Message[]
  configuration?: Configuration
  error?: string
}

export function ChatProxyRelaySurface(props: { relayID: string }) {
  const server = useServerSDK()
  const [relay, setRelay] = createSignal<Relay>({
    providerID: "chatgpt",
    relayID: props.relayID,
    status: "disconnected",
    messages: [],
  })
  const [draft, setDraft] = createSignal("")
  const [model, setModel] = createSignal("")
  const [effort, setEffort] = createSignal("")
  const [requestError, setRequestError] = createSignal<string>()
  const [sending, setSending] = createSignal(false)
  let transcript!: HTMLDivElement
  let selector!: HTMLDetailsElement
  const endpoint = () =>
    new URL(`/api/chat-proxy/chatgpt/relay/${encodeURIComponent(props.relayID)}`, server().url).toString()
  const modelStorageKey = `chat-proxy-model:${props.relayID}`
  const effortStorageKey = `chat-proxy-effort:${props.relayID}`

  const refresh = () =>
    request<Relay>(endpoint())
      .then((value) => {
        setRelay(value)
        setRequestError(undefined)
      })
      .catch((cause) => setRequestError(errorMessage(cause)))

  onMount(() => {
    setModel(window.localStorage.getItem(modelStorageKey) ?? "")
    setEffort(window.localStorage.getItem(effortStorageKey) ?? "")
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const configuration = relay().configuration
    if (!configuration) return
    setModel((current) =>
      current && configuration.models.includes(current) ? current : configuration.model ?? configuration.models[0] ?? "",
    )
    setEffort((current) =>
      current && configuration.efforts.includes(current)
        ? current
        : configuration.effort ?? configuration.efforts[0] ?? "",
    )
  })

  createEffect(() => {
    relay().messages.map((message) => message.text).join("")
    queueMicrotask(() => {
      transcript.scrollTop = transcript.scrollHeight
    })
  })

  const send = () => {
    const text = draft().trim()
    if (!text || sending() || !canSend(relay())) return
    setDraft("")
    setSending(true)
    setRequestError(undefined)
    setRelay((current) => ({
      ...current,
      status: "thinking",
      messages: [...current.messages, { id: `client-${Date.now()}`, role: "user", text, createdAt: Date.now() }],
    }))
    void request<Relay>(`${endpoint()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model: model().trim() || undefined,
        effort: effort().trim() || undefined,
      }),
    })
      .then(setRelay)
      .catch((cause) => {
        const message = errorMessage(cause)
        setRequestError(message)
        setRelay((current) => ({
          ...current,
          status: "error",
          error: message,
          messages: [...current.messages, { id: `error-${Date.now()}`, role: "error", text: message, createdAt: Date.now() }],
        }))
      })
      .finally(() => setSending(false))
  }

  return (
    <section
      class="chat-proxy-relay"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header class="chat-proxy-relay__header">
        <div>
          <strong>ChatGPT</strong>
          <span>Browser proxy</span>
        </div>
        <details ref={selector} class="chat-proxy-relay__configuration">
          <summary aria-label="Select ChatGPT model and effort">
            <span>{model() || relay().configuration?.model || "Current model"}</span>
            <small>{effort() || relay().configuration?.effort || "Web default"}</small>
          </summary>
          <div class="chat-proxy-relay__configuration-menu">
            <div class="chat-proxy-relay__configuration-label">Model</div>
            <For each={relay().configuration?.models ?? []}>
              {(option) => (
                <button
                  type="button"
                  classList={{ "chat-proxy-relay__configuration-option--selected": option === model() }}
                  onClick={() => {
                    setModel(option)
                    window.localStorage.setItem(modelStorageKey, option)
                    if (!relay().configuration?.efforts.length) selector.open = false
                  }}
                >
                  {option}
                </button>
              )}
            </For>
            <Show when={!relay().configuration?.models.length}>
              <p>No model choices exposed by the webpage.</p>
            </Show>
            <div class="chat-proxy-relay__configuration-label">Effort</div>
            <For each={relay().configuration?.efforts ?? []}>
              {(option) => (
                <button
                  type="button"
                  classList={{ "chat-proxy-relay__configuration-option--selected": option === effort() }}
                  onClick={() => {
                    setEffort(option)
                    window.localStorage.setItem(effortStorageKey, option)
                    selector.open = false
                  }}
                >
                  {option}
                </button>
              )}
            </For>
            <Show when={!relay().configuration?.efforts.length}>
              <p>No effort choices exposed for this model.</p>
            </Show>
          </div>
        </details>
        <span class={`chat-proxy-relay__status chat-proxy-relay__status--${relay().status}`}>
          {statusLabel(relay().status)}
        </span>
      </header>

      <div ref={transcript} class="chat-proxy-relay__transcript">
        <Show when={relay().messages.length === 0}>
          <div class="chat-proxy-relay__empty">
            <strong>{emptyTitle(relay().status)}</strong>
            <span>{emptyCopy(relay().status)}</span>
          </div>
        </Show>
        <For each={relay().messages}>
          {(message) => (
            <Show when={message.text}>
              <article class={`chat-proxy-relay__message chat-proxy-relay__message--${message.role}`}>
                <div>{message.role === "assistant" ? "ChatGPT" : message.role === "user" ? "You" : "Delivery error"}</div>
                <p>{message.text}</p>
              </article>
            </Show>
          )}
        </For>
        <Show when={relay().status === "thinking"}>
          <div class="chat-proxy-relay__thinking"><i /><i /><i /><span>ChatGPT is responding</span></div>
        </Show>
      </div>

      <Show when={requestError() ?? relay().error}>
        {(message) => <div class="chat-proxy-relay__error">{message()}</div>}
      </Show>

      <footer class="chat-proxy-relay__composer">
        <textarea
          value={draft()}
          disabled={!canSend(relay())}
          placeholder={canSend(relay()) ? "Message ChatGPT through the connected browser" : "Connect ChatGPT in Settings first"}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return
            event.preventDefault()
            send()
          }}
        />
        <button disabled={!draft().trim() || sending() || !canSend(relay())} onClick={send}>Send</button>
      </footer>
    </section>
  )
}

function canSend(relay: Relay) {
  return relay.status === "idle" || (relay.status === "error" && relay.messages.some((message) => message.role === "user"))
}

function statusLabel(status: Relay["status"]) {
  if (status === "login-required") return "Login required"
  if (status === "thinking") return "Thinking"
  if (status === "idle") return "Ready"
  if (status === "opening") return "Opening"
  if (status === "error") return "Error"
  return "Not connected"
}

function emptyTitle(status: Relay["status"]) {
  if (status === "idle") return "Relay ready"
  if (status === "login-required") return "Finish signing in"
  if (status === "opening") return "Opening Edge"
  if (status === "error") return "Proxy unavailable"
  return "Connect ChatGPT"
}

function emptyCopy(status: Relay["status"]) {
  if (status === "idle") return "Messages sent here are typed into the dedicated ChatGPT tab and visible replies return here."
  if (status === "login-required") return "Use Settings > Providers > Chat Proxy to open the browser and complete login."
  if (status === "opening") return "The backend is preparing your persistent browser profile."
  if (status === "error") return "Open Chat Proxy settings for the browser error and reconnect."
  return "Open Settings > Providers > Chat Proxy, then connect the ChatGPT webpage."
}

async function request<A>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = responseMessage(payload) ?? `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return payload as A
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function responseMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  if ("message" in payload && typeof payload.message === "string") return payload.message
  if ("data" in payload && payload.data && typeof payload.data === "object" && "message" in payload.data) {
    if (typeof payload.data.message === "string") return payload.data.message
  }
}
