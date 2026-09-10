import { Global } from "@opencode-ai/core/global"
import { ChatProxy } from "@opencode-ai/schema/chat-proxy"
import { Schema } from "effect"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createConnection } from "node:net"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const Reply = Schema.Union([
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(false), error: Schema.String }),
])
const requests = new Map<string, Pending>()
const state: { worker?: ReturnType<typeof startWorker> } = {}
const restored = new Map<string, Promise<unknown>>()

export const ChatProxyService = {
  async status(user: string) {
    await restore(user)
    if (!state.worker && process.env.OPENCODE_CHAT_PROXY_SOCKET) state.worker = startWorker()
    if (!state.worker) return new ChatProxy.Provider({ id: "chatgpt", name: "ChatGPT", status: "disconnected" })
    return provider("status", user)
  },
  connect: (user: string) => provider("connect", user),
  open: (user: string) => provider("open", user),
  relay: (user: string, workspaceID: string, blockID: string) => relay("relay", user, workspaceID, blockID),
  ensure: (user: string, workspaceID: string, blockID: string) => relay("ensure", user, workspaceID, blockID),
  reset: (user: string, workspaceID: string, blockID: string, tabID?: string) =>
    relay("reset", user, workspaceID, blockID, { tabID }),
  prompt: (
    user: string,
    workspaceID: string,
    blockID: string,
    tabID: string,
    messageID: string,
    text: string,
    browserText?: string,
  ) => relay("prompt", user, workspaceID, blockID, { tabID, messageID, text, browserText }),
  openRelay: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("openRelay", user, workspaceID, blockID, { tabID }),
  options: (user: string, workspaceID: string, blockID: string, tabID: string) =>
    relay("options", user, workspaceID, blockID, { tabID }),
  configure: (user: string, workspaceID: string, blockID: string, tabID: string, model?: string, effort?: string) =>
    relay("configure", user, workspaceID, blockID, { tabID, model, effort }),
  close: (user: string, workspaceID: string, blockID: string) => cleanup("close", { user, workspaceID, blockID }),
  closeWorkspace: (user: string, workspaceID: string) => cleanup("closeWorkspace", { user, workspaceID }),
}

async function provider(method: string, user: string) {
  const value = Schema.decodeUnknownSync(ChatProxy.Provider)(
    await request(method, { user, profile: profileDirectory(user) }),
  )
  if ((method === "connect" || method === "open" || value.status === "ready") && value.status !== "error") {
    const profile = profileDirectory(user)
    if (!existsSync(path.join(profile, "connection.json"))) {
      await mkdir(profile, { recursive: true })
      await writeFile(path.join(profile, "connection.json"), JSON.stringify({ enabled: true }))
    }
  }
  return value
}

async function relay(
  method: "relay" | "ensure" | "reset" | "prompt" | "openRelay" | "options" | "configure",
  user: string,
  workspaceID: string,
  blockID: string,
  payload = {},
) {
  if (method === "ensure" || method === "relay" || method === "reset") await restore(user)
  if (!state.worker) {
    if (method === "prompt" || method === "openRelay" || method === "options" || method === "configure")
      return Promise.reject(new Error("Connect ChatGPT in Settings before using this chat tab."))
    return Promise.resolve(
      Schema.decodeUnknownSync(ChatProxy.Relay)({
        providerID: "chatgpt",
        workspaceID,
        blockID,
        status: "disconnected",
        messages: [],
      }),
    )
  }
  return request(method, { user, workspaceID, blockID, profile: profileDirectory(user), ...payload }).then(
    Schema.decodeUnknownSync(ChatProxy.Relay),
  )
}

function restore(user: string) {
  const current = restored.get(user)
  if (current) return current
  const profile = profileDirectory(user)
  // Preferences also recognizes dedicated profiles created before connection intent was persisted.
  if (!existsSync(path.join(profile, "connection.json")) && !existsSync(path.join(profile, "Default", "Preferences")))
    return
  const pending = provider("restore", user).finally(() => {
    if (restored.get(user) === pending) restored.delete(user)
  })
  restored.set(user, pending)
  return pending
}

function cleanup(method: "close" | "closeWorkspace", payload: Record<string, unknown>) {
  const worker = state.worker ?? (process.env.OPENCODE_CHAT_PROXY_SOCKET ? (state.worker = startWorker()) : undefined)
  if (!worker || worker.exitCode !== null) return Promise.resolve()
  return request(method, payload, worker).then(() => undefined)
}

function request(method: string, payload: Record<string, unknown>, worker = (state.worker ??= startWorker())) {
  if (worker.exitCode !== null) return Promise.reject(new Error("ChatGPT browser worker is not running"))
  const id = randomUUID()
  return new Promise<unknown>((resolve, reject) => {
    requests.set(id, {
      resolve,
      reject,
      timeout: setTimeout(() => {
        requests.delete(id)
        reject(new Error("ChatGPT browser request timed out. Open its tab to check before sending again."))
      }, 90_000),
    })
    try {
      worker.input.write(`${JSON.stringify({ id, method, ...payload })}\n`, (error?: Error | null) => {
        if (error) finish(id, new Error("Could not contact the ChatGPT browser worker"))
      })
    } catch {
      finish(id, new Error("Could not contact the ChatGPT browser worker"))
    }
  })
}

function startWorker() {
  const endpoint = process.env.OPENCODE_CHAT_PROXY_SOCKET
  const node =
    process.env.OPENCODE_CHAT_PROXY_NODE ??
    ("bun" in process.versions || "electron" in process.versions ? "node" : process.execPath)
  const packaged = path.join(path.dirname(process.execPath), "chat-relay", "chat-proxy-worker.mjs")
  const adjacent = fileURLToPath(new URL("./chat-proxy-worker.mjs", import.meta.url))
  const unpacked = adjacent.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  const script = existsSync(packaged) ? packaged : existsSync(unpacked) ? unpacked : adjacent
  if (!existsSync(script)) throw new Error("The ChatGPT browser runtime is missing from this installation")
  const worker = endpoint ? socketWorker(endpoint) : childWorker(node, script)
  const stop = () => worker.kill()
  const stopped = (error: Error) => {
    process.off("exit", stop)
    if (state.worker !== worker) return
    state.worker = undefined
    restored.clear()
    requests.forEach((_, id) => finish(id, error))
  }
  process.once("exit", stop)
  worker.once("error", () => {
    stopped(new Error("ChatGPT browser worker could not start. Install Node.js and Microsoft Edge."))
  })
  worker.input.on("error", () => {
    stopped(new Error("Could not contact the ChatGPT browser worker"))
    worker.kill()
  })
  worker.once("close", () => {
    stopped(new Error("ChatGPT browser worker stopped. Reconnect ChatGPT in Settings to continue."))
  })
  void readWorker(worker.output).catch(() => {
    if (state.worker !== worker) return
    stopped(new Error("ChatGPT browser worker returned an invalid response"))
    worker.kill()
  })
  return worker
}

function socketWorker(endpoint: string) {
  const socket = createConnection(endpoint)
  return {
    input: socket,
    output: socket,
    get exitCode() {
      return socket.destroyed ? 0 : null
    },
    kill: () => socket.destroy(),
    once: socket.once.bind(socket),
  }
}

function childWorker(node: string, script: string) {
  const child = spawn(node, [script], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  })
  return {
    input: child.stdin,
    output: child.stdout,
    get exitCode() {
      return child.exitCode
    },
    kill: () => child.kill(),
    once: child.once.bind(child),
  }
}

async function readWorker(stdout: NodeJS.ReadableStream) {
  const lines = createInterface({ input: stdout, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    if (!line) continue
    const reply = Schema.decodeUnknownSync(Reply)(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(line))
    const pending = requests.get(reply.id)
    if (!pending) continue
    clearTimeout(pending.timeout)
    requests.delete(reply.id)
    if (!reply.ok) {
      pending.reject(new Error(reply.error))
      continue
    }
    pending.resolve(reply.value)
  }
}

function finish(id: string, error: Error) {
  const pending = requests.get(id)
  if (!pending) return
  clearTimeout(pending.timeout)
  requests.delete(id)
  pending.reject(error)
}

function profileDirectory(user: string) {
  return path.join(Global.Path.data, "chat-relay-browser", createHash("sha256").update(user).digest("hex"))
}
