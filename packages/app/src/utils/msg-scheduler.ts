export type MsgSchedulerAction = "steer" | "queue" | "interrupt"

export type MsgScheduler<Message> = {
  steer(message: Message): Promise<boolean>
  queue(message: Message): Promise<boolean>
  interrupt(): Promise<boolean>
}

export function createMsgScheduler<Message>(input: {
  send(message: Message, delivery: "steer" | "queue"): Promise<boolean>
  interrupt(): Promise<void>
  onRejected(action: MsgSchedulerAction, error: unknown): void
}): MsgScheduler<Message> {
  const run = async (action: MsgSchedulerAction, request: () => Promise<boolean>) => {
    try {
      return await request()
    } catch (error) {
      input.onRejected(action, error)
      return false
    }
  }

  return {
    steer: (message) => run("steer", () => input.send(message, "steer")),
    queue: (message) => run("queue", () => input.send(message, "queue")),
    interrupt: () =>
      run("interrupt", async () => {
        await input.interrupt()
        return true
      }),
  }
}
