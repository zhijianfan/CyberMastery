import { describe, expect, test } from "bun:test"
import { masterAgentRuntimeRegistration } from "./runtime-registration"
import type { MasterAgent } from "./types"

function binding(blockID: string): MasterAgent.Binding {
  return {
    workspaceID: "ws-1",
    blockID,
    functionalityInstanceID: "fi-1",
    sessionID: "sess-1",
    directory: "/repo/main",
    generation: 1,
    revision: 3,
  }
}

function fakeServices() {
  const calls: { ensure: number; reset: unknown[]; patches: unknown[] } = { ensure: 0, reset: [], patches: [] }
  const client = {
    v2: {
      workspace: {
        masterAgent: {
          ensure: async () => {
            calls.ensure += 1
            return { data: binding("b1") }
          },
          reset: async (payload: { masterAgentResetPayload: { expectedSessionID: string; expectedRevision: number } }) => {
            calls.reset.push(payload.masterAgentResetPayload)
            return { data: { status: "reset", binding: binding("b1") } }
          },
        },
        update: async (payload: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => {
          calls.patches.push(payload.workspaceUpdatePayload.patch)
          return { data: { model: null, operatingAgent: null, coderModel: null } }
        },
      },
    },
  }
  return {
    calls,
    services: {
      serverSDK: () => ({ client }) as never,
      eventRouter: { on: () => () => {}, off: () => {} },
      workspace: {
        id: () => "ws-1",
        epoch: () => 0,
        connected: () => true,
        awaitDescriptorPersisted: async () => {},
      },
      localView: {
        read: () => undefined,
        write: () => {},
        delete: () => {},
        clearAll: () => {},
      },
    },
  }
}

describe("masterAgentRuntimeRegistration", () => {
  test("mode is native with the master-agent functionality", () => {
    expect(masterAgentRuntimeRegistration.mode).toBe("native")
    expect(masterAgentRuntimeRegistration.functionalityID).toBe("builtin:master-agent")
  })

  test("resolve ensures the binding and select projects the view", async () => {
    const { services } = fakeServices()
    const resolved = await masterAgentRuntimeRegistration.resolve({
      workspaceID: "ws-1",
      block: { id: "b1", functionalityID: "builtin:master-agent", transform: { x: 0, y: 0, w: 0, h: 0, z: 0 } },
      services: services as never,
      signal: new AbortController().signal,
    })
    expect(resolved.binding.sessionID).toBe("sess-1")
    const view = masterAgentRuntimeRegistration.select({ resolved, projection: undefined, localView: undefined })
    expect(view).toEqual({ status: "ready", sessionID: "sess-1", directory: "/repo/main", coder: null, queueEnabled: false })
  })

  test("dispatch routes ensure/reset/coder commands to the workspace API", async () => {
    const { calls, services } = fakeServices()
    const resolved = {
      workspaceID: "ws-1",
      blockID: "b1",
      binding: binding("b1"),
    }
    type Command = Parameters<NonNullable<typeof masterAgentRuntimeRegistration.dispatch>>[0]["command"]
    const dispatch = (command: Command) =>
      masterAgentRuntimeRegistration.dispatch!({ resolved, command, services: services as never, signal: new AbortController().signal })

    await dispatch({ type: "retry" })
    expect(calls.ensure).toBe(1)

    await dispatch({ type: "reset" })
    expect(calls.reset).toEqual([{ expectedSessionID: "sess-1", expectedRevision: 3 }])

    await dispatch({ type: "coder.set", model: { providerID: "acme", modelID: "coder-mini" } })
    expect(calls.patches.at(-1)).toEqual({ coderModel: "acme:coder-mini" })

    await dispatch({ type: "coder.clear" })
    expect(calls.patches.at(-1)).toEqual({ coderModel: null })
  })
})
