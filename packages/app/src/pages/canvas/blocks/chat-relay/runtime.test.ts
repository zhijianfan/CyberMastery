import { describe, expect, test } from "bun:test"
import type { ServerSDK } from "@/context/server-sdk"
import type { BlockRuntimeServices, CanvasBlockDescriptor } from "../../runtime/contracts"
import { ChatRelayRuntimeAdapter } from "./runtime"

const binding = {
  workspaceID: "wrk_test",
  blockID: "block-1",
  functionalityInstanceID: "instance-1",
  sessionID: "ses_relay",
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
          chatRelay: {
            ensure: async (input: unknown) => {
              calls.push(input)
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
  functionalityID: "builtin:chat-relay",
  transform: { x: 1, y: 2, w: 3, h: 4, z: 5 },
}

describe("ChatRelayRuntimeAdapter", () => {
  test("resolves only the host binding and projects the native session surface", async () => {
    const input = services()
    const resolved = await ChatRelayRuntimeAdapter.resolve({
      workspaceID: binding.workspaceID,
      block,
      services: input.value,
      signal: new AbortController().signal,
    })

    expect(input.calls).toEqual([
      "descriptor-persisted",
      { workspaceID: binding.workspaceID, blockID: binding.blockID },
    ])
    expect(ChatRelayRuntimeAdapter.select({ resolved, projection: undefined, localView: undefined })).toEqual({
      workspaceID: binding.workspaceID,
      sessionID: binding.sessionID,
      directory: binding.directory,
      queueEnabled: true,
    })
    expect(ChatRelayRuntimeAdapter.eventKeys?.(resolved)).toEqual([
      {
        type: "workspace.chatRelay.binding.updated",
        workspaceID: binding.workspaceID,
        blockID: binding.blockID,
      },
    ])
  })
})
