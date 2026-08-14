export type CaptureState = "streaming" | "quiet" | "complete" | "interrupted"

export interface CaptureMachine {
  state(): CaptureState
  push(delta: string): void
  tick(now: number): void
  stopButtonGone(now: number): void
}

export function createCaptureMachine(
  opts: { quietMs: number; timeoutMs: number },
  startedAt: number = Date.now(),
): CaptureMachine {
  let current: CaptureState = "streaming"
  let lastDeltaAt = startedAt

  return {
    state: () => current,
    push(delta: string) {
      if (current === "complete" || current === "interrupted") return
      void delta
      current = "streaming"
      lastDeltaAt = Date.now()
    },
    tick(now: number) {
      if (current === "complete" || current === "interrupted") return
      if (now - startedAt >= opts.timeoutMs) {
        current = "interrupted"
        return
      }
      if (current === "quiet" && now - lastDeltaAt >= opts.quietMs) {
        current = "complete"
        return
      }
      if (current === "streaming") current = "quiet"
    },
    stopButtonGone(now: number) {
      void now
      if (current === "complete" || current === "interrupted") return
      current = "complete"
    },
  }
}
