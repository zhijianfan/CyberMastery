export type LayoutPreset = "v1" | "v2"

export type PanelConfig = {
  fileTree: boolean
  terminal: boolean
  search: boolean
  status: boolean
  navigation: boolean
}

export type Environment = {
  id: string
  name: string
  preset?: string
  layout: LayoutPreset
  panels: PanelConfig
  features: Record<string, boolean>
}

export type Workspace = {
  id: string
  name: string
  directories: string[]
  plugins: string[]
  environment: string
}

export type WorkspaceInput = {
  name: string
  directories?: string[]
  plugins?: string[]
  environment?: string
}

export type EnvironmentInput = {
  name: string
  layout: LayoutPreset
  panels?: PanelConfig
  features?: Record<string, boolean>
}

export const DEFAULT_ENVIRONMENT_ID = "code"

export const DEFAULT_PANELS: PanelConfig = {
  fileTree: true,
  terminal: true,
  search: true,
  status: true,
  navigation: true,
}

export const builtinEnvironments: readonly Environment[] = [
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

export function builtinEnvironment(id: string) {
  return builtinEnvironments.find((environment) => environment.id === id)
}

export function environmentById(id: string, custom: readonly Environment[]) {
  return builtinEnvironment(id) ?? custom.find((environment) => environment.id === id)
}

export function environmentOptions(custom: readonly Environment[]) {
  return [...builtinEnvironments, ...custom]
}

export function environmentName(id: string, custom: readonly Environment[]) {
  return environmentById(id, custom)?.name ?? id
}

export function environmentFeature(id: string, custom: readonly Environment[], feature: string) {
  return environmentById(id, custom)?.features[feature] === true
}

export function resolveEnvironment(id: string | undefined, custom: readonly Environment[]) {
  return environmentById(id ?? DEFAULT_ENVIRONMENT_ID, custom) ?? builtinEnvironments[0]!
}

export function createWorkspace(input: WorkspaceInput): Workspace {
  return {
    id: randomID(),
    name: input.name.trim() || "Untitled",
    directories: [...new Set(input.directories ?? [])],
    plugins: [...new Set(input.plugins ?? [])],
    environment: input.environment ?? DEFAULT_ENVIRONMENT_ID,
  }
}

export function updateWorkspace(workspace: Workspace, patch: Partial<WorkspaceInput>): Workspace {
  return {
    ...workspace,
    name: patch.name !== undefined ? patch.name.trim() || workspace.name : workspace.name,
    directories: patch.directories ? [...new Set(patch.directories)] : workspace.directories,
    plugins: patch.plugins ? [...new Set(patch.plugins)] : workspace.plugins,
    environment: patch.environment ?? workspace.environment,
  }
}

export function createCustomEnvironment(input: EnvironmentInput): Environment {
  return {
    id: randomID(),
    name: input.name.trim() || "Custom",
    layout: input.layout,
    panels: { ...DEFAULT_PANELS, ...input.panels },
    features: { ...input.features },
  }
}

export function environmentSettings(environment: Environment) {
  return {
    newLayoutDesigns: environment.layout === "v2",
    showFileTree: environment.panels.fileTree,
    showTerminal: environment.panels.terminal,
    showSearch: environment.panels.search,
    showStatus: environment.panels.status,
    showNavigation: environment.panels.navigation,
  }
}
