import { describe, expect, test } from "bun:test"

import type { BlockRuntimeServices, CanvasBlockDescriptor } from "../contracts"
import { createBlockLocalViewStore, type BlockLocalViewStore } from "../local-view-store"
import { BLOCK_REGISTRATIONS } from "./index"
import { builtinStaticRegistrations, notesRuntimeRegistration, voiceRuntimeRegistration } from "./static-blocks"

const makeServices = (localView: BlockLocalViewStore, workspaceEpoch = 0): BlockRuntimeServices => ({
  serverSDK: (() => undefined) as never,
  eventRouter: undefined as never,
  workspace: {
    id: () => "workspace-a",
    epoch: () => workspaceEpoch,
    connected: () => true,
    awaitDescriptorPersisted: async () => {},
  },
  localView,
})

const notesBlock: CanvasBlockDescriptor = {
  id: "block-notes",
  functionalityID: "builtin:notes",
  transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
}

const voiceBlock: CanvasBlockDescriptor = {
  id: "block-voice",
  functionalityID: "builtin:voice",
  transform: { x: 0, y: 0, w: 0, h: 0, z: 0 },
}

const signal = new AbortController().signal

describe("notesRuntimeRegistration", () => {
  test("waits for a workspace identity before consuming legacy state", async () => {
    localStorage.clear()
    const startupStore = createBlockLocalViewStore()
    startupStore.write("block-notes", {
      text: "startup legacy draft",
      messages: [{ id: "startup-legacy", text: "Startup thought", createdAt: 25 }],
    })
    expect(startupStore.flush?.()).toBe(true)

    const startup = await notesRuntimeRegistration.resolve({
      workspaceID: "",
      block: notesBlock,
      services: makeServices(startupStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: startup, projection: undefined, localView: startupStore }),
    ).toEqual({
      workspaceID: "",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [],
    })

    const workspaceStore = createBlockLocalViewStore()
    const workspaceA = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services: makeServices(workspaceStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: workspaceA, projection: undefined, localView: workspaceStore }),
    ).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "startup legacy draft",
      messages: [{ id: "startup-legacy", text: "Startup thought", createdAt: 25 }],
    })

    const migratedStore = createBlockLocalViewStore()
    const reloadedA = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services: makeServices(migratedStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: reloadedA, projection: undefined, localView: migratedStore }),
    ).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "startup legacy draft",
      messages: [{ id: "startup-legacy", text: "Startup thought", createdAt: 25 }],
    })

    const workspaceB = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-b",
      block: notesBlock,
      services: makeServices(migratedStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: workspaceB, projection: undefined, localView: migratedStore }),
    ).toEqual({
      workspaceID: "workspace-b",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [],
    })
  })

  test("rejects draft and submit commands without a workspace identity", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)
    const startup = await notesRuntimeRegistration.resolve({
      workspaceID: "",
      block: notesBlock,
      services,
      signal,
    })

    await expect(
      notesRuntimeRegistration.dispatch?.({
        resolved: startup,
        command: { type: "set-draft", text: "Do not persist at startup" },
        services,
        signal,
      }),
    ).rejects.toThrow("Cannot update notes without a workspace")
    await expect(
      notesRuntimeRegistration.dispatch?.({
        resolved: startup,
        command: { type: "submit", id: "startup-submit", createdAt: 30 },
        services,
        signal,
      }),
    ).rejects.toThrow("Cannot update notes without a workspace")
    expect(localView.read("notes::block-notes")).toBeUndefined()
  })

  test("reads legacy state while keeping migrated notes isolated by workspace", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)
    localView.write("block-notes", {
      text: "legacy draft",
      messages: [{ id: "legacy-note", text: "Legacy thought", createdAt: 50 }],
    })
    expect(localView.flush?.()).toBe(true)

    const workspaceA = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })

    expect(notesRuntimeRegistration.select({ resolved: workspaceA, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "legacy draft",
      messages: [{ id: "legacy-note", text: "Legacy thought", createdAt: 50 }],
    })

    const migratedStore = createBlockLocalViewStore()
    const reloadedA = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services: makeServices(migratedStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: reloadedA, projection: undefined, localView: migratedStore }),
    ).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "legacy draft",
      messages: [{ id: "legacy-note", text: "Legacy thought", createdAt: 50 }],
    })

    const workspaceB = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-b",
      block: notesBlock,
      services: makeServices(migratedStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: workspaceB, projection: undefined, localView: migratedStore }),
    ).toEqual({
      workspaceID: "workspace-b",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [],
    })

    await notesRuntimeRegistration.dispatch?.({
      resolved: workspaceA,
      command: { type: "set-draft", text: "Workspace A draft" },
      services,
      signal,
    })

    const migratedA = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: migratedA, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "Workspace A draft",
      messages: [{ id: "legacy-note", text: "Legacy thought", createdAt: 50 }],
    })

    const replacementServices = makeServices(localView, 1)
    const replacement = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services: replacementServices,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: replacement, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 1,
      blockID: "block-notes",
      draft: "Workspace A draft",
      messages: [{ id: "legacy-note", text: "Legacy thought", createdAt: 50 }],
    })

    const otherBlock = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: { ...notesBlock, id: "block-notes-b" },
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: otherBlock, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes-b",
      draft: "",
      messages: [],
    })
  })

  test("uses the latest stored state for sequential submits from one resolved snapshot", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })

    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "  First thought  " },
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "submit", id: "note-1", createdAt: 100 },
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "Second thought\n" },
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "submit", id: "note-2", createdAt: 200 },
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "Keep this newer draft" },
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "submit", id: "note-2", createdAt: 200 },
      services,
      signal,
    })

    const submitted = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    const expected = {
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "Keep this newer draft",
      messages: [
        { id: "note-1", text: "First thought", createdAt: 100 },
        { id: "note-2", text: "Second thought", createdAt: 200 },
      ],
    }
    expect(notesRuntimeRegistration.select({ resolved: submitted, projection: undefined, localView })).toEqual(expected)
  })

  test("deduplicates concurrent retries of the same submit command", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "Concurrent thought" },
      services,
      signal,
    })
    const command = { type: "submit", id: "note-concurrent", createdAt: 300 } as const
    await Promise.all([
      notesRuntimeRegistration.dispatch?.({ resolved: initial, command, services, signal }),
      notesRuntimeRegistration.dispatch?.({ resolved: initial, command, services, signal }),
    ])

    const submitted = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: submitted, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-a",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [{ id: "note-concurrent", text: "Concurrent thought", createdAt: 300 }],
    })
  })

  test("restores the draft and rejects when submitted state cannot be persisted", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-failing",
      block: notesBlock,
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "Do not lose this" },
      services,
      signal,
    })
    const drafted = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-failing",
      block: notesBlock,
      services,
      signal,
    })
    localView.flush = () => false

    await expect(
      notesRuntimeRegistration.dispatch?.({
        resolved: drafted,
        command: { type: "submit", id: "note-failing", createdAt: 350 },
        services,
        signal,
      }),
    ).rejects.toThrow("Failed to persist note")

    const after = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-failing",
      block: notesBlock,
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: after, projection: undefined, localView })).toEqual({
      workspaceID: "workspace-failing",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "Do not lose this",
      messages: [],
    })
  })

  test("keeps drafts debounced and flushes a submitted message for immediate reload", async () => {
    localStorage.clear()
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-persisted",
      block: notesBlock,
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-draft", text: "Persisted thought" },
      services,
      signal,
    })
    const drafted = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-persisted",
      block: notesBlock,
      services,
      signal,
    })

    const draftReloadStore = createBlockLocalViewStore()
    const draftReload = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-persisted",
      block: notesBlock,
      services: makeServices(draftReloadStore),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: draftReload, projection: undefined, localView: draftReloadStore }),
    ).toEqual({
      workspaceID: "workspace-persisted",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [],
    })

    await notesRuntimeRegistration.dispatch?.({
      resolved: drafted,
      command: { type: "submit", id: "note-persisted", createdAt: 400 },
      services,
      signal,
    })

    const freshLocalView = createBlockLocalViewStore()
    const reloaded = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-persisted",
      block: notesBlock,
      services: makeServices(freshLocalView),
      signal,
    })
    expect(
      notesRuntimeRegistration.select({ resolved: reloaded, projection: undefined, localView: freshLocalView }),
    ).toEqual({
      workspaceID: "workspace-persisted",
      workspaceEpoch: 0,
      blockID: "block-notes",
      draft: "",
      messages: [{ id: "note-persisted", text: "Persisted thought", createdAt: 400 }],
    })
  })
})

describe("voiceRuntimeRegistration", () => {
  test("toggle flips listening state through the local-view store", async () => {
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await voiceRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: voiceBlock,
      services,
      signal,
    })
    expect(voiceRuntimeRegistration.select({ resolved: initial, projection: undefined, localView })).toEqual({
      listening: false,
    })

    await voiceRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "toggle" },
      services,
      signal,
    })

    const listening = await voiceRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: voiceBlock,
      services,
      signal,
    })
    expect(voiceRuntimeRegistration.select({ resolved: listening, projection: undefined, localView })).toEqual({
      listening: true,
    })

    await voiceRuntimeRegistration.dispatch?.({
      resolved: listening,
      command: { type: "toggle" },
      services,
      signal,
    })

    const idle = await voiceRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: voiceBlock,
      services,
      signal,
    })
    expect(voiceRuntimeRegistration.select({ resolved: idle, projection: undefined, localView })).toEqual({
      listening: false,
    })
  })
})

describe("builtinStaticRegistrations", () => {
  test("canonical registrations expose matching functionality and one runtime mode", () => {
    Object.entries(BLOCK_REGISTRATIONS).forEach(([functionalityID, registration]) => {
      expect(registration.functionalityID).toBe(functionalityID)
      expect(["native", "projected", "local", "static"]).toContain(registration.mode)
    })
  })

  test("native chat and static informational blocks have explicit modes", () => {
    expect(builtinStaticRegistrations["builtin:chat"]?.mode).toBe("native")
    expect(builtinStaticRegistrations["builtin:context"]?.mode).toBe("static")
    expect(builtinStaticRegistrations["builtin:tools"]?.mode).toBe("static")
    expect(builtinStaticRegistrations["builtin:files"]?.mode).toBe("static")
  })

  test("domain-backed and unknown functionality are not static registrations", () => {
    expect(builtinStaticRegistrations["builtin:chat-relay"]).toBeUndefined()
    expect(builtinStaticRegistrations["builtin:master-agent"]).toBeUndefined()
    expect(builtinStaticRegistrations["plugin:missing"]).toBeUndefined()
  })
})
