import { expect, test } from "bun:test"
import {
  builtinEnvironments,
  createCustomEnvironment,
  createWorkspace,
  DEFAULT_ENVIRONMENT_ID,
  environmentById,
  environmentFeature,
  environmentName,
  environmentOptions,
  environmentSettings,
  resolveEnvironment,
  updateWorkspace,
} from "./model"

test("ships code and unreal-viewer builtin environments", () => {
  expect(builtinEnvironments.map((environment) => environment.id)).toEqual(["code", "unreal-viewer"])
  expect(builtinEnvironments[0]?.layout).toBe("v2")
  expect(builtinEnvironments[1]?.panels.fileTree).toBeFalse()
  expect(builtinEnvironments[1]?.features.viewer).toBeTrue()
})

test("resolves builtin environments before custom ones", () => {
  const custom = [{ ...builtinEnvironments[0]!, name: "Shadowed" }]
  expect(environmentById("code", custom)?.name).toBe("Code")
})

test("resolves the default environment for unknown ids", () => {
  expect(resolveEnvironment("missing", [])).toBe(builtinEnvironments[0])
  expect(resolveEnvironment(undefined, []).id).toBe(DEFAULT_ENVIRONMENT_ID)
})

test("exposes environment options with builtins first", () => {
  const custom = createCustomEnvironment({ name: "Arcade", layout: "v1" })
  const ids = environmentOptions([custom]).map((environment) => environment.id)
  expect(ids).toEqual(["code", "unreal-viewer", custom.id])
  expect(environmentName(custom.id, [custom])).toBe("Arcade")
})

test("reads environment feature flags", () => {
  expect(environmentFeature("unreal-viewer", [], "viewer")).toBeTrue()
  expect(environmentFeature("unreal-viewer", [], "composer")).toBeFalse()
  expect(environmentFeature("code", [], "viewer")).toBeFalse()
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
  expect(workspace.environment).toBe(DEFAULT_ENVIRONMENT_ID)
})

test("defaults workspace names and environments", () => {
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
    environment: "unreal-viewer",
  })
  expect(updated.id).toBe(workspace.id)
  expect(updated.name).toBe("After")
  expect(updated.directories).toEqual(["D:/UE57", "D:/UE57_v3"])
  expect(updated.environment).toBe("unreal-viewer")
})

test("ignores blank names when updating", () => {
  const workspace = createWorkspace({ name: "Keep" })
  expect(updateWorkspace(workspace, { name: "   " }).name).toBe("Keep")
})

test("creates custom environments over the default panel baseline", () => {
  const custom = createCustomEnvironment({
    name: "Viewer",
    layout: "v1",
    panels: { fileTree: false },
    features: { viewer: true },
  })
  expect(custom.layout).toBe("v1")
  expect(custom.panels.fileTree).toBeFalse()
  expect(custom.panels.terminal).toBeTrue()
  expect(custom.features.viewer).toBeTrue()
})

test("maps environments onto settings targets", () => {
  expect(environmentSettings(builtinEnvironments[0]!)).toEqual({
    newLayoutDesigns: true,
    showFileTree: true,
    showTerminal: true,
    showSearch: true,
    showStatus: true,
    showNavigation: true,
  })
  expect(environmentSettings(builtinEnvironments[1]!)).toEqual({
    newLayoutDesigns: true,
    showFileTree: false,
    showTerminal: true,
    showSearch: false,
    showStatus: true,
    showNavigation: false,
  })
})
