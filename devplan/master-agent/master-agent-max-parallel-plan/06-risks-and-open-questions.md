# MasterAgent Risks and Open Questions

Target branch: `feature/UnrealViewer`.

The implementation may proceed with the defaults below. A product decision is needed only before changing a default.

| Risk or question | Default | Mitigation |
| --- | --- | --- |
| Generic functionality-instance persistence may differ from the planned port. | Wrap the existing service; add only minimal generic storage if genuinely absent. | F1 reports the actual adapter; D1 alone owns any SQL fallback. Never create a block-specific layout binding. |
| “Coding task” can be ambiguous. | Enforce routing by effective tool capability, not browser prompt classification. | Enabled primary cannot directly mutate or use unrestricted coding shell tools; it delegates through Coder. |
| Selected model may be unavailable. | Visible failure, no fallback. | Preserve user intent and avoid hidden cost/capability changes. |
| Selected Coder may equal primary. | Allow with a warning. | The app does not maintain a universal model capability ranking. |
| Active child may outlive a Coder setting change. | Snapshot model at child creation. | Next child uses the new selection. |
| Reset during work is ambiguous. | Reject unless idle with zero pending input. | A later explicit cancel-and-reset flow can be designed separately. |
| Concurrent ensure may create a losing candidate. | CAS one binding; clean up only an unbound empty candidate. | Deterministic concurrency test in F4/V1. |
| Event may be missed on reconnect. | Persisted binding is authoritative. | M3 refetches on reconnect and ignores stale events. |
| Multiple Session surfaces may rely on global state. | Add explicit target/scope and focused command ownership. | U1/U3 test two simultaneous surfaces. |
| Queue UI may depend on route state. | Pass explicit target/options into reused Session surface. | Do not edit composer or create another queue. |
| Primary restrictions might leak to normal sessions. | Apply policy only when R1 resolves an enabled MasterAgent context. | R2/R6/V2 ordinary-session regression tests. |
| A weaker model may lack tool-call support. | Warn for known incompatibility; fail for known impossible execution. | No hardcoded global ranking. |
| Workspace-wide Coder surprises users with multiple blocks. | Label it `Workspace Coder`. | Every selector observes one manager-owned field. |
| Generated SDK produces broad churn. | G1 owns all generated output and runs twice. | Freeze P3 first; do not manually prune generated code. |
| Hand-maintained migration drifts from baseline. | D1 updates migration, registry, and baseline together. | Migration test starts from the previous baseline. |
| User terminal and agent shell can be confused. | Restrict only agent tools. | Document that terminal UI retains existing permissions. |
| Removed block's Session needs discoverability. | Preserve Session but defer restoration/history UX. | Optional future product work; do not delete data now. |

## Product decisions that remain open

1. Whether a later release should support cancel-and-reset while busy.
2. Whether removed MasterAgent Sessions need a dedicated restoration UI now.
3. Whether per-block Coder overrides should be introduced after workspace-wide behavior proves useful.
4. How child Coder Sessions should be surfaced visually: inline, review panel, or existing child-session navigation.
5. Whether known tool-incompatible models should be blocked in the picker or merely warned.
6. Whether selecting the primary model as Coder needs only a soft warning or no warning.

## Defaults that must not drift

```text
Workspace setting:         coderModel
Per-block override:        no
Queue owner:               host Session subsystem
Session binding owner:     functionality instance
Routing:                   host Coder child Session
Primary mutation:          blocked when enabled
Fallback:                  none
Reset:                     idle and zero pending
Removal:                   preserve Session/queue
Event:                     transient synchronization hint
```
