# MasterAgent Risks and Open Questions

Target branch: `feature/UnrealViewer`.

The implementation can proceed with the defaults below. Items marked **Product decision** should be confirmed before changing the default behavior.

| Risk or question | Recommended default | Consequence or mitigation |
|---|---|---|
| Does the branch already contain a durable generic FunctionalityInstance service? | Reuse it when present. Otherwise land the smallest generic instance persistence/service needed by B1/B2. | Never store authoritative session IDs in layout JSON or browser persistence. |
| How strict is “coding tasks are rerouted”? | Enforce at the tool boundary: the primary cannot directly mutate the repository while Coder mode is enabled. | Prompt-only instructions are insufficient and may be ignored by models. |
| What happens when the Coder model is unavailable? | Fail visibly; no silent fallback. | Prevents hidden cost/capability changes and preserves user intent. |
| Can Coder equal the primary model? | Allow it with a warning. | The app cannot reliably rank every provider's models; “less capable” is a user policy choice. |
| Does a Coder model change affect active work? | No. Snapshot the model when creating the child session. | Avoids mid-run inconsistency and non-reproducible traces. |
| Can a busy MasterAgent be reset? | Not in v1. Require idle state and no pending inputs. | Avoids orphaned runs and ambiguous queued-input ownership. |
| What happens when a MasterAgent block is removed? | Preserve session, running work, and queued input; remove/tombstone only the visible instance. | Session deletion remains an explicit separate action. |
| Are terminals independent for each MasterAgent? | Scope UI/provider state to the block and reuse existing host directory/terminal behavior. | Fully persistent per-block PTY ownership is a separate feature. |
| Can a block browse arbitrary top-level sessions? | Keep the root binding fixed. Use reset for a new root session; child tasks remain children. | An “Open in full session page” action may navigate externally without rebinding. |
| Multiple session surfaces may register global shortcuts. | Scope commands and key handling to the focused block. | U1 must add focus-aware provider/command behavior. |
| Multiple MasterAgent blocks share one Coder selection. | Yes in v1; label the control “Workspace Coder.” | A future per-instance override can inherit from the workspace field. |
| A weak model may not support tools correctly. | Validate known capability metadata when available; otherwise warn and fail only for known incompatibility. | Do not create a hardcoded global model ranking. |
| Existing routed session state may assume a single page instance. | Extract explicit-target providers and test two surfaces simultaneously. | Watch for singleton stores, DOM IDs, portals, and keyboard handlers. |
| Queue UI may depend on route-derived busy state. | Supply busy/session state through the reusable surface's explicit target. | Do not patch queue logic or create a second composer. |
| SDK generator may emit broad diffs. | G1 owns all generated output and verifies idempotence. | Review generated diffs separately from handwritten protocol changes. |
| Hand-maintained migrations may drift from baseline schema. | B1 updates migration file, `migration.gen.ts`, and `schema.gen.ts` in one commit. | Add a migration test from the previous baseline. |
| Concurrent session ensure can leave an orphan candidate. | Use transaction or revision CAS; archive/remove the losing unbound candidate. | Add a deterministic concurrency test. |
| Event delivery can be missed during reconnect. | Treat EventV2 as a hint and persisted binding as source of truth; refetch on reconnect. | Manager reducer must handle out-of-order and duplicate events. |
| Primary tool restrictions could affect non-MasterAgent sessions. | Apply policy only when the parent session resolves to a MasterAgent instance with non-null `coderModel`. | Add regression tests for ordinary sessions. |
| `task` permission may be interpreted differently by existing code. | Reuse the current permission key for both selector UX and host delegation. | Add tests for deny, allow, and absent/default configurations. |

## Product decisions to confirm when convenient

1. **Reset while busy:** retain the recommended prohibition, or add an explicit cancel-and-reset flow.
2. **Block restoration UX:** whether removed MasterAgent sessions should appear in a recoverable block/session history UI in this release.
3. **Per-block Coder override:** defer to a later version unless users require different coding models in one workspace.
4. **Coder equality warning:** whether selecting the same model as the primary should show a soft warning or be fully unrestricted.
5. **Coder task visibility:** whether child sessions appear inline, in the review panel, or only through existing subagent/session navigation.
6. **Model capability validation:** whether known tool-call incompatibility should block selection or only warn.

## Defaults that should not be changed accidentally

```text
Workspace field:          coderModel
Per-block override:       absent in v1
Queue ownership:          host SessionInput service
Session ownership:        host functionality instance
Routing boundary:         host Coder child session
Fallback:                 none
Reset:                    idle + no pending input
Deletion:                 preserve session history
Event authority:          persisted binding, not transient event
```
