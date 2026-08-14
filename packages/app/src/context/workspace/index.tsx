import { createStore } from "solid-js/store"
import { createEffect, createMemo, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { useSettings } from "@/context/settings"
import {
  builtinEnvironments,
  createCustomEnvironment,
  createWorkspace,
  DEFAULT_ENVIRONMENT_ID,
  environmentName,
  environmentOptions,
  resolveEnvironment,
  updateWorkspace,
  type Environment,
  type EnvironmentInput,
  type Workspace,
  type WorkspaceInput,
} from "./model"

export type { Environment, PanelConfig, Workspace, WorkspaceInput } from "./model"
export { builtinEnvironments, DEFAULT_ENVIRONMENT_ID, environmentName, environmentOptions } from "./model"

export type WorkspaceState = {
  workspaces: Workspace[]
  environments: Environment[]
  active: string | null
}

const defaultState: WorkspaceState = {
  workspaces: [],
  environments: [],
  active: null,
}

export const { use: useWorkspace, provider: WorkspaceProvider } = createSimpleContext({
  name: "Workspace",
  gate: false,
  init: () => {
    const settings = useSettings()
    const [state, setState, , ready] = persisted(
      Persist.global("workspaces.v1"),
      createStore<WorkspaceState>(defaultState),
    )

    const list = createMemo(() => state.workspaces)
    const active = createMemo(() => state.workspaces.find((workspace) => workspace.id === state.active))

    const environment = createMemo(() =>
      resolveEnvironment(active()?.environment, state.environments),
    )

    const options = createMemo(() => environmentOptions(state.environments))

    const features = createMemo(() => environment().features)

    const has = (feature: string) => environment().features[feature] === true

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

    function createEnvironment(input: EnvironmentInput) {
      const custom = createCustomEnvironment(input)
      setState("environments", (environments) => [...environments, custom])
      return custom
    }

    function removeEnvironment(id: string) {
      const builtin = builtinEnvironments.some((preset) => preset.id === id)
      if (builtin) return
      setState("environments", (environments) => environments.filter((environment) => environment.id !== id))
      setState("workspaces", (workspaces) =>
        workspaces.map((workspace) =>
          workspace.environment === id ? { ...workspace, environment: DEFAULT_ENVIRONMENT_ID } : workspace,
        ),
      )
    }

    createEffect(() => {
      if (!ready()) return
      const target = environment()
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
      environment,
      options,
      features,
      has,
      environmentName: (id: string) => environmentName(id, state.environments),
      select,
      create,
      update,
      rename,
      remove,
      createEnvironment,
      removeEnvironment,
    }
  },
})

export type WorkspaceContext = ReturnType<typeof useWorkspace>
export type WorkspaceFeatures = Accessor<Record<string, boolean>>
