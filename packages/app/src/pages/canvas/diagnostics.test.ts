import { describe, expect, test } from "bun:test"
import { collectCanvasDiagnostics, type CanvasDiagnosticsSource } from "./diagnostics"

function fakeSource(overrides: Partial<CanvasDiagnosticsSource> = {}): CanvasDiagnosticsSource {
  return {
    blocks: () => [
      { id: "b1", type: "chat-relay" },
      { id: "b2", type: "notes" },
      { id: "b3", type: "tools" },
    ],
    functionalityIDFor: (type) => `builtin:${type}`,
    registrationModeFor: (blockID) => (blockID === "b1" ? "native" : blockID === "b2" ? "local" : "none"),
    hostStatusFor: (blockID) => (blockID === "b1" ? "ready" : undefined),
    localViewKeysFor: (blockID) => (blockID === "b1" ? ["draft"] : blockID === "b2" ? ["text"] : []),
    workspace: {
      id: () => "ws-1",
      epoch: () => 3,
      connected: () => true,
      dirty: () => false,
    },
    ...overrides,
  }
}

describe("collectCanvasDiagnostics", () => {
  test("reports per-block registration mode and workspace fields", () => {
    const diagnostics = collectCanvasDiagnostics(fakeSource())
    expect(diagnostics.workspace).toEqual({ id: "ws-1", epoch: 3, connected: true, dirty: false })
    expect(diagnostics.blocks).toEqual([
      {
        blockID: "b1",
        functionalityID: "builtin:chat-relay",
        registrationMode: "native",
        hostStatus: "ready",
        localViewKeys: ["draft"],
      },
      {
        blockID: "b2",
        functionalityID: "builtin:notes",
        registrationMode: "local",
        hostStatus: undefined,
        localViewKeys: ["text"],
      },
      {
        blockID: "b3",
        functionalityID: "builtin:tools",
        registrationMode: "none",
        hostStatus: undefined,
        localViewKeys: [],
      },
    ])
  })

  test("falls back to canvas globals without a source and never throws", () => {
    ;(globalThis as { __CANVAS_INTEGRATION_STATE__?: unknown }).__CANVAS_INTEGRATION_STATE__ = {
      blocks: [{ id: "g1", type: "notes" }],
    }
    const diagnostics = collectCanvasDiagnostics()
    expect(JSON.stringify(diagnostics)).toContain("g1")
    expect(diagnostics.blocks[0]!.registrationMode).toBe("none")
    expect(diagnostics.workspace.connected).toBe(false)
  })

  test("handles missing source blocks gracefully", () => {
    const diagnostics = collectCanvasDiagnostics(fakeSource({ blocks: () => [] }))
    expect(diagnostics.blocks).toEqual([])
  })
})
