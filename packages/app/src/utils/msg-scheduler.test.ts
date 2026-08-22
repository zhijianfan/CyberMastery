import { describe, expect, test } from "bun:test"
import { createMsgScheduler, type MsgSchedulerAction } from "./msg-scheduler"

describe("MsgScheduler", () => {
  test("delegates steer and queue without local scheduling", async () => {
    const calls: Array<{ message: string; delivery: "steer" | "queue" }> = []
    const scheduler = createMsgScheduler<string>({
      send: async (message, delivery) => {
        calls.push({ message, delivery })
        return true
      },
      interrupt: async () => undefined,
      onRejected: () => undefined,
    })

    expect(await scheduler.steer("first")).toBe(true)
    expect(await scheduler.queue("second")).toBe(true)
    expect(calls).toEqual([
      { message: "first", delivery: "steer" },
      { message: "second", delivery: "queue" },
    ])
  })

  test("preserves a resolved false send result", async () => {
    const scheduler = createMsgScheduler<string>({
      send: async () => false,
      interrupt: async () => undefined,
      onRejected: () => undefined,
    })

    expect(await scheduler.steer("ignored")).toBe(false)
  })

  test("delegates interrupt once", async () => {
    let calls = 0
    const scheduler = createMsgScheduler<string>({
      send: async () => true,
      interrupt: async () => {
        calls++
      },
      onRejected: () => undefined,
    })

    expect(await scheduler.interrupt()).toBe(true)
    expect(calls).toBe(1)
  })

  test("reports the original server rejection for every action", async () => {
    const errors = {
      steer: new Error("steer-invalid"),
      queue: new Error("queue-invalid"),
      interrupt: new Error("interrupt-invalid"),
    }
    const rejected: Array<{ action: MsgSchedulerAction; error: unknown }> = []
    const scheduler = createMsgScheduler<string>({
      send: async (_message, delivery) => {
        throw errors[delivery]
      },
      interrupt: async () => {
        throw errors.interrupt
      },
      onRejected: (action, error) => rejected.push({ action, error }),
    })

    expect(await scheduler.steer("first")).toBe(false)
    expect(await scheduler.queue("second")).toBe(false)
    expect(await scheduler.interrupt()).toBe(false)
    expect(rejected).toEqual([
      { action: "steer", error: errors.steer },
      { action: "queue", error: errors.queue },
      { action: "interrupt", error: errors.interrupt },
    ])
  })
})
