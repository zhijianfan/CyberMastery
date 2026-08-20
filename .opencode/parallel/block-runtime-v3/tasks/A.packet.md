You are worker 1 of 7 (Wave 1) in the block-runtime-v3 run at D:\OpencodeDev
(branch feature/CyberMaster). Implement ONLY this task from the brief below.

## Task A — Shared runtime contracts and schemas

Goal: create one canonical set of runtime types imported by the frontend host,
adapters, and tests. Remove the architectural need for ChatRelay-local duplicate
runtime types.

Design (frozen shapes — implement EXACTLY these exports in a new module
`packages/app/src/pages/canvas/runtime/contracts.ts`):

```ts
export interface CanvasBlockDescriptor {
  id: string
  functionalityID: string
  transform: { x: number; y: number; w: number; h: number; z: number }
}
export type BlockRuntimeMode = "native" | "projected" | "local" | "static"
export type RuntimeStatus = "resolving" | "ready" | "stale" | "unavailable" | "permission-denied" | "error"
export interface RuntimeEventKey {
  type: string
  workspaceID?: string
  blockID?: string
  functionalityID?: string
  resourceID?: string
}
export type RuntimeProjectionPatch =
  | { op: "replace"; value: unknown; revision?: number }
  | { op: "merge"; value: Record<string, unknown>; revision?: number }
  | { op: "append"; path: readonly string[]; value: unknown; revision?: number }
  | { op: "remove"; path?: readonly string[]; revision?: number }
export interface BlockRuntimeServices {
  serverSDK: Accessor<ServerSDK>
  eventRouter: BlockRuntimeEventRouter
  workspace: {
    id(): string | undefined
    epoch(): number
    connected(): boolean
    awaitDescriptorPersisted(blockID: string, signal: AbortSignal): Promise<void>
  }
  localView: BlockLocalViewStore
}
export interface BlockRuntimeRegistration<TResolved, TView, TCommand> {
  functionalityID: string
  mode: BlockRuntimeMode
  resolve(input: { workspaceID: string; block: CanvasBlockDescriptor; services: BlockRuntimeServices; signal: AbortSignal }): Promise<TResolved>
  eventKeys?(resolved: TResolved): readonly RuntimeEventKey[]
  onEvent?(input: { event: ServerEvent; resolved: TResolved; services: BlockRuntimeServices }): "ignore" | "invalidate" | RuntimeProjectionPatch
  select(input: { resolved: TResolved; projection: unknown; localView: unknown }): TView
  dispatch?(input: { resolved: TResolved; command: TCommand; services: BlockRuntimeServices; signal: AbortSignal }): Promise<void>
  dispose?(resolved: TResolved): void
}
export interface RuntimeBlockHandle<TView = unknown, TCommand = unknown> {
  status(): RuntimeStatus
  view(): TView | undefined
  error(): unknown
  refresh(reason?: string): Promise<void>
  dispatch(command: TCommand): Promise<void>
  dispose(): void
}
export interface BlockRuntimeEventRouter { /* narrow; C implements — declare only what registrations/select need */ }
export interface BlockLocalViewStore { /* narrow; D implements — declare read/write/delete by key */ }
```

Rules for this module:
- PURE contracts: no SolidJS runtime imports and no SDK value imports. For
  `Accessor<T>`, `ServerSDK`, `ServerEvent`, `AbortSignal` — use `import type`
  ONLY (`import type { Accessor } from "solid-js"` is allowed as a type-only
  import; `import type { ServerSDK, ServerEvent } from "@/context/server-sdk"`).
- The descriptor type must NOT structurally contain `bindings`, `messages`,
  `sessionID`, or `agentKey`.
- Cursors are opaque strings; no numeric parsing helpers.
- `RuntimeEventKey.type` is an open `string`, NOT a closed union of
  session|message|pty|file|review.
- Export a ChatRelay-specific command union? NO — command typing is per-adapter
  via `TCommand`; the generic module must not import any block implementation.

Do NOT edit existing files (no deprecation shims). C owns the old
`runtime/types.ts` replacement; H/I remove ChatRelay duplicates in Wave 2.

contracts.test.ts must cover (compile-time type tests, `@ts-expect-error`-style
negative checks where bun supports them, else runtime shape assertions):
1. a native session-backed registration typechecks;
2. a local Notes registration typechecks;
3. a projected future resource registration typechecks;
4. command typing is per adapter;
5. no session ID in `CanvasBlockDescriptor` (negative test);
6. `RuntimeProjectionPatch` ops accept the exact frozen shapes.

## Owned files (edit ONLY these)

- `packages/app/src/pages/canvas/runtime/contracts.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/contracts.test.ts` (NEW)
- `packages/app/src/pages/canvas/runtime/HANDOFF-A.md` (handoff)

## Targeted validation (allowed)

- `cd packages/app && bun test src/pages/canvas/runtime/contracts.test.ts`
- `bun run typecheck` from `packages/app` (package-scoped only)

## Handoff

Write `HANDOFF-A.md`: files changed · tests run + exact result · exported symbol
list · assumptions · known limitations · integration actions M must take ·
prohibited-pattern grep result over your diff.
