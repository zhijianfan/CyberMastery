import { beforeEach, describe, expect, test } from "bun:test"
import {
  CANVAS_DESCRIPTOR_STORAGE_KEY,
  CANVAS_LOCAL_VIEW_STORAGE_KEY,
  CANVAS_WORKSPACE_ID_STORAGE_KEY,
  mountCanvasWithDescriptors,
  readCanvasDescriptor,
  readCanvasLocalViewState,
  seedCanvasDescriptor,
} from "./browser-helpers"
import { createFakeHostBindingPort } from "./fake-host-binding-port"
import { createFakeServerEventBus } from "./fake-server-event-bus"
import { createFakeSessionSurfaceState } from "./fake-session-surface-state"
import { createFakeWorkspaceAPI } from "./fake-workspace-api"

function mountMarker() {
  const marker = document.createElement("span")
  marker.setAttribute("data-marker", "ready")
  document.body.appendChild(marker)
  return marker
}

describe("track fixture examples", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    localStorage.clear()
  })

  test("C shape: event-router invalidation can be observed deterministically", () => {
    const bus = createFakeServerEventBus()
    const seen: Array<{ id: string; revision: number }> = []

    bus.listen((entry) => {
      seen.push({ id: entry.id, revision: entry.revision })
    })

    bus.start()
    bus.emit({ type: "workspace.functionality.instance.changed", details: { type: "workspace.functionality.instance.changed" } })
    expect(bus.getRevision()).toBe(1)
    expect(seen).toHaveLength(1)

    bus.pause()
    bus.emit({ type: "workspace.functionality.instance.changed", details: { type: "workspace.functionality.instance.changed" } })
    expect(bus.queuedCount()).toBe(1)
    expect(seen).toHaveLength(1)

    bus.resume()
    expect(seen).toHaveLength(2)
    expect(bus.getEventId()).toContain("000002")
  })

  test("D shape: host mount/dispose removes projections while preserving fixtures", async () => {
    const port = createFakeHostBindingPort({ workspaceID: "ws-1", directory: "C:/proj" })

    expect(port.getBinding("ma-1")).toBeUndefined()

    const ensured = await port.ensure({ workspaceID: "ws-1", blockID: "ma-1" })
    expect(ensured.data).toMatchObject({
      status: "bound",
      binding: { blockID: "ma-1", generation: 1, revision: 1 },
    })
    expect(port.getBinding("ma-1")?.sessionID).toBe("sess-ma-1-1")

    port.release({ blockID: "ma-1" })
    expect(port.getBinding("ma-1")).toBeUndefined()
    expect(port.getCalls).toHaveLength(0)
    expect(port.ensureCalls).toHaveLength(1)
    expect(port.resetCalls).toHaveLength(0)
  })

  test("E shape: workspace recovery path is injectable and reset-safe", async () => {
    const api = createFakeWorkspaceAPI({ workspaceID: "ws-recover", model: "acme:primary" })
    expect(api.getCurrentWorkspaceID()).toBe("ws-recover")

    const first = await api.client.workspace.get()
    expect(first.data.id).toBe("ws-recover")

    api.deleteCurrentWorkspace()
    await expect(api.client.workspace.get()).rejects.toMatchObject({ code: "not-found" })

    api.resetCurrentWorkspace()
    const second = await api.client.workspace.get()
    expect(second.data.id).toBe("ws-recover")
    expect(api.workspaceEpoch()).toBe(1)
  })

  test("F shape: session-binding ensure/get/reset uses expected CAS payload", async () => {
    const port = createFakeHostBindingPort({ workspaceID: "ws-1", directory: "C:/proj" })

    const ensured = await port.ensure({ workspaceID: "ws-1", blockID: "ma-bind" })
    expect(ensured.data).toMatchObject({
      status: "bound",
      binding: { blockID: "ma-bind", generation: 1, revision: 1 },
    })

    const fetched = await port.get({ workspaceID: "ws-1", blockID: "ma-bind" })
    expect(fetched.data).toMatchObject({
      status: "bound",
      binding: { sessionID: "sess-ma-bind-1" },
    })

    const stale = await port.reset({
      workspaceID: "ws-1",
      blockID: "ma-bind",
      masterAgentResetPayload: { expectedSessionID: "wrong", expectedRevision: 999 },
    })
    expect(stale.data).toMatchObject({ status: "stale" })

    const reset = await port.reset({
      workspaceID: "ws-1",
      blockID: "ma-bind",
      masterAgentResetPayload: { expectedSessionID: "sess-ma-bind-1", expectedRevision: 1 },
    })
    expect(reset.data).toMatchObject({
      status: "reset",
      binding: { sessionID: "sess-ma-bind-2" },
    })
  })

  // @skip pending-h
  test.skip("H shape: adapter command routing and permission flow once public API lands", () => {
    expect(true).toBeTrue()
  })

  // @skip pending-i
  test.skip("I shape: runtime identity handoff and disposal once public API lands", () => {
    expect(true).toBeTrue()
  })

  test("fixture layer: local view cache and descriptor cache remain separate keys", async () => {
    const state = createFakeSessionSurfaceState()
    const marker = mountMarker()

    seedCanvasDescriptor(
      [{ id: "ma-1", functionality: "builtin:master-agent", transform: { x: 1, y: 2, w: 3, h: 4, z: 5 } }],
      CANVAS_DESCRIPTOR_STORAGE_KEY,
      { x: 1, y: 2, scale: 1, editing: false },
    )
    localStorage.setItem(CANVAS_LOCAL_VIEW_STORAGE_KEY, JSON.stringify({ "ma-1": { selected: true } }))
    localStorage.setItem(CANVAS_WORKSPACE_ID_STORAGE_KEY, JSON.stringify({ workspaceID: "ws-1" }))

    state.setStatus("connecting")
    expect(state.status()).toBe("connecting")
    expect(marker.getAttribute("data-marker")).toBe("ready")

    const descriptor = readCanvasDescriptor()
    expect(descriptor?.blocks.length).toBe(1)
    expect(readCanvasLocalViewState()).toMatchObject({ "ma-1": { selected: true } })

    const root = mountCanvasWithDescriptors(
      () => {
        const node = document.createElement("div")
        node.textContent = "canvas-root"
        return node
      },
      {
        blocks: descriptor?.blocks ?? [],
      },
    )
    expect(root.textContent).toBe("canvas-root")
  })
})
