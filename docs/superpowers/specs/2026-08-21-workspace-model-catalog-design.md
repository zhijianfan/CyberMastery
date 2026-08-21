# Workspace Model Catalog Design

## Goal

Give the workspace model picker a manual **Refresh models** action and make every canvas block model selector consume the exact same directory-scoped catalog as the workspace picker.

## Current State

`CanvasWorkspace` renders the workspace toolbar and every canvas block. The toolbar's `ModelPicker` currently creates its own `useProviders(projectDirectory)` view. `MasterAgentBlock` already accepts model candidates, but the canvas does not provide them, so its Workspace Coder selector has no live catalog. The app already exposes a server-wide provider/model refresh through `ServerSync.refreshProviders()`.

## Architecture

`CanvasWorkspace` will own one `useProviders(projectDirectory)` result and derive one reactive catalog from its connected providers. Each catalog entry contains the persisted model identity (`providerID`, `modelID`) plus the workspace picker's display fields (`key`, `providerName`, `modelName`). The existing toolbar picker and every current model-selecting block receive that same catalog; no second cache or context is introduced.

The workspace manager continues to own model selection persistence. Catalog discovery does not move into the manager.

## Data Flow

1. `useProviders(projectDirectory)` selects the provider catalog for the workspace's primary project directory.
2. `CanvasWorkspace` filters that catalog to connected providers, flattens their models, and sorts the result by model name and provider name.
3. The toolbar `ModelPicker` filters the shared list for search and persists a chosen `providerID:modelID` through `manager.selectModel`.
4. Every `MasterAgentBlock` receives the same list and persists its Coder choice through the existing workspace-wide Coder controller.
5. A successful provider refresh updates the provider queries. Solid's reactive catalog recomputes, so the toolbar and mounted block selectors update together.

## Refresh Behavior

The model picker displays a **Refresh models** action without closing the popup. It invokes a `refresh()` method exposed by `useProviders`, which delegates to the existing server-wide `ServerSync.refreshProviders()` operation. The action is disabled and labeled **Refreshing models…** while the promise is pending so duplicate refreshes cannot run from the same picker.

The refresh scope is every cached provider/model catalog on the current server, matching the existing built-in behavior confirmed by the user.

## Error Handling

A refresh failure keeps the last catalog visible and shows an inline localized alert. Selection is never cleared or rewritten because refresh and persistence remain separate operations. A later refresh can be attempted immediately.

## User-Visible Text

New English localization keys cover the refresh, pending, and failure states. Other locales use the existing English fallback until translated.

## Files

- `packages/app/src/hooks/use-providers.ts`: expose the existing refresh operation alongside catalog accessors.
- `packages/app/src/pages/canvas/workspace.tsx`: derive the shared catalog, pass it to the toolbar and blocks, and render refresh state.
- `packages/app/src/pages/canvas/canvas.css`: style the refresh action and inline failure state.
- `packages/app/src/i18n/en.ts`: add localized refresh copy.
- `packages/app/src/pages/canvas/master-agent.integration.test.tsx`: verify identical workspace/block catalog input and refresh behavior.

## Testing

Focused canvas integration tests will verify that:

- both mounted MasterAgent blocks receive every model shown by the workspace picker in the same order;
- the refresh action calls the provider hook once and guards against duplicate clicks while pending;
- a rejected refresh preserves model choices and renders the localized error state.

The app package typecheck will verify the shared catalog item remains structurally compatible with `ModelSelection`.

## Non-Goals

- No new backend endpoint, query cache, global model store, or canvas context.
- No changes to model availability rules, provider authentication, or workspace persistence.
- No per-block catalog or per-block refresh behavior.
- No automatic polling.

## Acceptance Criteria

- The workspace model popup includes a working server-wide **Refresh models** action.
- The workspace picker and all current canvas block model selectors use one reactive catalog derived from the workspace directory.
- Refresh success updates all consumers together; refresh failure leaves the previous catalog usable.
- Existing workspace and Coder selections remain workspace-authoritative and unchanged by refresh alone.
