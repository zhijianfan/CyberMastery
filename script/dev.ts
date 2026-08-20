import path from "node:path"
import { Process } from "../packages/opencode/src/util/process"

const cwd = path.join(import.meta.dir, "..")
const backend = Process.spawn(["bun", "run", "dev:backend"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
})
const interrupted = new Promise<number>((resolve) => {
  process.once("SIGINT", () => resolve(0))
  process.once("SIGTERM", () => resolve(0))
})

const code = await Promise.race([backend.exited, interrupted]).finally(() => Process.stop(backend))
process.exit(code)
