import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppRuntime } from "@/effect/app-runtime"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"

// Instances stay alive for the whole server process, so keep the warmup
// bounded: every warmed directory starts file watchers and its own bootstrap
// work (project copy refresh, config/agent/command registries).
const limit = 5

/**
 * Boots instances for directories this server is most likely to serve, so the
 * first request after a restart does not wait on instance bootstrap.
 *
 * Fire-and-forget: runs under the global AppRuntime and never blocks or fails
 * `Server.listen`.
 */
export function start() {
  return AppRuntime.runFork(warm())
}

const warm = Effect.fn("Server.warmup")(function* () {
  const flags = yield* RuntimeFlags.Service
  if (!flags.warmup) return

  const fs = yield* FSUtil.Service
  const project = yield* Project.Service
  const store = yield* InstanceStore.Service

  const projects = (yield* project.list()).filter((item) => item.worktree !== "/")
  // The server usually runs from inside the project it serves in development;
  // only warm that directory when it belongs to a known project so a packaged
  // server never bootstraps its own install directory.
  const cwd = process.cwd()
  const directories = [
    ...(projects.some((item) => FSUtil.contains(item.worktree, cwd)) ? [cwd] : []),
    ...projects
      .sort((a, b) => b.time.updated - a.time.updated)
      .flatMap((item) => [item.worktree, ...item.sandboxes]),
  ]
  const candidates = [...new Set(directories)].slice(0, limit)

  yield* Effect.logInfo("warming instances", { directories: candidates })
  yield* Effect.forEach(
    candidates,
    (directory) =>
      fs.existsSafe(directory).pipe(
        Effect.flatMap((exists) =>
          exists
            ? store.load({ directory }).pipe(
                Effect.tap(() => Effect.logInfo("warm instance ready", { directory })),
                Effect.catchCause((cause) => Effect.logWarning("warm instance failed", { directory, cause })),
              )
            : Effect.void,
        ),
      ),
    { concurrency: 1, discard: true },
  )
})

export * as Warmup from "./warmup"
