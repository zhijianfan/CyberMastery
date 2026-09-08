import { afterEach, describe, expect, mock, test } from "bun:test"
import { CTXPACK_DRAG_MIME, serializeCtxPackDragPayload, type CtxPackDragPayloadV1 } from "./drag"
import type { MessageContextTargetRegistration, MessageContextTargetRegistry } from "./drop-target"

// The repo's test setup resolves solid-js to its server build under the
// `solid` export condition, so redirect it to the client build before anything
// imports it. mock.module cannot intercept static imports (the repo's own
// probe-mock.test.tsx proves it), so solid-js and the ctxpack modules below
// are loaded dynamically, after registration. See HANDOFF-U3.md.
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
mock.module("solid-js", () => require(clientSolid))

const { createRoot } = await import("solid-js")
const { CTXPACK_DROP_RING_CLASS, CtxPackDropTarget, createMessageContextTargetRegistry, messageContextTargetRegistry } =
  await import("./drop-target")

const registry: MessageContextTargetRegistry = messageContextTargetRegistry

const unregisterAll: Array<() => void> = []
const disposes: Array<() => void> = []

afterEach(() => {
  while (unregisterAll.length > 0) unregisterAll.pop()!()
  while (disposes.length > 0) disposes.pop()!()
  registry.markFocused("__no-target__")
})

let nextTargetID = 0

function makePayload(overrides: Partial<CtxPackDragPayloadV1> = {}): CtxPackDragPayloadV1 {
  return {
    version: 1,
    workspaceID: "ws-1",
    ctxPackID: "pack-1",
    contentHash: "hash-1",
    label: "Pack 1",
    estimatedTokens: 100,
    ...overrides,
  }
}

function makeTarget(overrides: Partial<MessageContextTargetRegistration> = {}) {
  const calls: CtxPackDragPayloadV1[] = []
  const target: MessageContextTargetRegistration = {
    targetID: `test-target-${nextTargetID++}`,
    workspaceID: "ws-1",
    instanceID: "instance-1",
    functionalityID: "functionality-1",
    disabled: () => false,
    addCtxPack: async (payload) => {
      calls.push(payload)
    },
    ...overrides,
  }
  return { target, calls }
}

function registerTarget(overrides: Partial<MessageContextTargetRegistration> = {}) {
  const { target, calls } = makeTarget(overrides)
  unregisterAll.push(registry.register(target))
  return { target, calls }
}

function makeDataTransfer(entries: Record<string, string> = {}): DataTransfer {
  const store = new Map<string, string>(Object.entries(entries))
  const transfer = {
    get types() {
      return [...store.keys()]
    },
    getData(type: string) {
      return store.get(type) ?? ""
    },
    setData(type: string, value: string) {
      store.set(type, value)
    },
    dropEffect: "none",
    effectAllowed: "uninitialized",
  }
  return transfer as unknown as DataTransfer
}

function dragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event as DragEvent
}

function renderDropTarget(overrides: Partial<Parameters<typeof CtxPackDropTarget>[0]> = {}) {
  const addCalls: CtxPackDragPayloadV1[] = []
  const addCtxPack = async (payload: CtxPackDragPayloadV1) => {
    addCalls.push(payload)
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  let element!: Element
  const dispose = createRoot((disposeRoot) => {
    element = CtxPackDropTarget({
      targetID: overrides.targetID ?? "component-target",
      workspaceID: "ws-1",
      instanceID: "instance-1",
      functionalityID: "functionality-1",
      addCtxPack,
      disabled: overrides.disabled,
      children: document.createElement("span"),
    }) as Element
    container.appendChild(element)
    return () => {
      element.remove()
      container.remove()
      disposeRoot()
    }
  })
  disposes.push(dispose)
  return { element, addCalls }
}

describe("message context target registry", () => {
  test("register returns an unregister that removes the target", () => {
    const { target } = makeTarget()
    const unregister = registry.register(target)
    registry.markFocused(target.targetID)
    expect(registry.focused()).toBe(target)
    unregister()
    expect(registry.focused()).toBeNull()
  })

  test("disposing an older duplicate leaves the newer target active", async () => {
    const localRegistry = createMessageContextTargetRegistry()
    const older = makeTarget({ targetID: "shared-target", instanceID: "older-instance" })
    const newer = makeTarget({ targetID: "shared-target", instanceID: "newer-instance" })
    const disposeOlder = localRegistry.register(older.target)
    const disposeNewer = localRegistry.register(newer.target)
    localRegistry.markFocused("shared-target")

    disposeOlder()
    disposeOlder()
    expect(localRegistry.focused()).toBe(newer.target)

    const payload = makePayload({ ctxPackID: "pack-newer" })
    await localRegistry.attachToFocused(payload)
    expect(older.calls).toHaveLength(0)
    expect(newer.calls).toEqual([payload])

    disposeNewer()
    disposeNewer()
    expect(localRegistry.focused()).toBeNull()
    await expect(localRegistry.attachToFocused(payload)).rejects.toThrow("no-focused-target")
  })

  test("disposing a newer duplicate restores the older target for focused routing", async () => {
    const localRegistry = createMessageContextTargetRegistry()
    const older = makeTarget({ targetID: "shared-target", instanceID: "older-instance" })
    const newer = makeTarget({ targetID: "shared-target", instanceID: "newer-instance" })
    const disposeOlder = localRegistry.register(older.target)
    const disposeNewer = localRegistry.register(newer.target)
    localRegistry.markFocused("shared-target")

    expect(localRegistry.focused()).toBe(newer.target)
    disposeNewer()
    disposeNewer()
    expect(localRegistry.focused()).toBe(older.target)

    const payload = makePayload({ ctxPackID: "pack-restored" })
    await localRegistry.attachToFocused(payload)
    expect(newer.calls).toHaveLength(0)
    expect(older.calls).toEqual([payload])

    disposeOlder()
    disposeOlder()
    expect(localRegistry.focused()).toBeNull()
    await expect(localRegistry.attachToFocused(payload)).rejects.toThrow("no-focused-target")
  })

  test("markFocused then focused() resolves the registered target", () => {
    const { target } = registerTarget()
    registry.markFocused(target.targetID)
    expect(registry.focused()).toBe(target)
  })

  test("focused() is null when nothing was ever marked", () => {
    registerTarget()
    expect(registry.focused()).toBeNull()
  })

  test("focused() is null when the focused target reports disabled()", () => {
    let disabled = false
    const { target } = registerTarget({ disabled: () => disabled })
    registry.markFocused(target.targetID)
    expect(registry.focused()).toBe(target)
    disabled = true
    expect(registry.focused()).toBeNull()
  })

  test("focused() is null when the focused target id is not registered", () => {
    registry.markFocused("ghost-target")
    expect(registry.focused()).toBeNull()
  })

  test("attachToFocused forwards the payload to the focused target's addCtxPack", async () => {
    const { target, calls } = registerTarget()
    registry.markFocused(target.targetID)
    const payload = makePayload()
    await registry.attachToFocused(payload)
    expect(calls).toEqual([payload])
  })

  test("attachToFocused rejects with no-focused-target when nothing is focused", async () => {
    await expect(registry.attachToFocused(makePayload())).rejects.toThrow("no-focused-target")
  })

  test("attachToFocused rejects with no-focused-target when the focused target is disabled", async () => {
    const { target } = registerTarget({ disabled: () => true })
    registry.markFocused(target.targetID)
    await expect(registry.attachToFocused(makePayload())).rejects.toThrow("no-focused-target")
  })

  test("attachToFocused rejects when the focused target id is not registered", async () => {
    registry.markFocused("ghost-target")
    await expect(registry.attachToFocused(makePayload())).rejects.toThrow("no-focused-target")
  })

  test("attachToFocused follows explicit focus changes between registered targets", async () => {
    const { target: first, calls: firstCalls } = registerTarget()
    const { target: second, calls: secondCalls } = registerTarget({ targetID: "other-target" })
    registry.markFocused(first.targetID)
    await registry.attachToFocused(makePayload({ ctxPackID: "pack-first" }))
    expect(firstCalls).toHaveLength(1)
    expect(secondCalls).toHaveLength(0)

    registry.markFocused(second.targetID)
    await registry.attachToFocused(makePayload({ ctxPackID: "pack-second" }))
    expect(secondCalls).toHaveLength(1)
    expect(secondCalls[0]?.ctxPackID).toBe("pack-second")
  })

  test("distinct session-like target IDs coexist and focus routing reaches the marked composer", async () => {
    const { calls: firstCalls } = registerTarget({
      targetID: "chat-instance:session-a",
      instanceID: "chat-instance:session-a",
    })
    const { calls: secondCalls } = registerTarget({
      targetID: "chat-instance:session-b",
      instanceID: "chat-instance:session-b",
    })

    registry.markFocused("chat-instance:session-a")
    await registry.attachToFocused(makePayload({ ctxPackID: "pack-a" }))
    expect(firstCalls).toHaveLength(1)
    expect(secondCalls).toHaveLength(0)

    registry.markFocused("chat-instance:session-b")
    await registry.attachToFocused(makePayload({ ctxPackID: "pack-b" }))
    expect(secondCalls).toHaveLength(1)
    expect(firstCalls).toHaveLength(1)
    expect(firstCalls[0]?.ctxPackID).toBe("pack-a")
    expect(secondCalls[0]?.ctxPackID).toBe("pack-b")
  })

})

describe("CtxPackDropTarget", () => {
  test("disabled targets ignore dragover and drop interactions", () => {
    const { element, addCalls } = renderDropTarget({ disabled: () => true })
    const transfer = makeDataTransfer({
      [CTXPACK_DRAG_MIME]: serializeCtxPackDragPayload(makePayload()),
    })
    const dragoverEvent = dragEvent("dragover", transfer)
    element.dispatchEvent(dragoverEvent)
    expect(dragoverEvent.defaultPrevented).toBe(false)
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(false)

    const dropEvent = dragEvent("drop", transfer)
    element.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(false)
    expect(addCalls).toHaveLength(0)
  })

  test("registers on mount with the provided identity fields and unregisters on unmount", () => {
    renderDropTarget()
    registry.markFocused("component-target")
    const target = registry.focused()
    expect(target?.targetID).toBe("component-target")
    expect(target?.workspaceID).toBe("ws-1")
    expect(target?.instanceID).toBe("instance-1")
    expect(target?.functionalityID).toBe("functionality-1")

    while (disposes.length > 0) disposes.pop()!()
    expect(registry.focused()).toBeNull()
  })

  test("dragover with a valid payload prevents default, sets dropEffect copy, and shows the ring", () => {
    const { element } = renderDropTarget()
    const transfer = makeDataTransfer({
      [CTXPACK_DRAG_MIME]: serializeCtxPackDragPayload(makePayload()),
    })
    const event = dragEvent("dragover", transfer)
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe("copy")
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(true)
  })

  test("dragover accepts the CtxPack MIME while payload data is protected", () => {
    const { element } = renderDropTarget()
    const transfer = new DataTransfer()
    transfer.setData(CTXPACK_DRAG_MIME, "")
    const event = dragEvent("dragover", transfer)
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(true)
  })

  test("dragover with a garbage payload still recognizes the CtxPack MIME", () => {
    const { element } = renderDropTarget()
    const transfer = makeDataTransfer({ [CTXPACK_DRAG_MIME]: "{not-json" })
    const event = dragEvent("dragover", transfer)
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe("copy")
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(true)
  })

  test("dragover with unrelated MIME types is a no-op", () => {
    const { element } = renderDropTarget()
    const transfer = makeDataTransfer({ "text/plain": "arbitrary text" })
    const event = dragEvent("dragover", transfer)
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(false)
  })

  test("dragleave clears the ring", () => {
    const { element } = renderDropTarget()
    const transfer = makeDataTransfer({
      [CTXPACK_DRAG_MIME]: serializeCtxPackDragPayload(makePayload()),
    })
    element.dispatchEvent(dragEvent("dragover", transfer))
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(true)
    element.dispatchEvent(dragEvent("dragleave", transfer))
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(false)
  })

  test("drop with a valid payload calls addCtxPack, prevents default, and clears the ring", () => {
    const { element, addCalls } = renderDropTarget()
    const payload = makePayload()
    const transfer = makeDataTransfer({ [CTXPACK_DRAG_MIME]: serializeCtxPackDragPayload(payload) })
    element.dispatchEvent(dragEvent("dragover", transfer))
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(true)
    const dropEvent = dragEvent("drop", transfer)
    element.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)
    expect(addCalls).toEqual([payload])
    expect(element.classList.contains(CTXPACK_DROP_RING_CLASS)).toBe(false)
  })

  test("drop with an unknown payload does nothing", () => {
    const { element, addCalls } = renderDropTarget()
    const transfer = makeDataTransfer({ "text/plain": "arbitrary text" })
    const event = dragEvent("drop", transfer)
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(addCalls).toHaveLength(0)
  })
})
