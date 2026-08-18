# Track V1 — Cross-Layer Verification and Final Documentation

## Mission

Validate the completed MasterAgent feature against real host behavior, protect existing session behavior from regressions, and document the implemented architecture and operational constraints.

Target branch: `feature/UnrealViewer`.

## Dependencies

All implementation tracks:

```text
B1 B2 P1 G1 S1 R1 U1 U2 M1 M2 Q1 C1 I1
```

## Files

### Create

```text
packages/core/test/integration/master-agent-session.test.ts
packages/opencode/test/integration/master-agent-coder.test.ts
packages/app/src/pages/canvas/master-agent.e2e.test.tsx
docs/master-agent.md
```

### Modify

```text
UIDesign.md
```

Adapt test locations to the repository's existing integration-test conventions.

## Required end-to-end scenarios

### Session binding

1. Create a workspace with two MasterAgent blocks.
2. Ensure each block and verify distinct session IDs.
3. Reconnect/reload and verify bindings persist.
4. Simulate concurrent ensures and verify one active binding per block.
5. Reset one block and verify the other is unchanged.
6. Verify stale reset protection.
7. Remove a block and verify the session and queued inputs remain host-side.
8. Verify layout-authority handover does not duplicate sessions.

### Queue

1. Start a long-running input.
2. Submit another prompt with `delivery: "queue"`.
3. Verify admission is durable before the current run finishes.
4. Reload the client and verify pending state is restored from host projection.
5. Verify ordered promotion when the drain becomes idle.
6. Verify block remount/removal does not discard the queue.
7. Confirm there is no client-side holding queue.

### Coder routing

1. Verify null `coderModel` preserves ordinary behavior.
2. Enable a Coder model.
3. Request a repository mutation and test run.
4. Verify the main session remains on the primary model.
5. Verify a child Coder session uses the workspace-selected model and correct directory.
6. Verify direct primary mutation is unavailable while Coder mode is enabled.
7. Change the Coder model during an active child and verify snapshot behavior.
8. Verify the next child uses the new model.
9. Verify unavailable model failure has no silent fallback.
10. Deny `task` and verify host and client rejection.
11. Verify ordinary non-MasterAgent sessions are unaffected.

### UI regression

1. Existing routed session page works after U1 extraction.
2. Existing `builtin:chat` block still works.
3. Two MasterAgent surfaces can be mounted without shortcut, terminal, portal, or DOM-ID collisions.
4. App production build succeeds.

## Documentation updates

`docs/master-agent.md` should describe:

- Feature purpose.
- Workspace-wide Coder selection.
- Host-side child-session routing.
- Session binding ownership.
- Queue semantics and durability.
- Reset and block-removal behavior.
- Permission behavior.
- Known limitations: no per-block Coder override, busy reset prohibited, no silent model fallback.

Update `UIDesign.md` to reflect the final embedded-session and Coder-selector behavior without duplicating implementation internals.

## Full verification commands

Run all package typechecks and focused tests. At minimum:

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/protocol typecheck
bun --cwd packages/server typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck

node packages/sdk/js/script/build.ts
node packages/sdk/js/script/build.ts

git diff --exit-code  # after the second SDK generation, except intentional uncommitted test artifacts

bun --cwd packages/app run build
```

Run every test introduced by the preceding tracks plus the V1 integration tests.

## Acceptance gate

Use `05-verification-and-acceptance.md` as the definitive checklist. Any failure involving durable queue behavior, session duplication, silent Coder fallback, cross-workspace access, or ordinary-session regression blocks release.

## Deliverable

A final verification report in the merge request, passing integration tests, updated design documentation, and a concise list of any intentionally deferred limitations.
