import { existsSync, watch } from "node:fs"
import { randomUUID } from "node:crypto"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.join(import.meta.dir, "..")
const state: {
  backend?: Bun.Subprocess
  frontend?: Bun.Subprocess
  worker?: Bun.Subprocess
  stopping?: boolean
} = {}
const workerSocket =
  process.platform === "win32"
    ? `\\\\.\\pipe\\opencode-chat-proxy-${process.pid}-${randomUUID()}`
    : path.join(tmpdir(), `opencode-chat-proxy-${process.pid}-${randomUUID()}.sock`)
const sources = [
  "packages/opencode/src",
  "packages/server/src",
  "packages/core/src",
  "packages/protocol/src",
  "packages/schema/src",
  "packages/relay/src",
  "packages/llm/src",
  "packages/tui/src",
  "packages/sdk/js/src",
  "packages/effect-drizzle-sqlite/src",
]

function startBackend() {
  state.backend = Bun.spawn(
    [process.execPath, "run", "--conditions=browser", "./src/index.ts", ...process.argv.slice(2)],
    {
      cwd: path.join(root, "packages/opencode"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        OPENCODE_WEB_UI_URL: "http://127.0.0.1:3155",
        OPENCODE_CHAT_PROXY_SOCKET: workerSocket,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
}

function startWorker() {
  const worker = Bun.spawn(
    [
      process.env.OPENCODE_CHAT_PROXY_NODE ?? "node",
      path.join(root, "packages/server/src/chat-proxy-worker.mjs"),
      "--socket",
      workerSocket,
    ],
    {
      cwd: root,
      env: process.env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  state.worker = worker
  void worker.exited
    .then(async (code) => {
      if (state.worker !== worker || state.stopping) return
      state.worker = undefined
      console.error(`[dev] ChatRelay browser worker exited with code ${code}; restarting`)
      await Bun.sleep(250)
      if (state.stopping || state.worker) return
      startWorker()
      await waitForWorker()
    })
    .catch((cause) => console.error(`[dev] ChatRelay browser worker restart failed: ${cause}`))
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection(workerSocket)
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
    })
    if (connected) return
    await Bun.sleep(50)
  }
  throw new Error("ChatRelay browser worker did not start")
}

async function stopWorker() {
  const worker = state.worker
  if (!worker) return
  state.worker = undefined
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(workerSocket)
    let output = ""
    socket.setEncoding("utf8")
    socket.setTimeout(2_000, () => {
      socket.destroy()
      reject(new Error("ChatRelay browser worker shutdown timed out"))
    })
    socket.once("error", reject)
    socket.on("data", (chunk) => {
      output += chunk
      if (!output.includes("\n")) return
      socket.destroy()
      resolve()
    })
    socket.once("connect", () => socket.write(`${JSON.stringify({ id: randomUUID(), method: "shutdown" })}\n`))
  }).catch(() => undefined)
  worker.kill()
  await worker.exited
}

export function createRestartQueue(
  restart: (request: { file: string; worker: boolean }) => Promise<void>,
  delay = 120,
  onError?: (cause: unknown) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { file: string; worker: boolean } | undefined
  let running = Promise.resolve()
  const enqueue = () => {
    if (!pending) return
    const request = pending
    pending = undefined
    running = running.catch(() => undefined).then(() => restart(request))
    if (onError) void running.catch(onError)
  }
  return {
    schedule(file: string) {
      pending = {
        file,
        worker:
          (pending?.worker ?? false) ||
          file.replaceAll("\\", "/").endsWith("packages/server/src/chat-proxy-worker.mjs"),
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        enqueue()
      }, delay)
    },
    flush() {
      clearTimeout(timer)
      timer = undefined
      enqueue()
      return running
    },
    clear() {
      clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}

const restarts = createRestartQueue(
  async ({ file, worker }) => {
    const child = state.backend
    console.log(`\n[dev] restarting backend after ${file}`)
    if (child) {
      child.kill()
      await child.exited
    }
    if (state.stopping) return
    if (worker) {
      await stopWorker()
      if (state.stopping) return
      startWorker()
      await waitForWorker()
    }
    if (!state.stopping) startBackend()
  },
  120,
  (cause) => console.error(`[dev] Backend restart failed: ${String(cause)}`),
)

function schedule(file: string) {
  if (!state.stopping) restarts.schedule(file)
}

async function main() {
  const watchers = sources
    .map((directory) => path.join(root, directory))
    .filter(existsSync)
    .map((directory) =>
      watch(directory, { recursive: true }, (_, file) => {
        if (file) schedule(path.relative(root, path.join(directory, file.toString())))
      }),
    )

  state.frontend = Bun.spawn([process.execPath, "run", "dev"], {
    cwd: path.join(root, "packages/app"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      VITE_DEV_SERVER_PORT: "3155",
      VITE_OPENCODE_SERVER_HOST: "localhost",
      VITE_OPENCODE_SERVER_PORT: "3154",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  startWorker()
  await waitForWorker()
  startBackend()

  await new Promise<void>((resolve) => {
    const stop = () => {
      if (state.stopping) return
      state.stopping = true
      restarts.clear()
      watchers.forEach((watcher) => watcher.close())
      state.backend?.kill()
      state.frontend?.kill()
      void Promise.all([state.backend?.exited, state.frontend?.exited, stopWorker()]).then(() => resolve())
    }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })
}

if (import.meta.main) await main()
