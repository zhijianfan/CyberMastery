import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createCoderController, type CoderControllerInput } from "./coder-controller"

interface Model {
  providerID: string
  modelID: string
}

const modelA: Model = { providerID: "provider", modelID: "a" }
const modelB: Model = { providerID: "provider", modelID: "b" }

interface PatchCall {
  workspaceID: string
  coderModel: Model | null
  signal: AbortSignal | undefined
}

interface Deferred {
  resolve: (result: { coderModel: Model | null }) => void
  reject: (cause: unknown) => void
  signal: AbortSignal | undefined
}

function createEnv(overrides: Partial<CoderControllerInput<Model>> = {}, initialServerModel: Model | null = null) {
  const [workspaceID, setWorkspaceID] = createSignal<string | undefined>("ws-1")
  const [serverModel, setServerModel] = createSignal<Model | null>(initialServerModel)
  const calls: PatchCall[] = []
  const deferred: Deferred[] = []
  const input: CoderControllerInput<Model> = {
    workspaceID,
    coderModel: serverModel,
    patchCoderModel: (id, coderModel, signal) => {
      calls.push({ workspaceID: id, coderModel, signal })
      return new Promise((resolve, reject) => deferred.push({ resolve, reject, signal }))
    },
    taskPermission: () => "allow",
    isModelAvailable: () => true,
    ...overrides,
  }
  const controller = createCoderController(input)
  return { controller, setWorkspaceID, setServerModel, calls, deferred }
}

describe("model and enabled", () => {
  test("seeds from the authoritative workspace coderModel", () => {
    createRoot((dispose) => {
      const env = createEnv({}, modelA)
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.enabled()).toBe(true)
      expect(env.controller.pending()).toBe(false)
      expect(env.controller.error()).toBeNull()
      dispose()
    })
  })

  test("enabled is false while no coder model is set", () => {
    createRoot((dispose) => {
      const env = createEnv()
      expect(env.controller.enabled()).toBe(false)
      dispose()
    })
  })
})

describe("set", () => {
  test("patches optimistically and adopts the server-authoritative response", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.set(modelA)
      expect(env.controller.pending()).toBe(true)
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.enabled()).toBe(true)
      expect(env.calls).toEqual([
        { workspaceID: "ws-1", coderModel: modelA, signal: expect.any(AbortSignal) },
      ])
      env.deferred[0]?.resolve({ coderModel: modelB })
      await done
      expect(env.controller.model()).toEqual(modelB)
      expect(env.controller.pending()).toBe(false)
      expect(env.controller.error()).toBeNull()
      dispose()
    })
  })

  test("rejects with model-unavailable before patching", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({ isModelAvailable: (model) => model.modelID !== "a" })
      await expect(env.controller.set(modelA)).rejects.toEqual({
        type: "model-unavailable",
        model: modelA,
      })
      expect(env.controller.error()).toEqual({ type: "model-unavailable", model: modelA })
      expect(env.controller.pending()).toBe(false)
      expect(env.calls).toEqual([])
      dispose()
    })
  })

  test("rejects with permission-denied before patching", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({ taskPermission: () => "deny" })
      await expect(env.controller.set(modelA)).rejects.toEqual({
        type: "permission-denied",
      })
      expect(env.controller.error()).toEqual({ type: "permission-denied" })
      expect(env.calls).toEqual([])
      dispose()
    })
  })

  test("rejects with no-workspace before patching", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.setWorkspaceID(undefined)
      await expect(env.controller.set(modelA)).rejects.toEqual({
        type: "no-workspace",
      })
      expect(env.controller.error()).toEqual({ type: "no-workspace" })
      expect(env.calls).toEqual([])
      dispose()
    })
  })

  test("rolls back to the server value and surfaces the failure", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({}, modelA)
      const done = env.controller.set(modelB)
      env.deferred[0]?.reject(new Error("patch failed"))
      await expect(done).rejects.toThrow("patch failed")
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.enabled()).toBe(true)
      expect(env.controller.pending()).toBe(false)
      expect(env.controller.error()).toEqual({
        type: "patch-failed",
        cause: expect.any(Error),
      })
      dispose()
    })
  })

  test("notifies the manager with the authoritative model on success", async () => {
    createRoot(async (dispose) => {
      const published: Array<Model | null> = []
      const env = createEnv({ onServerModel: (model) => published.push(model) })
      const done = env.controller.set(modelA)
      env.deferred[0]?.resolve({ coderModel: modelA })
      await done
      expect(published).toEqual([modelA])
      dispose()
    })
  })

  test("drops a superseded response and keeps the latest request authoritative", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const first = env.controller.set(modelA)
      const second = env.controller.set(modelB)
      expect(env.calls).toHaveLength(2)
      expect(env.calls[0]?.signal?.aborted).toBe(true)
      env.deferred[1]?.resolve({ coderModel: modelB })
      await second
      expect(env.controller.model()).toEqual(modelB)
      expect(env.controller.pending()).toBe(false)
      env.deferred[0]?.resolve({ coderModel: modelA })
      await first
      expect(env.controller.model()).toEqual(modelB)
      dispose()
    })
  })

  test("ignores a superseded failure without touching the adopted model", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const first = env.controller.set(modelA)
      const second = env.controller.set(modelB)
      env.deferred[1]?.resolve({ coderModel: modelB })
      await second
      env.deferred[0]?.reject(new Error("late failure"))
      await first
      expect(env.controller.model()).toEqual(modelB)
      expect(env.controller.error()).toBeNull()
      expect(env.controller.pending()).toBe(false)
      dispose()
    })
  })

  test("clears the previous error when a new request starts", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const failed = env.controller.set(modelA)
      env.deferred[0]?.reject(new Error("boom"))
      await expect(failed).rejects.toThrow("boom")
      const done = env.controller.set(modelA)
      expect(env.controller.error()).toBeNull()
      expect(env.controller.pending()).toBe(true)
      env.deferred[1]?.resolve({ coderModel: modelA })
      await done
      dispose()
    })
  })
})

describe("clear", () => {
  test("patches null and adopts the cleared server state", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({}, modelA)
      const done = env.controller.clear()
      expect(env.controller.pending()).toBe(true)
      expect(env.calls[0]).toEqual({
        workspaceID: "ws-1",
        coderModel: null,
        signal: expect.any(AbortSignal),
      })
      env.deferred[0]?.resolve({ coderModel: null })
      await done
      expect(env.controller.model()).toBeNull()
      expect(env.controller.enabled()).toBe(false)
      expect(env.controller.pending()).toBe(false)
      dispose()
    })
  })

  test("rolls back to the previous model when clearing fails", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({}, modelA)
      const done = env.controller.clear()
      env.deferred[0]?.reject(new Error("nope"))
      await expect(done).rejects.toThrow("nope")
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.error()).toEqual({
        type: "patch-failed",
        cause: expect.any(Error),
      })
      dispose()
    })
  })

  test("surfaces permission denial instead of clearing silently", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({ taskPermission: () => "deny" }, modelA)
      await expect(env.controller.clear()).rejects.toEqual({
        type: "permission-denied",
      })
      expect(env.controller.model()).toEqual(modelA)
      expect(env.calls).toEqual([])
      dispose()
    })
  })
})

describe("retry", () => {
  test("re-attempts the failed set and adopts the response", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const failed = env.controller.set(modelA)
      env.deferred[0]?.reject(new Error("transient"))
      await expect(failed).rejects.toThrow("transient")
      const done = env.controller.retry()
      expect(env.calls).toHaveLength(2)
      expect(env.calls[1]).toEqual({
        workspaceID: "ws-1",
        coderModel: modelA,
        signal: expect.any(AbortSignal),
      })
      env.deferred[1]?.resolve({ coderModel: modelA })
      await done
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.error()).toBeNull()
      dispose()
    })
  })

  test("re-attempts the failed clear", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({}, modelA)
      const failed = env.controller.clear()
      env.deferred[0]?.reject(new Error("transient"))
      await expect(failed).rejects.toThrow("transient")
      const done = env.controller.retry()
      expect(env.calls[1]?.coderModel).toBeNull()
      env.deferred[1]?.resolve({ coderModel: null })
      await done
      expect(env.controller.model()).toBeNull()
      dispose()
    })
  })

  test("refetches the authoritative model when there is no last request", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.setServerModel(modelB)
      await env.controller.retry()
      expect(env.controller.model()).toEqual(modelB)
      expect(env.controller.error()).toBeNull()
      expect(env.calls).toEqual([])
      dispose()
    })
  })

  test("surfaces no-workspace when refetching without a workspace", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.setWorkspaceID(undefined)
      await expect(env.controller.retry()).rejects.toEqual({
        type: "no-workspace",
      })
      dispose()
    })
  })

  test("is a no-op while a request is pending", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.set(modelA)
      await env.controller.retry()
      expect(env.calls).toHaveLength(1)
      env.deferred[0]?.resolve({ coderModel: modelA })
      await done
      dispose()
    })
  })
})

describe("workspace switch", () => {
  test("drops an in-flight patch for the previous workspace and reconciles to the new one", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.set(modelB)
      env.setWorkspaceID("ws-2")
      env.setServerModel(modelA)
      env.deferred[0]?.resolve({ coderModel: modelB })
      await done
      expect(env.controller.model()).toEqual(modelA)
      expect(env.controller.pending()).toBe(false)
      dispose()
    })
  })

  test("patches the current workspace after a switch", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.setWorkspaceID("ws-2")
      const done = env.controller.set(modelA)
      expect(env.calls[0]?.workspaceID).toBe("ws-2")
      env.deferred[0]?.resolve({ coderModel: modelA })
      await done
      expect(env.controller.model()).toEqual(modelA)
      dispose()
    })
  })
})
