import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createMasterAgentLifecycleController, type LifecycleControllerInput } from "./lifecycle-controller"
import type { MasterAgent, MasterAgentPort } from "./types"

function binding(overrides: Partial<MasterAgent.Binding> = {}): MasterAgent.Binding {
  return {
    workspaceID: "ws-1",
    blockID: "block-1",
    functionalityInstanceID: "fi-1",
    sessionID: "session-1",
    directory: "/repo",
    generation: 1,
    revision: 1,
    ...overrides,
  }
}

interface PortCall {
  method: "get" | "ensure" | "reset"
  workspaceID: string
  blockID: string
  request?: MasterAgent.ResetRequest
  signal: AbortSignal | undefined
}

interface Deferred {
  resolve: (binding: MasterAgent.Binding | null) => void
  reject: (error: unknown) => void
  signal: AbortSignal | undefined
}

function createEnv(overrides: Partial<LifecycleControllerInput> = {}) {
  const [workspaceID, setWorkspaceID] = createSignal<string | undefined>("ws-1")
  const calls: PortCall[] = []
  const deferred: Deferred[] = []

  const port: MasterAgentPort = {
    get: (id, blockID, signal) => {
      calls.push({ method: "get", workspaceID: id, blockID, signal })
      return new Promise((resolve, reject) => deferred.push({ resolve, reject, signal }))
    },
    ensure: (id, blockID, signal) => {
      calls.push({ method: "ensure", workspaceID: id, blockID, signal })
      return new Promise<MasterAgent.Binding>((resolve, reject) => {
        deferred.push({
          resolve: (value) => {
            if (value === null) reject(new Error("ensure resolved without a binding"))
            else resolve(value)
          },
          reject,
          signal,
        })
      })
    },
    reset: (request, signal) => {
      calls.push({ method: "reset", workspaceID: request.workspaceID, blockID: request.blockID, request, signal })
      return new Promise<MasterAgent.Binding>((resolve, reject) => {
        deferred.push({
          resolve: (value) => {
            if (value === null) reject(new Error("reset resolved without a binding"))
            else resolve(value)
          },
          reject,
          signal,
        })
      })
    },
    patchCoderModel: () => Promise.resolve({ model: null, operatingAgent: null, coderModel: null }),
  }

  const controller = createMasterAgentLifecycleController({
    workspaceID,
    blockID: "block-1",
    port,
    ...overrides,
  })

  return { controller, setWorkspaceID, calls, deferred }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("ensure", () => {
  test("uninitialized -> loading -> ready", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      expect(env.controller.state()).toEqual({ status: "loading" })
      expect(env.calls).toHaveLength(1)
      expect(env.calls[0]).toEqual({
        method: "ensure",
        workspaceID: "ws-1",
        blockID: "block-1",
        signal: expect.any(AbortSignal),
      })
      env.deferred[0]?.resolve(binding({ revision: 3 }))
      await done
      expect(env.controller.state()).toEqual({ status: "ready", binding: binding({ revision: 3 }) })
      dispose()
    })
  })

  test("deduplicates simultaneous calls and shares one promise", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const first = env.controller.ensure()
      const second = env.controller.ensure()
      expect(second).toBe(first)
      expect(env.calls).toHaveLength(1)
      env.deferred[0]?.resolve(binding())
      await first
      expect(env.controller.state()).toEqual({ status: "ready", binding: binding() })
      dispose()
    })
  })

  test("is a no-op once ready", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      await env.controller.ensure()
      expect(env.calls).toHaveLength(1)
      dispose()
    })
  })

  test("is a no-op without a workspace", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.setWorkspaceID(undefined)
      await env.controller.ensure()
      expect(env.calls).toHaveLength(0)
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })

  test("maps access-denied to permission-denied", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.reject({ type: "access-denied" })
      await done
      expect(env.controller.state()).toEqual({ status: "permission-denied" })
      dispose()
    })
  })

  test("maps structural failures to unavailable", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.reject({ type: "workspace-not-found" })
      await done
      expect(env.controller.state()).toEqual({ status: "unavailable", reason: "workspace-not-found" })
      dispose()
    })
  })

  test("maps unknown failures to a recoverable error", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.reject(new Error("network down"))
      await done
      expect(env.controller.state()).toEqual({ status: "error", error: expect.any(Error), recoverable: true })
      dispose()
    })
  })
})

describe("retry", () => {
  test("re-attempts ensure from a recoverable error", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const failed = env.controller.ensure()
      env.deferred[0]?.reject(new Error("network down"))
      await failed
      expect(env.controller.state()).toEqual({ status: "error", error: expect.any(Error), recoverable: true })
      const done = env.controller.retry()
      expect(env.controller.state()).toEqual({ status: "loading" })
      expect(env.calls).toHaveLength(2)
      env.deferred[1]?.resolve(binding())
      await done
      expect(env.controller.state()).toEqual({ status: "ready", binding: binding() })
      dispose()
    })
  })

  test("shares an in-flight ensure", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const first = env.controller.ensure()
      const second = env.controller.retry()
      expect(second).toBe(first)
      expect(env.calls).toHaveLength(1)
      env.deferred[0]?.resolve(binding())
      await first
      dispose()
    })
  })

  test("is a no-op once ready", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      await env.controller.retry()
      expect(env.calls).toHaveLength(1)
      dispose()
    })
  })
})

describe("reset", () => {
  test("passes the expected session and revision exactly", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding({ sessionID: "session-7", revision: 12 }))
      await done
      const resetDone = env.controller.reset()
      expect(env.calls[1]?.request).toEqual({
        workspaceID: "ws-1",
        blockID: "block-1",
        expectedSessionID: "session-7",
        expectedRevision: 12,
      })
      env.deferred[1]?.resolve(binding({ sessionID: "session-8", generation: 2, revision: 13 }))
      await resetDone
      expect(env.controller.state()).toEqual({
        status: "ready",
        binding: binding({ sessionID: "session-8", generation: 2, revision: 13 }),
      })
      dispose()
    })
  })

  test("is skipped while the projection is not ready", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      await env.controller.reset()
      expect(env.calls).toHaveLength(0)
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })

  test("is skipped while the client projection reports pending activity", async () => {
    createRoot(async (dispose) => {
      const env = createEnv({ idle: () => false })
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      await env.controller.reset()
      expect(env.calls).toHaveLength(1)
      expect(env.controller.state()).toEqual({ status: "ready", binding: binding() })
      dispose()
    })
  })

  test("is skipped when the binding belongs to a previous workspace", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      env.setWorkspaceID("ws-2")
      await env.controller.reset()
      expect(env.calls).toHaveLength(1)
      dispose()
    })
  })

  test("surfaces reset-busy as a recoverable error without refetching", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      const resetDone = env.controller.reset()
      env.deferred[1]?.reject({ type: "reset-busy" })
      await resetDone
      expect(env.controller.state()).toEqual({ status: "error", error: { type: "reset-busy" }, recoverable: true })
      expect(env.calls).toHaveLength(2)
      dispose()
    })
  })

  test("adopts the host current binding on stale-binding", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding({ revision: 4 }))
      await done
      const resetDone = env.controller.reset()
      env.deferred[1]?.reject({ type: "stale-binding", current: binding({ sessionID: "session-11", revision: 11 }) })
      await resetDone
      expect(env.controller.state()).toEqual({
        status: "ready",
        binding: binding({ sessionID: "session-11", revision: 11 }),
      })
      expect(env.calls).toHaveLength(2)
      dispose()
    })
  })

  test("refetches the authoritative binding after a concurrent conflict", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding({ revision: 4 }))
      await done
      const resetDone = env.controller.reset()
      env.deferred[1]?.reject({ type: "concurrent-conflict" })
      await resetDone
      expect(env.controller.state()).toEqual({ status: "error", error: { type: "concurrent-conflict" }, recoverable: true })
      expect(env.calls[2]?.method).toBe("get")
      env.deferred[2]?.resolve(binding({ sessionID: "session-10", revision: 10 }))
      await tick()
      expect(env.controller.state()).toEqual({
        status: "ready",
        binding: binding({ sessionID: "session-10", revision: 10 }),
      })
      dispose()
    })
  })
})

describe("stale response suppression", () => {
  test("drops an ensure response from the previous workspace", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.setWorkspaceID("ws-2")
      env.deferred[0]?.resolve(binding())
      await done
      expect(env.controller.state()).toEqual({ status: "loading" })
      dispose()
    })
  })

  test("keeps a newer binding revision over a stale refetch response", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding({ revision: 5 }))
      await done
      env.controller.dispatch({
        type: "binding-updated",
        event: {
          type: "workspace.master-agent.binding.updated",
          workspaceID: "ws-1",
          blockID: "block-1",
          sessionID: "session-9",
          generation: 2,
          revision: 9,
        },
      })
      const refetchDone = env.controller.refetch()
      env.deferred[1]?.resolve(binding({ revision: 5 }))
      await refetchDone
      expect(env.controller.state()).toEqual({
        status: "ready",
        binding: binding({ sessionID: "session-9", generation: 2, revision: 9 }),
      })
      dispose()
    })
  })
})

describe("removeLocalProjection", () => {
  test("clears the projection without host mutation", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      env.controller.removeLocalProjection()
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      expect(env.calls).toHaveLength(1)
      dispose()
    })
  })

  test("drops an in-flight response after removal", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.controller.removeLocalProjection()
      env.deferred[0]?.resolve(binding({ revision: 9 }))
      await done
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })

  test("allows the block to be ensured again after removal", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      env.controller.removeLocalProjection()
      const remounted = env.controller.ensure()
      expect(env.calls).toHaveLength(2)
      env.deferred[1]?.resolve(binding({ sessionID: "session-2", revision: 2 }))
      await remounted
      expect(env.controller.state()).toEqual({
        status: "ready",
        binding: binding({ sessionID: "session-2", revision: 2 }),
      })
      dispose()
    })
  })
})

describe("refetch", () => {
  test("adopts the authoritative binding", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.refetch()
      env.deferred[0]?.resolve(binding({ revision: 6 }))
      await done
      expect(env.controller.state()).toEqual({ status: "ready", binding: binding({ revision: 6 }) })
      dispose()
    })
  })

  test("resets the projection when the host has no binding", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.deferred[0]?.resolve(binding())
      await done
      const refetchDone = env.controller.refetch()
      env.deferred[1]?.resolve(null)
      await refetchDone
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })
})

describe("dispose", () => {
  test("aborts the in-flight request and ignores late responses", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      const done = env.controller.ensure()
      env.controller.dispose()
      expect(env.calls[0]?.signal?.aborted).toBe(true)
      env.deferred[0]?.resolve(binding())
      await done
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })

  test("ignores commands issued after disposal", async () => {
    createRoot(async (dispose) => {
      const env = createEnv()
      env.controller.dispose()
      await env.controller.ensure()
      await env.controller.retry()
      await env.controller.reset()
      env.controller.removeLocalProjection()
      expect(env.calls).toHaveLength(0)
      expect(env.controller.state()).toEqual({ status: "uninitialized" })
      dispose()
    })
  })
})
