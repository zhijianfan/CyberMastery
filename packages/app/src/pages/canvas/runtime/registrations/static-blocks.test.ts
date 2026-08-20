import { describe, expect, test } from "bun:test"

import type { BlockRuntimeServices, CanvasBlockDescriptor } from "../contracts"
import { createBlockLocalViewStore, type BlockLocalViewStore } from "../local-view-store"
import { BLOCK_REGISTRATIONS } from "./index"
import { builtinStaticRegistrations, notesRuntimeRegistration, voiceRuntimeRegistration } from "./static-blocks"

const makeServices = (localView: BlockLocalViewStore): BlockRuntimeServices => ({
  serverSDK: (() => undefined) as never,
  eventRouter: undefined as never,
  workspace: {
    id: () => "workspace-a",
    epoch: () => 0,
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
  test("set-text round-trips through the local-view store", async () => {
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const initial = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: initial, projection: undefined, localView })).toEqual({
      text: "",
    })

    await notesRuntimeRegistration.dispatch?.({
      resolved: initial,
      command: { type: "set-text", text: "remember this" },
      services,
      signal,
    })

    const after = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: after, projection: undefined, localView })).toEqual({
      text: "remember this",
    })
    expect(localView.read<{ text?: string }>("block-notes")?.text).toBe("remember this")
  })

  test("text stays block-scoped per block id", async () => {
    const localView = createBlockLocalViewStore()
    const services = makeServices(localView)

    const first = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: notesBlock,
      services,
      signal,
    })
    await notesRuntimeRegistration.dispatch?.({
      resolved: first,
      command: { type: "set-text", text: "draft a" },
      services,
      signal,
    })

    const second = await notesRuntimeRegistration.resolve({
      workspaceID: "workspace-a",
      block: { ...notesBlock, id: "block-notes-b" },
      services,
      signal,
    })
    expect(notesRuntimeRegistration.select({ resolved: second, projection: undefined, localView })).toEqual({
      text: "",
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
