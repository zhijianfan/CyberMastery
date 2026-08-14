export type LayoutPreset = "v1" | "v2"

export type PanelConfig = {
  fileTree: boolean
  terminal: boolean
  search: boolean
  status: boolean
  navigation: boolean
}

export type Layout = {
  id: string
  name: string
  preset?: string
  layout: LayoutPreset
  panels: PanelConfig
  features: Record<string, boolean>
}

// The OperatingAgent model is configured per workspace. The key is the
// model selector format: "providerID/modelID". Unset means the workspace
// inherits the session/agent/global default model.
export type OperatingAgentKey = string

export type Workspace = {
  id: string
  name: string
  directories: string[]
  plugins: string[]
  layout: string
  operatingAgent?: OperatingAgentKey
}

export type WorkspaceInput = {
  name: string
  directories?: string[]
  plugins?: string[]
  layout?: string
  operatingAgent?: OperatingAgentKey
}

export type LayoutInput = {
  name: string
  layout: LayoutPreset
  panels?: PanelConfig
  features?: Record<string, boolean>
}

export const DEFAULT_LAYOUT_ID = "code"

export const DEFAULT_PANELS: PanelConfig = {
  fileTree: true,
  terminal: true,
  search: true,
  status: true,
  navigation: true,
}

export const builtinLayouts: readonly Layout[] = [
  {
    id: "code",
    name: "Code",
    preset: "code",
    layout: "v2",
    panels: { ...DEFAULT_PANELS },
    features: {},
  },
  {
    id: "unreal-viewer",
    name: "UnrealViewer",
    preset: "unreal-viewer",
    layout: "v2",
    panels: { ...DEFAULT_PANELS, fileTree: false, search: false, navigation: false },
    features: { viewer: true, composer: false },
  },
]

export function randomID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function builtinLayout(id: string) {
  return builtinLayouts.find((layout) => layout.id === id)
}

export function layoutById(id: string, custom: readonly Layout[]) {
  return builtinLayout(id) ?? custom.find((layout) => layout.id === id)
}

export function layoutOptions(custom: readonly Layout[]) {
  return [...builtinLayouts, ...custom]
}

export function layoutName(id: string, custom: readonly Layout[]) {
  return layoutById(id, custom)?.name ?? id
}

export function layoutFeature(id: string, custom: readonly Layout[], feature: string) {
  return layoutById(id, custom)?.features[feature] === true
}

export function resolveLayout(id: string | undefined, custom: readonly Layout[]) {
  return layoutById(id ?? DEFAULT_LAYOUT_ID, custom) ?? builtinLayouts[0]!
}

export function createWorkspace(input: WorkspaceInput): Workspace {
  return {
    id: randomID(),
    name: input.name.trim() || "Untitled",
    directories: [...new Set(input.directories ?? [])],
    plugins: [...new Set(input.plugins ?? [])],
    layout: input.layout ?? DEFAULT_LAYOUT_ID,
    ...(input.operatingAgent ? { operatingAgent: input.operatingAgent } : {}),
  }
}

export function updateWorkspace(workspace: Workspace, patch: Partial<WorkspaceInput>): Workspace {
  return {
    ...workspace,
    name: patch.name !== undefined ? patch.name.trim() || workspace.name : workspace.name,
    directories: patch.directories ? [...new Set(patch.directories)] : workspace.directories,
    plugins: patch.plugins ? [...new Set(patch.plugins)] : workspace.plugins,
    layout: patch.layout ?? workspace.layout,
    operatingAgent:
      patch.operatingAgent !== undefined ? patch.operatingAgent || undefined : workspace.operatingAgent,
  }
}

export function createCustomLayout(input: LayoutInput): Layout {
  return {
    id: randomID(),
    name: input.name.trim() || "Custom",
    layout: input.layout,
    panels: { ...DEFAULT_PANELS, ...input.panels },
    features: { ...input.features },
  }
}

export function layoutSettings(layout: Layout) {
  return {
    newLayoutDesigns: layout.layout === "v2",
    showFileTree: layout.panels.fileTree,
    showTerminal: layout.panels.terminal,
    showSearch: layout.panels.search,
    showStatus: layout.panels.status,
    showNavigation: layout.panels.navigation,
  }
}
