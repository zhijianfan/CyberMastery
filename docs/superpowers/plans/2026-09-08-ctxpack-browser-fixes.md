# CtxPack Browser Fixes Implementation Plan

> For agentic workers: use subagent-driven development. Preserve existing working-tree changes and do not restart running services.

**Goal:** Fix all defects identified in the CtxPack Browser backend/frontend review, including incomplete metadata editing and attachment preview.

**Approach:** Repair existing services, repository predicates, attachment lifecycle, runtime refresh ownership, and transport integration. Keep public wire shapes stable and reuse existing UI and test infrastructure.

## Tasks

- [x] Backend privacy, search, and concurrency
  - Add regressions for private pagination/cursors and ownership lookup failures.
  - Filter unauthorized private packs before pagination/counting; fail closed.
  - Apply existing FTS sanitization to browser searches.
  - Make patch/delete/restore revision checks atomic with writes.
  - Run focused real-repository/service tests and Core typecheck.
- [x] Browser runtime and metadata editor
  - Add integrated host/adapter regressions for selection, stale data, and reconnect requests.
  - Give refresh a single owner while preserving existing projected state.
  - Replace the empty metadata patch with title/keyword/sensitivity editing, validation and errors.
  - Use typed localization for new visible copy and regression-test user actions.
- [x] Composer attachments and preview
  - Isolate stores by composer target and clear on workspace/target changes.
  - Preserve in-flight/new/removed attachments across submission success/failure.
  - Prevent submission while materialization is pending with an explanatory state.
  - Load attachment preview through the authorized pack detail API.
  - Test store isolation, lifecycle, submission, and preview.
- [x] Prompt transport
  - Add a real-client transport regression for contextAttachments.
  - Use the current generated prompt transport without changing unrelated client APIs.
  - Preserve ordinary prompt metadata, queue/steer, errors, and authentication.
- [x] Browser acceptance and verification
  - Repair test imports, current endpoints, actual saved identities, drag actions and rollback assertions.
  - Run deterministic browser journeys and relevant production benchmark before/after session changes.
  - Run package typechecks and focused integration suites.
  - Review the final scoped diff and update verification documentation with fresh evidence and limits.

## Coordination

Backend work owns Core CtxPack files/tests. Browser work owns browser block/adapter/runtime files/tests. Composer and transport work owns attachment store, prompt components/submission, SDK integration and tests. Acceptance work owns E2E and verification documentation. Shared English localization additions must be coordinated. No generated source is edited by hand; if public Protocol/HttpApi changes become necessary, regenerate from packages/client.

## Decisions

- The user's request to fix all reviewed issues authorizes these bounded corrections; no further design approval is required.
- Apply fixes to the current feature checkout so existing uncommitted implementation remains included. Do not commit, reset, or replace unrelated changes.
- Existing version-one deferrals that were not review defects remain out of scope.

## Additional defects found during verification

- Normalize composer identity before resetting its attachment store so routine session updates preserve drafts.
- Recognize native drag MIME types during protected dragover; validate payload contents on drop.
- Use one Solid runtime for selection, draft, and create-dialog reactivity.
- Preserve loaded pages after both event refreshes and metadata mutations.
- Clear cached contents on permission denial, and retain metadata edits when a concurrent refresh overlaps a failed save.
- Exclude accessible button controls from canvas body-drag gestures so pack cards open normally in edit mode.
- Resolve routed composers' workspace from their session projection when no explicit canvas workspace is supplied.
