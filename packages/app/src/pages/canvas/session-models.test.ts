import { describe, expect, mock, test } from "bun:test"
import { prepareWorkspaceSession } from "./session-models"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  const state = {
    intent: 0,
    status: "ready" as "ready" | "error",
    sessionID: "ses_original",
    workspaceID: "wrk_original",
  }
  const manager = {
    modelIntent: () => state.intent,
    workspaceID: () => state.workspaceID,
    waitForModelSelection: mock(async () => {}),
  }
  const runtime = {
    status: () => state.status,
    view: () => ({ sessionID: state.sessionID }),
    error: () => undefined,
    refresh: mock(async (_reason?: string) => {}),
    dispatch: async () => {},
    dispose: () => {},
  }
  return { state, manager, runtime }
}

describe("workspace session model synchronization", () => {
  test("waits for model persistence and session refresh before admitting a prompt", async () => {
    const current = fixture()
    const saved = deferred()
    const refreshed = deferred()
    const refreshing = deferred()
    current.manager.waitForModelSelection.mockImplementation(() => saved.promise)
    current.runtime.refresh.mockImplementation(() => {
      refreshing.resolve()
      return refreshed.promise
    })
    let admitted = false
    const pending = prepareWorkspaceSession(current.manager, current.runtime, "ses_original", "Sync failed").then(
      () => {
        admitted = true
      },
    )
    expect(current.runtime.refresh).not.toHaveBeenCalled()
    saved.resolve()
    await refreshing.promise
    expect(current.runtime.refresh).toHaveBeenCalledWith("before-submit")
    expect(admitted).toBe(false)
    refreshed.resolve()
    await pending
    expect(admitted).toBe(true)
  })

  test("repeats synchronization if the selected model changes while refreshing", async () => {
    const current = fixture()
    current.runtime.refresh.mockImplementationOnce(async () => {
      current.state.intent++
    })
    await prepareWorkspaceSession(current.manager, current.runtime, "ses_original", "Sync failed")
    expect(current.runtime.refresh).toHaveBeenCalledTimes(2)
  })

  test("rejects a failed save without refreshing or admitting the prompt", async () => {
    const current = fixture()
    current.manager.waitForModelSelection.mockImplementation(async () => {
      throw new Error("Save failed")
    })
    await expect(
      prepareWorkspaceSession(current.manager, current.runtime, "ses_original", "Sync failed"),
    ).rejects.toThrow("Sync failed")
    expect(current.runtime.refresh).not.toHaveBeenCalled()
  })

  test.each(["failed", "replaced", "moved"])("rejects when the bound session is %s", async (outcome) => {
    const current = fixture()
    current.runtime.refresh.mockImplementation(async () => {
      if (outcome === "failed") current.state.status = "error"
      if (outcome === "replaced") current.state.sessionID = "ses_replacement"
      if (outcome === "moved") current.state.workspaceID = "wrk_replacement"
    })
    await expect(
      prepareWorkspaceSession(current.manager, current.runtime, "ses_original", "Sync failed"),
    ).rejects.toThrow("Sync failed")
  })
})
