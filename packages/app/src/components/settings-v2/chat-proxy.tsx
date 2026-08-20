import { createResource, createSignal, onCleanup, Show } from "solid-js"
import "./chat-proxy.css"

type Provider = {
  id: "chatgpt"
  name: string
  status: "disconnected" | "opening" | "login-required" | "ready" | "error"
  error?: string
}

const fallback: Provider = { id: "chatgpt", name: "ChatGPT", status: "disconnected" }

export function SettingsChatProxyV2() {
  const [failure, setFailure] = createSignal<string>()
  const [action, setAction] = createSignal<string>()
  const [providers, { refetch }] = createResource(() =>
    request<Provider[]>("/api/chat-proxy")
      .then((value) => {
        setFailure(undefined)
        return value
      })
      .catch((cause) => {
        setFailure(errorMessage(cause))
        return [fallback]
      }),
  )
  const provider = () => providers()?.[0] ?? fallback
  const timer = window.setInterval(() => void refetch(), 1_000)
  onCleanup(() => window.clearInterval(timer))

  const invoke = (operation: "connect" | "open" | "disconnect") => {
    setAction(operation)
    setFailure(undefined)
    const method = operation === "disconnect" ? "DELETE" : "POST"
    const suffix = operation === "disconnect" ? "" : `/${operation}`
    void request<Provider>(`/api/chat-proxy/chatgpt${suffix}`, { method })
      .then(() => refetch())
      .catch((cause) => setFailure(errorMessage(cause)))
      .finally(() => setAction(undefined))
  }

  return (
    <section class="chat-proxy-settings">
      <div class="chat-proxy-settings__heading">
        <div>
          <div class="chat-proxy-settings__eyebrow">Browser bridge</div>
          <h2>Chat Proxy</h2>
        </div>
        <span class={`chat-proxy-status chat-proxy-status--${provider().status}`}>{statusLabel(provider().status)}</span>
      </div>
      <p class="chat-proxy-settings__copy">
        Sign in inside a normal Microsoft Edge window. Passwords and cookies stay in its dedicated profile; close Edge
        after login to hand that profile back to the minimized ChatRelay browser.
      </p>
      <div class="chat-proxy-provider">
        <div class="chat-proxy-provider__mark">C</div>
        <div class="chat-proxy-provider__identity">
          <strong>{provider().name}</strong>
          <span>Uses the model, plan, and usage limits shown on chatgpt.com.</span>
        </div>
        <div class="chat-proxy-provider__actions">
          <Show when={provider().status === "disconnected" || provider().status === "error"}>
            <button disabled={!!action()} onClick={() => invoke("connect")}>Connect</button>
          </Show>
          <Show when={provider().status !== "disconnected" && provider().status !== "error"}>
            <button disabled={!!action()} onClick={() => invoke("open")}>Open Edge</button>
            <button class="chat-proxy-provider__secondary" disabled={!!action()} onClick={() => invoke("disconnect")}>
              Disconnect
            </button>
          </Show>
        </div>
      </div>
      <Show when={failure() ?? provider().error}>
        {(message) => <div class="chat-proxy-settings__error">{message()}</div>}
      </Show>
      <Show when={provider().status === "login-required"}>
        <div class="chat-proxy-settings__note">
          Finish signing in in Microsoft Edge, then close that window. Chat Proxy will continue in a minimized window.
        </div>
      </Show>
    </section>
  )
}

function statusLabel(status: Provider["status"]) {
  if (status === "login-required") return "Login required"
  if (status === "ready") return "Connected"
  if (status === "opening") return "Opening"
  if (status === "error") return "Needs attention"
  return "Disconnected"
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
