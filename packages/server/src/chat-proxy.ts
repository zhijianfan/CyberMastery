import { Global } from "@opencode-ai/core/global"
import { ChatProxyMessage, ChatProxyProvider, ChatProxyRelay } from "@opencode-ai/protocol/groups/chat-proxy"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"

type ProviderResult = {
  id: "chatgpt"
  name: string
  status: "disconnected" | "opening" | "login-required" | "ready" | "error"
  error?: string
}

type MessageResult = {
  id: string
  role: "user" | "assistant" | "error"
  text: string
  createdAt: number
}

type RelayResult = {
  providerID: "chatgpt"
  relayID: string
  status: "disconnected" | "opening" | "login-required" | "idle" | "thinking" | "error"
  messages: MessageResult[]
  configuration?: {
    model?: string
    effort?: string
    models: string[]
    efforts: string[]
  }
  error?: string
}

type WorkerReply =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: string }

type PendingRequest = {
  resolve(value: unknown): void
  reject(cause: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const requests = new Map<string, PendingRequest>()
const node = process.env.OPENCODE_CHAT_PROXY_NODE ?? Bun.which("node")
const worker = node
  ? Bun.spawn([node, path.join(import.meta.dir, "chat-proxy-worker.mjs")], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      windowsHide: true,
    })
  : undefined

if (worker) {
  void readWorker()
  void worker.exited.then((code) => failRequests(`Chat Proxy browser worker exited with code ${code}`))
  process.on("exit", () => worker.kill())
}

export const ChatProxyService = {
  async list(user: string) {
    return [toProvider(await requestWorker<ProviderResult>("status", { user }))]
  },
  async connect(user: string) {
    return toProvider(await requestWorker<ProviderResult>("connect", { user, profile: profileDirectory(user) }))
  },
  async open(user: string) {
    return toProvider(await requestWorker<ProviderResult>("open", { user, profile: profileDirectory(user) }))
  },
  async disconnect(user: string) {
    return toProvider(await requestWorker<ProviderResult>("disconnect", { user }))
  },
  async relay(user: string, relayID: string) {
    return toRelay(await requestWorker<RelayResult>("relay", { user, relayID }))
  },
  async prompt(user: string, relayID: string, text: string, model?: string, effort?: string) {
    return toRelay(
      await requestWorker<RelayResult>("prompt", {
        user,
        relayID,
        text,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      }),
    )
  },
}

function requestWorker<A>(method: string, payload: Record<string, string>) {
  if (!worker) {
    return Promise.reject(
      new Error("Chat Proxy needs Node.js because Playwright browser control cannot run inside Bun on Windows"),
    )
  }
  if (worker.exitCode !== null) return Promise.reject(new Error("Chat Proxy browser worker is not running"))

  const id = randomUUID()
  return new Promise<A>((resolve, reject) => {
    requests.set(id, {
      resolve: (value) => resolve(value as A),
      reject,
      timeout: setTimeout(() => {
        requests.delete(id)
        reject(new Error(`Chat Proxy browser worker did not complete ${method} within 75 seconds`))
      }, 75_000),
    })
    worker.stdin.write(`${JSON.stringify({ id, method, ...payload })}\n`)
    worker.stdin.flush()
  })
}

async function readWorker() {
  if (!worker) return
  const reader = worker.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    lines.filter(Boolean).forEach(handleReply)
  }
}

function handleReply(line: string) {
  const reply = JSON.parse(line) as WorkerReply
  const pending = requests.get(reply.id)
  if (!pending) return
  requests.delete(reply.id)
  clearTimeout(pending.timeout)
  if (reply.ok) {
    pending.resolve(reply.value)
    return
  }
  pending.reject(new Error(reply.error))
}

function failRequests(message: string) {
  requests.forEach((pending) => {
    clearTimeout(pending.timeout)
    pending.reject(new Error(message))
  })
  requests.clear()
}

function toProvider(value: ProviderResult) {
  return new ChatProxyProvider(value)
}

function toRelay(value: RelayResult) {
  return new ChatProxyRelay({
    ...value,
    messages: value.messages.map((message) => new ChatProxyMessage(message)),
  })
}

function profileDirectory(user: string) {
  return path.join(
    Global.Path.data,
    "chat-proxy",
    "chatgpt",
    "edge",
    createHash("sha256").update(user).digest("hex").slice(0, 24),
  )
}
