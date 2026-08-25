import type { ServerSDK } from "@/context/server-sdk"
import { describe, expect, test } from "bun:test"
import type { BlockRuntimeServices, CanvasBlockDescriptor } from "../contracts"
import { createBlockRuntimeEventRouter } from "../event-router"
import { operatingChatRuntimeRegistration } from "./operating-chat"

const binding = {
  workspaceID: "wrk_test",
  blockID: "block-1",
  functionalityInstanceID: "instance-1",
  sessionID: "ses_operating",
  directory: "D:/workspace",
  generation: 0,
  revision: 1,
}

function services() {
  const calls: unknown[] = []
  const sdk = {
    client: {
      v2: {
        workspace: {
          operatingChat: {
            ensure: async (input: unknown) => {
              calls.push(input)
              return { data: binding }
            },
            reset: async (input: unknown, options: unknown) => {
              calls.push({ input, options })
              return { data: binding }
            },
          },
        },
      },
    },
  } as unknown as ServerSDK
  return {
    calls,
    value: {
      serverSDK: () => sdk,
      eventRouter: {
        on: () => () => {},
        off: () => {},
        onReconnect: () => () => {},
      },
      workspace: {
        id: () => binding.workspaceID,
        epoch: () => 0,
        connected: () => true,
        awaitDescriptorPersisted: async () => {
          calls.push("descriptor-persisted")
        },
      },
      localView: {
        read: () => undefined,
        write: () => {},
        delete: () => {},
        clearAll: () => {},
      },
    } satisfies BlockRuntimeServices,
  }
}

const block: CanvasBlockDescriptor = {
  id: binding.blockID,
  functionalityID: "builtin:operating-chat-session",
  transform: { x: 1, y: 2, w: 3, h: 4, z: 5 },
}

describe("operatingChatRuntimeRegistration", () => {
  test("resolves the durable host binding and subscribes to replacement events", async () => {
    const input = services()
    const resolved = await operatingChatRuntimeRegistration.resolve({
      workspaceID: binding.workspaceID,
      block,
      services: input.value,
      signal: new AbortController().signal,
    })

    expect(input.calls).toEqual([
      "descriptor-persisted",
      { workspaceID: binding.workspaceID, blockID: binding.blockID },
    ])
    expect(operatingChatRuntimeRegistration.select({ resolved, projection: undefined, localView: undefined })).toEqual({
      workspaceID: binding.workspaceID,
      blockID: binding.blockID,
      functionalityInstanceID: binding.functionalityInstanceID,
      sessionID: binding.sessionID,
      directory: binding.directory,
      queueEnabled: true,
      revision: binding.revision,
    })
    expect(operatingChatRuntimeRegistration.eventKeys?.(resolved)).toEqual([
      {
        type: "workspace.operatingChat.binding.updated",
        workspaceID: binding.workspaceID,
        blockID: binding.blockID,
      },
    ])
  })

  test("dispatches reset with the current binding and abort signal", async () => {
    const input = services()
    const resolved = await operatingChatRuntimeRegistration.resolve({
      workspaceID: binding.workspaceID,
      block,
      services: input.value,
      signal: new AbortController().signal,
    })
    const signal = new AbortController().signal

    await operatingChatRuntimeRegistration.dispatch?.({
      resolved,
      command: { type: "reset" },
      services: input.value,
      signal,
    })

    expect(input.calls).toEqual([
      "descriptor-persisted",
      { workspaceID: binding.workspaceID, blockID: binding.blockID },
      {
        input: {
          workspaceID: "wrk_test",
          blockID: "block-1",
          operatingChatResetPayload: {
            expectedSessionID: "ses_operating",
            expectedRevision: 1,
          },
        },
        options: { throwOnError: true, signal },
      },
    ])
  })

  test("matches binding events that carry workspace and block identity", () => {
    let publish: ((event: { details: { type: string; properties: Record<string, unknown> } }) => void) | undefined
    const router = createBlockRuntimeEventRouter({
      listen: (listener) => {
        publish = listener
        return () => {}
      },
    })
    let received = 0
    const key = operatingChatRuntimeRegistration.eventKeys?.({ ...binding, queueEnabled: true })?.[0]
    if (!key) throw new Error("OperatingChat event key not found")
    router.on(key, () => {
      received += 1
    })

    publish?.({
      details: {
        type: "workspace.operatingChat.binding.updated",
        properties: {
          workspaceID: binding.workspaceID,
          blockID: binding.blockID,
          sessionID: binding.sessionID,
          generation: binding.generation,
          revision: binding.revision,
        },
      },
    })

    expect(received).toBe(1)
  })
})
