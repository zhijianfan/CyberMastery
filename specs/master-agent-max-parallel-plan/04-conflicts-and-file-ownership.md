# MasterAgent Conflict Avoidance and File Ownership

Target branch: `feature/UnrealViewer`.

Maximum parallelism is safe only when shared existing files have one owner. New files are owned by the track that creates them; composition tracks import them later.

## 1. Exclusive shared-file owners

| Shared file | Only owner | Allowed change |
| --- | --- | --- |
| `packages/schema/src/workspace.ts` | C0 | Workspace `coderModel` schema only |
| `packages/schema/src/index.ts` | C2 | Schema public exports |
| `packages/core/src/workspace/sql.ts` | D1 | SQL column definition |
| `packages/core/src/database/migration.gen.ts` | D1 | Migration registration |
| `packages/core/src/database/schema.gen.ts` | D1 | Baseline schema |
| `packages/core/src/workspace/service.ts` | D4 | Coder field wiring and built-in array |
| `packages/protocol/src/groups/workspace.ts` | P3 | Protocol composition |
| `packages/protocol/src/index.ts` | P3 | Protocol export composition |
| `packages/sdk/js/src/**` | G1 | Generated output only |
| `packages/server/src/handlers/workspace.ts` | S2 | Handler composition |
| `packages/opencode/src/server/event-v2.ts` | S2 | Binding event bridge |
| `packages/opencode/src/tool/task.ts` | R3 | Child runner extraction |
| `packages/opencode/src/session/prompt.ts` | R6 | Tool policy/injection |
| `packages/opencode/src/agent/agent.ts` | R6 | Reserved agent registration |
| `packages/app/src/pages/session.tsx` | U2 | Routed Session extraction |
| `packages/app/src/pages/canvas/manager.ts` | M6 | Manager composition |
| `packages/app/src/pages/canvas/workspace.tsx` | I2 | Client registration/rendering |
| `UIDesign.md` | V4 | Final documented behavior |

No other track may edit these files, even to resolve a temporary type error.

## 2. Existing files deliberately left untouched

The feature must not require changes to:

```text
packages/app/src/components/prompt-input.tsx
packages/session-ui/src/v2/components/prompt-input/**
```

Queue behavior already exists there. Q1 and B3 provide the correct explicit session target and options.

No track may put authoritative session IDs, binding revisions, or queue entries into:

```text
packages/app/src/pages/canvas/workspace.tsx layout serialization
browser localStorage
IndexedDB
canvas-local persistence
```

## 3. Generated ownership

Only G1 may change `packages/sdk/js/src/**` as a result of generation. Rules:

1. P3 freezes protocol names.
2. G1 runs the generator twice.
3. M5 consumes generated types behind a handwritten port.
4. No UI/controller track imports generated types outside `sdk-port.ts`.
5. A generator problem is fixed in protocol/generator input, never by hand-editing output.

## 4. New-file ownership

A leaf track owns every file listed in its assignment until its commit merges. Composition tracks may import the file but should not rewrite it. A required semantic change goes back to the leaf owner or lands as a clearly separated follow-up commit approved by that owner.

## 5. Temporary interface rule

When an upstream track is absent, a leaf agent may define a temporary local type behind its own constructor/port. It may not:

- add a temporary symbol to a shared barrel;
- create a duplicate cross-package domain type;
- edit another track's file;
- preserve the alias after final rebase;
- leak it into generated SDK output.

## 6. Conflict resolution order

When integrating a lane:

1. Rebase the composition track onto all leaf commits.
2. Accept the leaf versions of their exclusive files.
3. Resolve imports only in the composition track's files.
4. Run leaf tests before editing behavior.
5. Return semantic conflicts to the owning track.
6. Keep merge-only formatting changes out of unrelated files.

## 7. High-risk hotspots

### Workspace service

D4 performs the only edit. D1 supplies SQL, D2 supplies codec, and D3 supplies descriptor. F4 remains a separate domain service.

### Protocol group

P3 composes P1/P2 once. G1 starts only after P3 is frozen.

### opencode prompt/tool pipeline

R3 owns the ordinary TaskTool refactor. R6 owns prompt and agent registration. R5 stays a new-file tool implementation.

### Session page

U2 owns route extraction. U1/U3 operate entirely in new files and must not opportunistically edit the routed page.

### Canvas manager and renderer

M6 alone edits `manager.ts`; I2 alone edits `workspace.tsx`. B3 is a new-file composition component and contains most feature JSX.

## 8. Commit hygiene

Each commit message should include:

```text
Track: <ID>
Owned files: <paths>
Ready after: <IDs or none>
Verification: <commands>
Temporary aliases remaining: yes/no
```

A commit touching an unowned shared file is rejected before review.
