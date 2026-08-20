import { describe, expect, test } from "bun:test"
import {
  defaultOperatingLayers,
  type OperatingExchange,
  type OperatingLayer,
} from "../../editor/operating-context"
import { operatingChatRuntimeRegistration, tail, type OperatingChatBlockDescriptor } from "./operating-chat"

function createLocalViewStore() {
  const records = new Map<string, Record<string, unknown>>()
  return {
    records,
    read<T>(blockID: string): T | undefined {
      return records.get(blockID) as T | undefined
    },
    write(blockID: string, value: Record<string, unknown>) {
      records.set(blockID, { ...(records.get(blockID) ?? {}), ...value })
    },
  }
}

const BLOCK_ID = "block-1"

function resolveInput(store: ReturnType<typeof createLocalViewStore>) {
  const block: OperatingChatBlockDescriptor = {
    id: BLOCK_ID,
    functionalityID: "builtin:operating-chat",
  }
  return {
    workspaceID: "ws-1",
    block,
    services: { localView: store },
    signal: new AbortController().signal,
  }
}

function dispatchInput(
  store: ReturnType<typeof createLocalViewStore>,
  resolved: Awaited<ReturnType<typeof operatingChatRuntimeRegistration.resolve>>,
) {
  return {
    resolved,
    services: { localView: store },
    signal: new AbortController().signal,
  }
}

describe("operatingChatRuntimeRegistration", () => {
  test("resolve reads defaults for a fresh block", async () => {
    const store = createLocalViewStore()
    const resolved = await operatingChatRuntimeRegistration.resolve(resolveInput(store))

    expect(resolved.blockID).toBe(BLOCK_ID)
    expect(resolved.state.history).toEqual([])
    expect(resolved.state.layers).toEqual(defaultOperatingLayers())

    const view = operatingChatRuntimeRegistration.select({
      resolved,
      projection: undefined,
      localView: store.read(BLOCK_ID),
    })
    expect(view.history).toEqual([])
    expect(view.layers).toEqual(defaultOperatingLayers())
  })

  test("dispatch append-exchange appends history and updates the operational tail", async () => {
    const store = createLocalViewStore()
    const resolved = await operatingChatRuntimeRegistration.resolve(resolveInput(store))

    await operatingChatRuntimeRegistration.dispatch({
      ...dispatchInput(store, resolved),
      command: { type: "append-exchange", role: "user", text: "hello\nworld" },
    })

    const stored = store.read<{ history: OperatingExchange[]; layers: OperatingLayer[] }>(
      BLOCK_ID,
    )
    expect(stored?.history).toHaveLength(1)
    expect(stored?.history?.[0]).toMatchObject({ role: "user", text: "hello\nworld" })
    expect(stored?.history?.[0].index).toBe(1)
    expect(stored?.layers?.[2]).toMatchObject({ layer: "operational", text: tail("hello\nworld") })

    const view = operatingChatRuntimeRegistration.select({
      resolved,
      projection: undefined,
      localView: store.read(BLOCK_ID),
    })
    expect(view.history).toHaveLength(1)
    expect(view.layers[2].text).toBe(tail("hello\nworld"))
    expect(view.layers[3].text).toBe("")
  })

  test("dispatch set-custom-layer writes the custom layer text", async () => {
    const store = createLocalViewStore()
    const resolved = await operatingChatRuntimeRegistration.resolve(resolveInput(store))

    await operatingChatRuntimeRegistration.dispatch({
      ...dispatchInput(store, resolved),
      command: { type: "set-custom-layer", text: "fixed guidance" },
    })

    const stored = store.read<{ layers: OperatingLayer[] }>(BLOCK_ID)
    expect(stored?.layers?.[3]).toMatchObject({ layer: "custom", text: "fixed guidance" })

    const view = operatingChatRuntimeRegistration.select({
      resolved,
      projection: undefined,
      localView: store.read(BLOCK_ID),
    })
    expect(view.layers[3]).toMatchObject({ layer: "custom", text: "fixed guidance" })
    expect(view.layers[2].text).toBe("")
  })

  test("dispose is idempotent", async () => {
    const store = createLocalViewStore()
    const resolved = await operatingChatRuntimeRegistration.resolve(resolveInput(store))

    expect(() => {
      resolved.dispose()
      resolved.dispose()
    }).not.toThrow()
  })
})