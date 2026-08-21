# Workspace Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual model refresh to the workspace picker and feed every canvas block model selector from the same reactive workspace catalog.

**Architecture:** `CanvasWorkspace` owns one directory-scoped `useProviders` result and one flattened catalog memo. The toolbar and MasterAgent blocks consume that memo, while the hook delegates refresh to the existing server-wide provider-query refetch.

**Tech Stack:** TypeScript, SolidJS, Bun test, TanStack Solid Query, application i18n.

**Spec:** `docs/superpowers/specs/2026-08-21-workspace-model-catalog-design.md`

## Global Constraints

- Preserve the existing server-wide `refreshProviders()` scope.
- Do not introduce a new endpoint, cache, context, dependency, or persistence format.
- Keep workspace model persistence in `createCanvasManager` and Coder persistence in the existing Coder controller.
- Add all new user-visible copy through application i18n.
- Do not overwrite or include unrelated working-tree changes.
- Run tests and typecheck from `packages/app`, never from the repository root.

---

### Task 1: Share One Workspace Catalog With Every Selector

**Files:**
- Modify: `packages/app/src/pages/canvas/master-agent.integration.test.tsx`
- Modify: `packages/app/src/pages/canvas/workspace.tsx`

**Interfaces:**
- Consumes: `useProviders(projectDirectory)` with `all()` and `connected()` accessors.
- Produces: local `CanvasModelCatalogItem` values containing `key`, `providerID`, `modelID`, `providerName`, and `modelName`; `ModelPicker.models: () => readonly CanvasModelCatalogItem[]`; `MasterAgentBlock.models: readonly ModelSelection[]`.

- [ ] **Step 1: Write the failing shared-catalog integration test**

Extend the provider mock with connected Acme and OpenAI models. Record `models` in the fake `MasterAgentBlock`, mount two MasterAgent blocks, open the toolbar picker, and assert the toolbar and both blocks receive these keys in the same sorted order:

```ts
expect(toolbarModelKeys()).toEqual(["acme:coder-mini", "openai:gpt-5"])
expect(blockRenders.filter((entry) => entry.blockID !== "canvas-legacy").map((entry) => entry.modelKeys)).toEqual([
  ["acme:coder-mini", "openai:gpt-5"],
  ["acme:coder-mini", "openai:gpt-5"],
])
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/pages/canvas/master-agent.integration.test.tsx
```

Expected: the toolbar may list the mock models, but recorded block model keys are empty because `CanvasWorkspace` does not pass a catalog to blocks.

- [ ] **Step 3: Implement the shared catalog memo**

In `CanvasWorkspace`, create the provider hook beside `projectDirectory`, flatten only connected providers, and sort once:

```ts
const providers = useProviders(projectDirectory)
const modelCatalog = createMemo(() => {
  const connected = new Set(providers.connected().map((provider) => provider.id))
  return [...providers.all()]
    .filter(([providerID]) => connected.has(providerID))
    .flatMap(([providerID, provider]) =>
      Object.entries(provider.models).map(([modelID, model]) => ({
        key: `${providerID}:${modelID}`,
        providerID,
        modelID,
        providerName: provider.name,
        modelName: model.name ?? modelID,
      })),
    )
    .sort((a, b) => a.modelName.localeCompare(b.modelName) || a.providerName.localeCompare(b.providerName))
})
```

Change `ModelPicker` to accept the catalog accessor instead of creating its own provider hook, and pass `models={modelCatalog()}` to each `MasterAgentBlock`.

- [ ] **Step 4: Run the focused integration test**

Run the Step 2 command. Expected: PASS, with identical ordered keys in the workspace picker and both block props.

### Task 2: Add Built-In Refresh With Pending and Failure States

**Files:**
- Modify: `packages/app/src/hooks/use-providers.ts`
- Modify: `packages/app/src/pages/canvas/master-agent.integration.test.tsx`
- Modify: `packages/app/src/pages/canvas/workspace.tsx`
- Modify: `packages/app/src/pages/canvas/canvas.css`
- Modify: `packages/app/src/i18n/en.ts`

**Interfaces:**
- Consumes: `ServerSync.refreshProviders(): Promise<unknown>`.
- Produces: `useProviders(...).refresh(): Promise<unknown>` and `ModelPicker.onRefresh(): Promise<unknown>`.

- [ ] **Step 1: Write failing refresh tests**

Make the provider mock's `refresh()` return a controllable promise. Assert that clicking `.canvas-model-picker-refresh` calls it once, disables the button, and does not issue a second call while pending. Add a rejection case asserting the existing model options remain and `[role="alert"]` contains `canvas.model.refresh.error` from the language mock.

- [ ] **Step 2: Run the tests to verify they fail**

Run the Task 1 test command. Expected: no refresh action exists.

- [ ] **Step 3: Expose the existing refresh operation**

Add this member to the object returned by `useProviders`:

```ts
refresh: () => serverSync().refreshProviders(),
```

- [ ] **Step 4: Render the refresh state**

Add `refreshing` and `refreshError` signals to `ModelPicker`. Clear the error, call `props.onRefresh()`, set the inline error on rejection, and clear the pending flag in `finally`. Render a localized button below the model list and a localized `role="alert"` failure message while preserving the list.

Add these English keys:

```ts
"canvas.model.refresh": "Refresh models",
"canvas.model.refreshing": "Refreshing models…",
"canvas.model.refresh.error": "Couldn’t refresh models. Existing models are still available.",
```

Style the button and alert inside the existing `.canvas-model-picker-pop` rules without adding a dependency or animation.

- [ ] **Step 5: Run focused tests and typecheck**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/pages/canvas/master-agent.integration.test.tsx
bun typecheck
```

Expected: both commands exit successfully.

- [ ] **Step 6: Review the final diff**

Verify `git diff --check` passes and `git diff -- packages/app/src/hooks/use-providers.ts packages/app/src/pages/canvas/workspace.tsx packages/app/src/pages/canvas/canvas.css packages/app/src/i18n/en.ts packages/app/src/pages/canvas/master-agent.integration.test.tsx` contains no unrelated edits.
