# Workspace Environments

Feature branch: `feature/UnrealViewer`

## Goal

A standalone **Workspace** switch at the top-left of the web UI. A workspace is a
superset of a project: it groups multiple directories and a plugin selection under a
named, user-defined entry, and binds an **Environment** that controls the layout and
which functionality is enabled.

Project selection is disabled for now — the workspace column replaces the project
column on the home screen.

## Concepts

### Workspace

| Field         | Type       | Meaning                                            |
| ------------- | ---------- | -------------------------------------------------- |
| `id`          | string     | Stable unique id (crypto.randomUUID)               |
| `name`        | string     | User-defined name                                  |
| `directories` | string[]   | One or more project directories (superset of project worktree + sandboxes) |
| `plugins`     | string[]   | Selected plugin names for this workspace           |
| `environment` | string     | Environment id (builtin preset or custom)          |

### Environment

An environment is a named bundle of layout + functionality:

| Field      | Type                       | Meaning                                  |
| ---------- | -------------------------- | ---------------------------------------- |
| `id`       | string                     | Stable id; builtin ids are reserved      |
| `name`     | string                     | Display name                             |
| `preset`   | string (builtin only)      | Marks builtin presets                    |
| `layout`   | `"v1" \| "v2"`             | Which app layout to use                  |
| `panels`   | `PanelConfig`              | fileTree / terminal / search / status / navigation visibility |
| `features` | `Record<string, boolean>`  | Arbitrary feature flags gating functionality |

Builtin presets:

- `code` — v2 layout, all panels, no extra flags
- `unreal-viewer` — v2 layout, hides file tree/search/navigation, flags `viewer: true`, `composer: false`

Users can also create custom environments (`createEnvironment`) which are persisted
alongside workspaces and never overwrite builtins.

## Architecture

```
packages/app/src/context/workspace/
  model.ts        Pure model: types, builtin presets, CRUD operations, settings mapping
  model.test.ts   Unit tests
  index.tsx       WorkspaceProvider + useWorkspace() hook (persisted store)

packages/app/src/components/
  workspace-switcher.tsx   Top-left dropdown (switch/create/edit/delete)
  dialog-workspace-v2.tsx  Create/edit dialog (name, directories, environment, plugins)

packages/app/src/pages/home/
  home-workspaces.tsx      Home column: switcher + workspace list + active workspace details
  home.tsx                 Replaces the project column with HomeWorkspaces
```

### Data flow

1. `WorkspaceProvider` (mounted under `SettingsProvider` in `app.tsx`) persists
   `{ workspaces, environments, active }` globally via the existing `Persist.global`
   storage system (`opencode.global.dat`, key `workspaces.v1`).
2. The active workspace resolves its environment through `resolveEnvironment` —
   builtin presets win over custom environments with the same id, unknown ids fall
   back to `code`.
3. A Solid effect applies the resolved environment to the settings store through the
   existing settings API (`setNewLayoutDesigns`, `setShowFileTree`, `setShowTerminal`,
   `setShowSearch`, `setShowStatus`, `setShowNavigation`). Layout switches reuse the
   existing reload behavior of `setNewLayoutDesigns`.
4. Feature flags stay in the environment (not settings) and are read via
   `useWorkspace().features` / `useWorkspace().has(flag)`; call sites gate
   functionality, e.g. `has("viewer")` to enable viewer-only panels.

### Environment application

`environmentSettings(env)` is the pure mapping from an environment to settings
targets, keeping the settings side effects out of the model. The provider compares
and writes differences only when the resolved environment changes (memo identity),
so idle re-renders never rewrite user settings.

### Switcher UI

- Trigger shows the active workspace name plus an environment badge.
- Menu: radio list to switch workspaces, then New / Edit / Delete actions.
- The dialog edits name, directories (via the directory picker, multi-select),
  environment (SelectV2 over builtin + custom environments), and plugin names
  (tag input).

## Future work

- Per-directory session filtering on the home screen based on the active
  workspace's directories.
- Plugin checkboxes sourced from the server instead of freeform names.
- Environment editor UI (layout/panels/feature flags) for custom environments.
- Workspace scoping for the session sidebar (top-left of session views).
