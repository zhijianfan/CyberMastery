# Handoff L — Diagnostics and feature flag

Status: archived/superseded 2026-08-24. The integration actions below are
complete or obsolete. The live canvas uses the canonical v3 registration
table directly; `BLOCK_RUNTIME_V3` is enabled and no longer gates a parallel
runtime path.

Executor: master (original flash-free worker completed this track and was then
killed by the Wave-2 restart; its spec was preserved and re-implemented by the
integration master).

## Files

- `packages/app/src/pages/canvas/diagnostics.ts` — rewritten:
  `collectCanvasDiagnostics(source?)` reports per-block
  `{ blockID, functionalityID, registrationMode: "native"|"local"|"none",
  hostStatus?, localViewKeys }` + workspace `{ id, epoch, connected, dirty }`;
  no-args fallback reads `__CANVAS_INTEGRATION_STATE__`, never throws,
  JSON-able. `renderCanvasDiagnostics` renders the new shape (dev only).
  Old registry exports removed (no importers).
- `packages/app/src/pages/canvas/flag.ts` — NEW:
  `BLOCK_RUNTIME_V3 = false` (M flips at integration; gates nothing yet).
- `packages/app/src/pages/canvas/diagnostics.test.ts` — 3 tests.

## Validation

- `bun test src/pages/canvas/diagnostics.test.ts` → 3 pass (verify after M's
  final typecheck pass).
- Prohibited-pattern grep over the diff: none.

## Integration actions for M

1. Wire a real `CanvasDiagnosticsSource` from the canvas manager + registry at
   integration (Wave 3).
2. Flip `BLOCK_RUNTIME_V3` when all registrations are wired.
