import { expect, test } from "bun:test"
import {
  builtinLayouts,
  createCustomLayout,
  createWorkspace,
  DEFAULT_LAYOUT_ID,
  DEFAULT_PANELS,
  layoutById,
  layoutFeature,
  layoutName,
  layoutOptions,
  layoutSettings,
  resolveLayout,
  updateWorkspace,
} from "./model"

test("ships code and unreal-viewer builtin layouts", () => {
  expect(builtinLayouts.map((layout) => layout.id)).toEqual(["code", "unreal-viewer"])
  expect(builtinLayouts[0]?.layout).toBe("v2")
  expect(builtinLayouts[1]?.panels.fileTree).toBeFalse()
  expect(builtinLayouts[1]?.features.viewer).toBeTrue()
})

test("resolves builtin layouts before custom ones", () => {
  const custom = [{ ...builtinLayouts[0]!, name: "Shadowed" }]
  expect(layoutById("code", custom)?.name).toBe("Code")
})

test("resolves the default layout for unknown ids", () => {
  expect(resolveLayout("missing", [])).toBe(builtinLayouts[0])
  expect(resolveLayout(undefined, []).id).toBe(DEFAULT_LAYOUT_ID)
})

test("exposes layout options with builtins first", () => {
  const custom = createCustomLayout({ name: "Arcade", layout: "v1" })
  const ids = layoutOptions([custom]).map((layout) => layout.id)
  expect(ids).toEqual(["code", "unreal-viewer", custom.id])
  expect(layoutName(custom.id, [custom])).toBe("Arcade")
})

test("reads layout feature flags", () => {
  expect(layoutFeature("unreal-viewer", [], "viewer")).toBeTrue()
  expect(layoutFeature("unreal-viewer", [], "composer")).toBeFalse()
  expect(layoutFeature("code", [], "viewer")).toBeFalse()
})

test("creates workspaces with trimmed names and deduplicated inputs", () => {
  const workspace = createWorkspace({
    name: "  My Unreal Workspace  ",
    directories: ["D:/UE57", "D:/UE57", "D:/UnrealProjects"],
    plugins: ["unreal", "unreal", "viewer"],
  })
  expect(workspace.name).toBe("My Unreal Workspace")
  expect(workspace.directories).toEqual(["D:/UE57", "D:/UnrealProjects"])
  expect(workspace.plugins).toEqual(["unreal", "viewer"])
  expect(workspace.layout).toBe(DEFAULT_LAYOUT_ID)
})

test("defaults workspace names and layouts", () => {
  const workspace = createWorkspace({ name: "   " })
  expect(workspace.name).toBe("Untitled")
  expect(workspace.directories).toEqual([])
  expect(workspace.plugins).toEqual([])
})

test("updates workspaces while preserving identity", () => {
  const workspace = createWorkspace({ name: "Before", directories: ["D:/UE57"] })
  const updated = updateWorkspace(workspace, {
    name: "After",
    directories: ["D:/UE57", "D:/UE57_v3"],
    layout: "unreal-viewer",
  })
  expect(updated.id).toBe(workspace.id)
  expect(updated.name).toBe("After")
  expect(updated.directories).toEqual(["D:/UE57", "D:/UE57_v3"])
  expect(updated.layout).toBe("unreal-viewer")
})

test("ignores blank names when updating", () => {
  const workspace = createWorkspace({ name: "Keep" })
  expect(updateWorkspace(workspace, { name: "   " }).name).toBe("Keep")
})

test("configures the OperatingAgent model per workspace", () => {
  const workspace = createWorkspace({ name: "Agent", operatingAgent: "anthropic/claude-sonnet-4" })
  expect(workspace.operatingAgent).toBe("anthropic/claude-sonnet-4")

  const updated = updateWorkspace(workspace, { operatingAgent: "openai/gpt-5.5" })
  expect(updated.operatingAgent).toBe("openai/gpt-5.5")
})

test("clears the OperatingAgent when unset", () => {
  const workspace = createWorkspace({ name: "Agent", operatingAgent: "openai/gpt-5.5" })
  expect(updateWorkspace(workspace, { operatingAgent: "" }).operatingAgent).toBeUndefined()
  expect(updateWorkspace(workspace, { operatingAgent: undefined }).operatingAgent).toBe("openai/gpt-5.5")
})

test("creates custom layouts over the default panel baseline", () => {
  const custom = createCustomLayout({
    name: "Viewer",
    layout: "v1",
    panels: { ...DEFAULT_PANELS, fileTree: false },
    features: { viewer: true },
  })
  expect(custom.layout).toBe("v1")
  expect(custom.panels.fileTree).toBeFalse()
  expect(custom.panels.terminal).toBeTrue()
  expect(custom.features.viewer).toBeTrue()
})

test("maps layouts onto settings targets", () => {
  expect(layoutSettings(builtinLayouts[0]!)).toEqual({
    newLayoutDesigns: true,
    showFileTree: true,
    showTerminal: true,
    showSearch: true,
    showStatus: true,
    showNavigation: true,
  })
  expect(layoutSettings(builtinLayouts[1]!)).toEqual({
    newLayoutDesigns: true,
    showFileTree: false,
    showTerminal: true,
    showSearch: false,
    showStatus: true,
    showNavigation: false,
  })
})
