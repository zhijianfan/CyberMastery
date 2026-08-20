import { existsSync, watch } from "node:fs"
import path from "node:path"

const root = path.join(import.meta.dir, "..")
const state: {
  backend?: Bun.Subprocess
  frontend?: Bun.Subprocess
  timer?: ReturnType<typeof setTimeout>
  stopping?: boolean
} = {}
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
        OPENCODE_SERVER_PASSWORD: "",
        OPENCODE_SERVER_USERNAME: "default",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
}

function schedule(file: string) {
  if (state.stopping) return
  clearTimeout(state.timer)
  state.timer = setTimeout(async () => {
    const child = state.backend
    console.log(`\n[dev] restarting backend after ${file}`)
    if (child) {
      child.kill()
      await child.exited
    }
    if (!state.stopping) startBackend()
  }, 120)
}

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
startBackend()

await new Promise<void>((resolve) => {
  const stop = () => {
    if (state.stopping) return
    state.stopping = true
    clearTimeout(state.timer)
    watchers.forEach((watcher) => watcher.close())
    state.backend?.kill()
    state.frontend?.kill()
    resolve()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
})
