import { expect, test } from "bun:test"
import { createRestartQueue } from "../../../script/dev-backend"

test("serializes restarts and keeps a worker-source restart while coalescing watcher events", async () => {
  let active = 0
  let maximum = 0
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const entered = new Promise<void>((resolve) => (started = resolve))
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const calls: Array<{ file: string; worker: boolean }> = []
  const queue = createRestartQueue(async (request) => {
    calls.push(request)
    active += 1
    maximum = Math.max(maximum, active)
    if (calls.length === 1) {
      started?.()
      await blocked
    }
    active -= 1
  })

  queue.schedule("packages/core/src/first.ts")
  const first = queue.flush()
  await entered
  queue.schedule("packages/server/src/chat-proxy-worker.mjs")
  queue.schedule("packages/core/src/latest.ts")
  const second = queue.flush()

  expect(calls).toEqual([{ file: "packages/core/src/first.ts", worker: false }])
  expect(maximum).toBe(1)
  release?.()
  await Promise.all([first, second])
  expect(calls).toEqual([
    { file: "packages/core/src/first.ts", worker: false },
    { file: "packages/core/src/latest.ts", worker: true },
  ])
  expect(maximum).toBe(1)
})
