import { createStore } from "solid-js/store"
import { createEffect, createMemo, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { useSettings } from "@/context/settings"
import {
  builtinLayouts,
  createCustomLayout,
  createWorkspace,
  DEFAULT_LAYOUT_ID,
  layoutName,
  layoutOptions,
  resolveLayout,
  updateWorkspace,
  type Layout,
  type LayoutInput,
  type OperatingAgentKey,
  type Workspace,
  type WorkspaceInput,
} from "./model"

export type { Layout, OperatingAgentKey, PanelConfig, Workspace, WorkspaceInput } from "./model"
export { builtinLayouts, DEFAULT_LAYOUT_ID, layoutName, layoutOptions } from "./model"

export type WorkspaceState = {
  workspaces: Workspace[]
  layouts: Layout[]
  active: string | null
}

const defaultState: WorkspaceState = {
  workspaces: [],
  layouts: [],
  active: null,
}

// Migrates the persisted v1 shape: `environments` -> `layouts` and
// `workspace.environment` -> `workspace.layout`.
const migrate = (value: unknown) => {
  if (!value || typeof value !== "object") return value
  const item = value as {
    environments?: Layout[]
    layouts?: Layout[]
    workspaces?: Array<Workspace & { environment?: string }>
  }
  return {
    ...item,
    environments: undefined,
    layouts: item.layouts?.length ? item.layouts : item.environments,
    workspaces: Array.isArray(item.workspaces)
      ? item.workspaces.map((workspace) => ({
          ...workspace,
          environment: undefined,
          layout: workspace.layout ?? workspace.environment ?? DEFAULT_LAYOUT_ID,
        }))
      : item.workspaces,
  }
}

export const { use: useWorkspace, provider: WorkspaceProvider } = createSimpleContext({
  name: "Workspace",
  gate: false,
  init: () => {
    const settings = useSettings()
    const [state, setState, , ready] = persisted(
      { ...Persist.global("workspaces.v1"), migrate },
      createStore<WorkspaceState>(defaultState),
    )

    const list = createMemo(() => state.workspaces)
    const active = createMemo(() => state.workspaces.find((workspace) => workspace.id === state.active))

    const layout = createMemo(() => resolveLayout(active()?.layout, state.layouts))

    const options = createMemo(() => layoutOptions(state.layouts))

    const features = createMemo(() => layout().features)

    const operatingAgent = createMemo(() => active()?.operatingAgent)

    const has = (feature: string) => layout().features[feature] === true

    function select(id: string) {
      if (id === state.active) return
      setState("active", id)
    }

    function create(input: WorkspaceInput) {
      const workspace = createWorkspace(input)
      setState("workspaces", (workspaces) => [...workspaces, workspace])
      setState("active", workspace.id)
      return workspace
    }

    function update(id: string, patch: Partial<WorkspaceInput>) {
      setState("workspaces", (workspaces) =>
        workspaces.map((workspace) => (workspace.id === id ? updateWorkspace(workspace, patch) : workspace)),
      )
    }

    function rename(id: string, name: string) {
      update(id, { name })
    }

    function remove(id: string) {
      setState("workspaces", (workspaces) => workspaces.filter((workspace) => workspace.id !== id))
      if (state.active === id) {
        setState("active", state.workspaces.find((workspace) => workspace.id !== id)?.id ?? null)
      }
    }

    function setOperatingAgent(key: OperatingAgentKey | undefined) {
      if (!state.active) return
      update(state.active, { operatingAgent: key })
    }

    function createLayout(input: LayoutInput) {
      const custom = createCustomLayout(input)
      setState("layouts", (layouts) => [...layouts, custom])
      return custom
    }

    function removeLayout(id: string) {
      const builtin = builtinLayouts.some((preset) => preset.id === id)
      if (builtin) return
      setState("layouts", (layouts) => layouts.filter((layout) => layout.id !== id))
      setState("workspaces", (workspaces) =>
        workspaces.map((workspace) =>
          workspace.layout === id ? { ...workspace, layout: DEFAULT_LAYOUT_ID } : workspace,
        ),
      )
    }

    createEffect(() => {
      if (!ready()) return
      const target = layout()
      const layoutV2 = target.layout === "v2"
      if (settings.general.newLayoutDesigns() !== layoutV2) {
        settings.general.setNewLayoutDesigns(layoutV2)
        return
      }
      settings.general.setShowFileTree(target.panels.fileTree)
      settings.general.setShowTerminal(target.panels.terminal)
      settings.general.setShowSearch(target.panels.search)
      settings.general.setShowStatus(target.panels.status)
      settings.general.setShowNavigation(target.panels.navigation)
    })

    return {
      ready,
      list,
      active,
      layout,
      options,
      features,
      has,
      operatingAgent,
      setOperatingAgent,
      layoutName: (id: string) => layoutName(id, state.layouts),
      select,
      create,
      update,
      rename,
      remove,
      createLayout,
      removeLayout,
    }
  },
})

export type WorkspaceContext = ReturnType<typeof useWorkspace>
export type WorkspaceFeatures = Accessor<Record<string, boolean>>
