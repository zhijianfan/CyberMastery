import { describe, expect, mock, test } from "bun:test"
import type { CtxPackDragPayloadV1 } from "./drag"
import type {
  ContextAttachmentStore,
  ContextCapsuleMaterialize,
  ContextCapsuleMaterializeInput,
  ContextCapsuleMaterializeResult,
} from "./attachment-store"

// The repo's test setup resolves solid-js to its server build under the
// `solid` export condition, so redirect it to the client build before anything
// imports it. mock.module cannot intercept static imports (the repo's own
// probe-mock.test.tsx proves it), so solid-js and the ctxpack modules below
// are loaded dynamically, after registration. See HANDOFF-U3.md.
const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
mock.module("solid-js", () => require(clientSolid))

const { createRoot, createSignal } = await import("solid-js")
const {
  ContextAttachmentStoreProvider,
  MAX_CONTEXT_ATTACHMENTS,
  MAX_CONTEXT_ATTACHMENT_TOKENS,
  createContextAttachmentStore,
  toSessionContextAttachmentInput,
  useContextAttachmentStore,
  useContextAttachmentStoreOrNull,
  useOptionalContextAttachmentStore,
} = await import("./attachment-store")

interface FakeMaterializeOptions {
  estimatedTokens?: number | ((input: ContextCapsuleMaterializeInput) => number)
  rejectWith?: Error
}

function fakeMaterialize(options: FakeMaterializeOptions = {}) {
  const calls: ContextCapsuleMaterializeInput[] = []
  const materialize: ContextCapsuleMaterialize = async (input) => {
    calls.push(input)
    if (options.rejectWith !== undefined) throw options.rejectWith
    const estimatedTokens =
      typeof options.estimatedTokens === "function"
        ? options.estimatedTokens(input)
        : (options.estimatedTokens ?? 100)
    return {
      contextCapsuleID: `capsule-${calls.length}`,
      sourceCtxPackID: input.ctxPackID,
      label: `Capsule ${calls.length}`,
      contentHash: `capsule-hash-${calls.length}`,
      estimatedTokens,
    }
  }
  return { calls, materialize }
}

const TARGET = { instanceID: "instance-9", functionalityID: "functionality-3" }

function payload(overrides: Partial<CtxPackDragPayloadV1> = {}): CtxPackDragPayloadV1 {
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

async function expectRejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  let rejected = false
  try {
    await promise
  } catch (error) {
    rejected = true
    expect((error as Error).message).toBe(code)
    expect((error as Error & { code?: string }).code).toBe(code)
  }
  expect(rejected).toBe(true)
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys)
    return keys
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      keys.push(key)
      collectKeys(entry, keys)
    }
  }
  return keys
}

describe("ContextAttachmentStore", () => {
  test("same-workspace drop materializes once with the expected hash and host-resolved target identity", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await store.addCtxPack(payload(), TARGET)

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toEqual({
      workspaceID: "ws-1",
      ctxPackID: "pack-1",
      expectedContentHash: "hash-1",
      targetInstanceID: "instance-9",
      targetFunctionalityID: "functionality-3",
    })
    expect(store.attachments()).toHaveLength(1)
    expect(store.pendingCount()).toBe(0)
  })

  test("cross-workspace drop rejects with cross-workspace before any materialize call", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await expectRejectsWithCode(
      store.addCtxPack(payload({ workspaceID: "ws-other" }), TARGET),
      "cross-workspace",
    )
    expect(fake.calls).toHaveLength(0)
    expect(store.attachments()).toHaveLength(0)
    expect(store.pendingCount()).toBe(0)
  })

  test("drop with no active workspace rejects with cross-workspace before any materialize call", async () => {
    const [workspaceID] = createSignal<string | undefined>(undefined)
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await expectRejectsWithCode(store.addCtxPack(payload(), TARGET), "cross-workspace")
    expect(fake.calls).toHaveLength(0)
  })

  test("duplicate ctxPackID + contentHash resolves silently with no second materialize call", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)
    const pack = payload({ ctxPackID: "pack-7", contentHash: "hash-7" })

    await store.addCtxPack(pack, TARGET)
    await store.addCtxPack(pack, TARGET)

    expect(fake.calls).toHaveLength(1)
    expect(store.attachments()).toHaveLength(1)
  })

  test("simultaneous duplicate addCtxPack calls share one pending materialization", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    let release!: (result: ContextCapsuleMaterializeResult) => void
    const materialize: ContextCapsuleMaterialize = () =>
      new Promise<ContextCapsuleMaterializeResult>((resolve) => {
        release = resolve
      })
    const calls: ContextCapsuleMaterializeInput[] = []
    const wrapped: ContextCapsuleMaterialize = async (input) => {
      calls.push(input)
      return materialize(input)
    }
    const store = createContextAttachmentStore(workspaceID, wrapped)

    const addOne = store.addCtxPack(payload({ ctxPackID: "pack-dup", contentHash: "hash-dup" }), TARGET)
    const addTwo = store.addCtxPack(payload({ ctxPackID: "pack-dup", contentHash: "hash-dup" }), TARGET)

    expect(calls).toHaveLength(1)
    expect(store.pendingCount()).toBe(1)

    release({
      contextCapsuleID: "capsule-dupe",
      sourceCtxPackID: "pack-dup",
      label: "Duplicated capsule",
      contentHash: "hash-dupe",
      estimatedTokens: 100,
    })

    await Promise.all([addOne, addTwo])

    expect(calls).toHaveLength(1)
    expect(store.attachments()).toHaveLength(1)
    expect(store.pendingCount()).toBe(0)
    expect(store.attachments()[0]?.contextCapsuleID).toBe("capsule-dupe")
  })

  test(`the ${MAX_CONTEXT_ATTACHMENTS + 1}th attachment rejects with attachment-limit`, async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize({ estimatedTokens: 700 })
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    for (let i = 0; i < MAX_CONTEXT_ATTACHMENTS; i++) {
      await store.addCtxPack(
        payload({ ctxPackID: `pack-${i}`, contentHash: `hash-${i}`, estimatedTokens: 700 }),
        TARGET,
      )
    }
    // Count limit fires before the token limit even though 8×700+700 > 6000.
    await expectRejectsWithCode(
      store.addCtxPack(
        payload({ ctxPackID: "pack-overflow", contentHash: "hash-overflow", estimatedTokens: 700 }),
        TARGET,
      ),
      "attachment-limit",
    )
    expect(fake.calls).toHaveLength(MAX_CONTEXT_ATTACHMENTS)
    expect(store.attachments()).toHaveLength(MAX_CONTEXT_ATTACHMENTS)
  })

  test("aggregate over the token budget rejects with token-limit and leaves the store intact", async () => {
    expect(7 * 800).toBeLessThan(MAX_CONTEXT_ATTACHMENT_TOKENS)
    expect(8 * 800).toBeGreaterThan(MAX_CONTEXT_ATTACHMENT_TOKENS)
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize({ estimatedTokens: 800 })
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    for (let i = 0; i < 7; i++) {
      await store.addCtxPack(
        payload({ ctxPackID: `pack-${i}`, contentHash: `hash-${i}`, estimatedTokens: 800 }),
        TARGET,
      )
    }
    expect(store.totalEstimatedTokens()).toBe(5600)

    await expectRejectsWithCode(
      store.addCtxPack(
        payload({ ctxPackID: "pack-big", contentHash: "hash-big", estimatedTokens: 800 }),
        TARGET,
      ),
      "token-limit",
    )
    expect(store.attachments()).toHaveLength(7)
    expect(store.totalEstimatedTokens()).toBe(5600)
    expect(fake.calls).toHaveLength(7)
    expect(store.pendingCount()).toBe(0)
  })

  test("materialize rejection leaves no ready item, zero pending, and rejects with materialize-failed", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize({ rejectWith: new Error("boom") })
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await expectRejectsWithCode(store.addCtxPack(payload(), TARGET), "materialize-failed")
    expect(store.attachments()).toHaveLength(0)
    expect(store.pendingCount()).toBe(0)
  })

  test("a stable error code thrown by materialize passes through (offline)", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize({ rejectWith: new Error("offline") })
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await expectRejectsWithCode(store.addCtxPack(payload(), TARGET), "offline")
    expect(store.attachments()).toHaveLength(0)
  })

  test("pending items are internal: hidden from attachments() but counted by pendingCount()", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    let release!: (result: ContextCapsuleMaterializeResult) => void
    const materialize: ContextCapsuleMaterialize = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const store = createContextAttachmentStore(workspaceID, materialize)

    const pending = store.addCtxPack(payload(), TARGET)
    expect(store.attachments()).toHaveLength(0)
    expect(store.pendingCount()).toBe(1)

    release({
      contextCapsuleID: "capsule-deferred",
      sourceCtxPackID: "pack-1",
      label: "Deferred capsule",
      contentHash: "hash-deferred",
      estimatedTokens: 100,
    })
    await pending

    expect(store.pendingCount()).toBe(0)
    expect(store.attachments()).toHaveLength(1)
    expect(store.attachments()[0].contextCapsuleID).toBe("capsule-deferred")
  })

  test("success stores only ContextAttachmentDraft fields — no payload text rides along", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await store.addCtxPack(payload({ label: "Project brief" }), TARGET)

    const attachment = store.attachments()[0]
    expect(attachment).toBeDefined()
    expect(Object.keys(attachment).sort()).toEqual(
      [
        "clientAttachmentID",
        "contentHash",
        "contextCapsuleID",
        "errorCode",
        "estimatedTokens",
        "kind",
        "label",
        "source",
        "status",
      ].sort(),
    )
    expect(Object.keys(attachment.source).sort()).toEqual(["contentHash", "ctxPackID", "kind"].sort())
    const keys = collectKeys(attachment)
    expect(keys).not.toContain("text")
    expect(keys).not.toContain("selectedText")
    expect(keys).not.toContain("text_content")
    expect(keys).not.toContain("fragment")
    expect(keys).not.toContain("authorization")
  })

  test("remove deletes by clientAttachmentID", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await store.addCtxPack(payload({ ctxPackID: "pack-a", contentHash: "hash-a" }), TARGET)
    await store.addCtxPack(payload({ ctxPackID: "pack-b", contentHash: "hash-b" }), TARGET)
    const [first] = store.attachments()

    store.remove(first.clientAttachmentID)

    expect(store.attachments()).toHaveLength(1)
    expect(store.attachments()[0].clientAttachmentID).not.toBe(first.clientAttachmentID)
  })

  test("clearAfterAdmission and restoreAfterFailure round trip", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await store.addCtxPack(payload({ ctxPackID: "pack-a", contentHash: "hash-a" }), TARGET)
    await store.addCtxPack(payload({ ctxPackID: "pack-b", contentHash: "hash-b" }), TARGET)
    const snapshot = store.attachments()

    store.clearAfterAdmission()
    expect(store.attachments()).toHaveLength(0)
    expect(store.pendingCount()).toBe(0)
    expect(store.totalEstimatedTokens()).toBe(0)

    store.restoreAfterFailure(snapshot)
    expect(store.attachments()).toEqual(snapshot)
    expect(store.pendingCount()).toBe(0)
  })

  test("toSessionContextAttachmentInput maps exactly the frozen shape", async () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    const store = createContextAttachmentStore(workspaceID, fake.materialize)

    await store.addCtxPack(payload({ ctxPackID: "pack-1", contentHash: "hash-1" }), TARGET)
    const attachment = store.attachments()[0]

    const input = toSessionContextAttachmentInput(attachment)
    expect(input).toEqual({
      contextCapsuleID: attachment.contextCapsuleID,
      label: attachment.label,
      contentHash: attachment.contentHash,
      source: { kind: "ctxpack", ctxPackID: "pack-1" },
    })
    expect(Object.keys(input).sort()).toEqual(["contentHash", "contextCapsuleID", "label", "source"].sort())
    expect(Object.keys(input.source).sort()).toEqual(["kind", "ctxPackID"].sort())
  })
})

describe("ContextAttachmentStoreProvider", () => {
  test("exposes the store through context", () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    let captured: ContextAttachmentStore | undefined

    const Probe = () => {
      captured = useContextAttachmentStore()
      return document.createElement("div")
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    let node!: HTMLElement
    const dispose = createRoot((disposeRoot) => {
      node = ContextAttachmentStoreProvider({
        workspaceID,
        materialize: fake.materialize,
        get children() {
          return Probe()
        },
      }) as HTMLElement
      container.appendChild(node)
      return disposeRoot
    })

    expect(captured).toBeDefined()
    expect(captured?.attachments()).toHaveLength(0)
    dispose()
  })
})

describe("ContextAttachmentStore optional accessors", () => {
  test("inside provider, optional accessor returns the same store instance", () => {
    const [workspaceID] = createSignal<string | undefined>("ws-1")
    const fake = fakeMaterialize()
    let direct: ContextAttachmentStore | undefined
    let optional: ContextAttachmentStore | undefined

    const Probe = () => {
      direct = useContextAttachmentStore()
      optional = useOptionalContextAttachmentStore()
      return document.createElement("div")
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    let node!: HTMLElement
    const dispose = createRoot((disposeRoot) => {
      node = ContextAttachmentStoreProvider({
        workspaceID,
        materialize: fake.materialize,
        get children() {
          return Probe()
        },
      }) as HTMLElement
      container.appendChild(node)
      return disposeRoot
    })

    expect(optional).toBe(direct)
    expect(optional).toBeDefined()
    expect(optional?.attachments()).toEqual([])
    dispose()
  })

  test("missing provider returns undefined from strict-or-null accessor", () => {
    let captured: ContextAttachmentStore | undefined
    let orNullValue: ReturnType<typeof useContextAttachmentStoreOrNull> | "untouched" = "untouched"

    const Probe = () => {
      captured = useOptionalContextAttachmentStore()
      orNullValue = useContextAttachmentStoreOrNull()
      return document.createElement("div")
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    let node!: HTMLElement
    const dispose = createRoot((disposeRoot) => {
      node = Probe() as HTMLElement
      container.appendChild(node)
      return disposeRoot
    })

    expect(captured).toBeDefined()
    expect(orNullValue).toBeUndefined()
    expect(captured?.attachments()).toEqual([])
    expect(captured?.totalEstimatedTokens()).toBe(0)
    expect(captured?.pendingCount()).toBe(0)
    dispose()
  })

  test("missing provider returns a no-op store instead of throwing", () => {
    let captured: ContextAttachmentStore | undefined
    const Probe = () => {
      captured = useOptionalContextAttachmentStore()
      return document.createElement("div")
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    let node!: HTMLElement
    const dispose = createRoot((disposeRoot) => {
      node = Probe() as HTMLElement
      container.appendChild(node)
      return disposeRoot
    })

    expect(captured).toBeDefined()
    expect(captured?.attachments()).toEqual([])
    expect(captured?.totalEstimatedTokens()).toBe(0)
    expect(captured?.pendingCount()).toBe(0)
    expect(typeof captured?.addCtxPack).toBe("function")
    dispose()
  })
})
