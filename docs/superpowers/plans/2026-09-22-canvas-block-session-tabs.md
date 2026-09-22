# Canvas Block Session Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace Reset controls in all three session-capable canvas blocks with durable, block-owned tabs and a same-type, same-workspace archive.

**Architecture:** A server-owned registry stores tab identity, ownership, selected tab, creation order, and archive state. Master Agent and Operating Chat entries reference V2 sessions; Chat Relay entries reference live browser pages plus durable read-only snapshots. One shared canvas tab component renders the responsive strip and history menu, while a server-side removal operation archives tabs and removes the block descriptor.

**Tech Stack:** Bun, TypeScript, Effect, Drizzle/SQLite, SolidJS, Happy DOM, Playwright.

**Spec:** docs/superpowers/specs/2026-09-22-canvas-block-session-tabs-design.md

## Global Constraints

- Only Master Agent, Operating Chat, and Chat Relay blocks participate.
- Archives are shared only by blocks of the same type within the current workspace.
- Tabs and archive are server-owned; do not serialize session/tab IDs into canvas layout JSON.
- Tabs sort by creation time descending with stable ID tie-breaking; visible tabs show at least 16 title characters when available.
- The history menu shows at most six rows before scrolling and searches archived titles and exact conversation/tab IDs.
- Chat Relay saved tabs become read-only after worker/backend restart.
- Preserve Schema → Core/Protocol → Server runtime dependency direction. Client may use Schema/Protocol, never Core/Server.
- After public Protocol/Server HttpApi changes, run bun run generate in packages/client; never edit generated client files directly.
- Run tests and bun typecheck from package directories, never the repo root; preserve unrelated dirty files.

## File structure and dependencies

- packages/schema/src/canvas-tab.ts: shared tab identity, listing, mutation, and error payload schemas.
- packages/core/src/workspace/sql.ts and packages/core/src/workspace/canvas-tab.ts: durable registry tables and transactional repository.
- packages/core/src/workspace/master-agent.ts and operating-chat-session.ts: V2 binding integration, busy guards, and compatibility enrollment.
- packages/core/src/workspace/service.ts: authoritative archive-and-remove operation across layout descriptors.
- packages/server/src/chat-proxy-worker.mjs and packages/server/src/chat-proxy.ts: multiple live Chat Relay pages and persisted snapshots.
- packages/protocol/src/groups/workspace-canvas-tab.ts and packages/server/src/handlers/workspace-canvas-tab.ts: authenticated registry API.
- packages/app/src/pages/canvas/canvas-tabs.tsx and canvas-tabs.css: shared strip/menu; existing block bodies and workspace.tsx supply integration.

Dependency graph: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 8 → Task 9. Task 7 (UI component) can proceed after Task 1 independently of Tasks 2–6, and Task 8 waits for both Tasks 6 and 7. Within Task 5, worker-only tests and implementation can proceed in parallel with Task 4 because they do not touch the registry; integrate them in Task 5. Parallel workers must not edit the same file at the same time.

## Review Focus

1. A timed-out + request retried by the client must create only one tab: Task 3 tests an idempotency key.
2. A block ID present in multiple layout tuples must not resurrect after deletion: Task 4 tests all matching descriptors.
3. A stale Chat Relay page after restart must never accept a prompt: Task 5 tests read-only restoration.
4. A 16-character label containing wide or combined Unicode must remain legible at the visibility threshold: Task 7 tests measured minimum width.
5. Search with no archived matches must leave owned tabs intact and show an empty archived result: Task 7 tests filtering and empty state.

---

### Task 1: Define registry schema and migration

**Files:** Create packages/schema/src/canvas-tab.ts and packages/schema/test/canvas-tab.test.ts; modify packages/core/src/workspace/sql.ts; generate packages/core/schema.json, packages/core/src/database/schema.gen.ts, packages/core/src/database/migration.gen.ts, and one packages/core/src/database/migration/*_canvas-block-tabs.ts.

**Interfaces:** Produces CanvasTab.Kind, CanvasTab.Entry, CanvasTab.Cursor, CanvasTab.Page, and two SQL tables: CanvasTabTable and CanvasTabBlockTable. A tab row has workspace_id, kind, id, conversation_id, origin_block_id, owner_block_id, title, time_created, time_archived, and snapshot JSON. A block row has workspace_id, kind, block_id, selected_tab_id, revision, and deleted_at. Use unique workspace/kind/conversation identity and indexed creation-order queries.

- [ ] **Step 1: Write the failing schema test.** Decode one owned entry and reject an unsupported kind:

```ts
expect(Schema.decodeUnknownSync(CanvasTab.Entry)({
  id: 'tab-1', workspaceID, kind: 'master-agent', blockID: 'block-1',
  conversationID: sessionID, title: 'First session', createdAt: 10, writable: true,
})).toMatchObject({ id: 'tab-1', createdAt: 10 })
expect(() => Schema.decodeUnknownSync(CanvasTab.Kind)('notes')).toThrow()
```

- [ ] **Step 2: Run red.** From packages/schema: bun test test/canvas-tab.test.ts. Expected: missing CanvasTab export/schema.
- [ ] **Step 3: Add the schema and SQL tables.** Keep selected identity on the block row, not duplicated on every tab:

```ts
export const Kind = Schema.Literals(['master-agent', 'operating-chat', 'chat-relay'])
export const Entry = Schema.Struct({
  id: Schema.String, workspaceID: Workspace.ID, kind: Kind,
  blockID: Schema.optional(Schema.String), conversationID: Schema.String,
  title: Schema.String, createdAt: Schema.Number,
  archivedAt: Schema.optional(Schema.Number), writable: Schema.Boolean,
})
// CanvasTabBlockTable primary key: (workspace_id, kind, block_id).
// CanvasTabTable unique index: (workspace_id, kind, conversation_id).
```

Writable is computed by the service at read time; do not persist it as an authoritative flag. Add SQL indexes for owner and archive scans ordered by (time_created DESC, id DESC).
- [ ] **Step 4: Generate the migration and verify green.** From packages/core: bun run migration --name canvas-block-tabs, then bun script/migration.ts --check, bun typecheck. From packages/schema: bun test test/canvas-tab.test.ts and bun typecheck. Inspect generated SQL for workspace foreign keys and indexes.
- [ ] **Step 5: Commit only this task's files.** Message: feat(canvas): store block tab registry.

### Task 2: Build transactional registry queries and CAS

**Files:** Create packages/core/src/workspace/canvas-tab.ts and packages/core/test/workspace/canvas-tab.test.ts.

**Interfaces:** Consumes Task 1 tables/schemas. Produces CanvasTabService.Service with listOwned(workspaceID, kind, blockID, cursor, limit), listArchived(workspaceID, kind, search, cursor, limit), enroll(workspaceID, kind, blockID, conversationID, title, createdAt), add(input, expectedRevision, requestID), select(input, expectedRevision), restore(input, expectedRevision), and archiveBlock(input, expectedRevision). Mutation results return the new block revision and selected tab. Define typed NotFound, WrongKind, StaleRevision, Busy, and DeletedBlock errors here.

- [ ] **Step 1: Write failing repository tests.** Test newest-first paging with equal timestamps, archive search restricted to the same workspace/kind, duplicate enrollment, one owner per tab, stale revision, and a deleted-block fence:

```ts
// The fixture creates two archived 'alpha' tabs here and one in another workspace.
const page = yield* tabs.listArchived(workspaceID, 'master-agent', 'alpha', undefined, 2)
expect(page.items.map((item) => item.id)).toEqual(['newer-id', 'older-id'])
expect(page.next).toEqual({ createdAt: 10, id: 'older-id' })
const first = yield* tabs.enroll(workspaceID, 'master-agent', 'block-1', sessionID, 'alpha', 10)
const again = yield* tabs.enroll(workspaceID, 'master-agent', 'block-1', sessionID, 'alpha', 10)
expect(again.id).toBe(first.id)
```

- [ ] **Step 2: Run red.** From packages/core: bun test test/workspace/canvas-tab.test.ts. Expected: missing CanvasTabService.
- [ ] **Step 3: Implement repository operations in one db.transaction per mutation.** Use the block revision as the CAS guard and the tab's workspace/kind/owner predicates as the transfer guard:

```ts
const claimed = yield* tx.update(CanvasTabBlockTable)
  .set({ selected_tab_id: tabID, revision: expectedRevision + 1 })
  .where(and(eq(CanvasTabBlockTable.workspace_id, workspaceID),
    eq(CanvasTabBlockTable.block_id, blockID),
    eq(CanvasTabBlockTable.revision, expectedRevision),
    isNull(CanvasTabBlockTable.deleted_at)))
  .returning({ revision: CanvasTabBlockTable.revision }).get()
if (!claimed) return yield* new StaleRevision({ workspaceID, blockID })
```

Sort by time_created DESC, id DESC and seek with both fields. Search archived title case-insensitively or match the exact conversation/tab ID. Store requestID uniquely for add idempotency. Restore transfers ownership and selection in one transaction; Task 3 adds the V2 archive-marker transition to that transaction. Never reactivate a deleted block by an ordinary enroll.
- [ ] **Step 4: Run green and check types.** From packages/core: bun test test/workspace/canvas-tab.test.ts; bun typecheck. Add a migration test in packages/core/test/database-migration.test.ts proving an existing database upgrades without altering current bindings, then run that test.
- [ ] **Step 5: Commit.** Message: feat(canvas): add transactional tab registry.

### Task 3: Connect Master Agent and Operating Chat to V2 tabs

**Files:** Modify packages/core/src/workspace/master-agent.ts, packages/core/src/workspace/operating-chat-session.ts, packages/core/src/workspace/canvas-tab.ts, packages/schema/src/session-event.ts, and packages/core/src/session/projector.ts; add packages/core/test/workspace/master-agent-tabs.test.ts and packages/core/test/operating-chat-tabs.test.ts.

**Interfaces:** Consumes CanvasTabService from Task 2. Produces createTab and selectTab methods on each existing service, returning its existing Binding type plus registry revision. createTab takes expected binding revision and requestID. selectTab takes tabID and expected binding/registry revisions. Existing ensure/get enroll only the currently bound session idempotently.

- [ ] **Step 1: Write failing lifecycle tests.** Cover compatibility enrollment, + preserving the prior session, switching back to a writable old transcript, exact retry without duplicate session, wrong-workspace/tab rejection, active-run/pending-input busy rejection, two clients racing revisions, and restoration clearing the underlying V2 archive marker:

```ts
const first = yield* master.ensure(workspaceID, blockID)
const firstTabID = (yield* tabs.listOwned(workspaceID, 'master-agent', blockID, undefined, 10)).items[0]!.id
const next = yield* master.createTab(workspaceID, blockID, first.revision, 'request-1')
expect(next.binding.sessionID).not.toBe(first.sessionID)
const selected = yield* master.selectTab(workspaceID, blockID, firstTabID, next.binding.revision, next.tabRevision)
expect(selected.binding.sessionID).toBe(first.sessionID)
```

- [ ] **Step 2: Run red.** From packages/core: bun test test/workspace/master-agent-tabs.test.ts test/operating-chat-tabs.test.ts. Expected: missing lifecycle methods.
- [ ] **Step 3: Add the narrow lifecycle methods.** Reuse each service's existing session creation/configuration and busy checks; bind the chosen existing session with the functionality-instance CAS, and commit the selected registry ID with the same transition. On failure, retain the old binding and clean up only a losing empty candidate:

```ts
if ((yield* hasPendingInput(current.sessionID)) || (yield* isActive(current.sessionID)))
  return yield* new BusyError({ sessionID: current.sessionID })
const target = yield* sessions.get(tab.conversationID)
if (target.location.workspaceID !== workspaceID) return yield* new WrongTabError({ tabID })
// Apply instance binding revision and CanvasTabBlock selected_tab_id in one DB transaction.
```

Do not reconstruct pre-feature reset sessions by guessing their owner. Define a durable SessionEvent archive-state change in packages/schema/src/session-event.ts (including its durable inventory) and project it in packages/core/src/session/projector.ts. On archive restoration, clear the session archive marker in the same transaction as transfer and binding; a projection rebuild must arrive at the same state. Emit existing binding-updated events after a successful commit.
- [ ] **Step 4: Run green and regressions.** From packages/core: run the new files plus test/workspace/master-agent.test.ts and test/operating-chat-session.test.ts, then bun typecheck.
- [ ] **Step 5: Commit.** Message: feat(canvas): switch block-owned V2 sessions.

### Task 4: Archive tabs and remove a block authoritatively

**Files:** Modify packages/core/src/workspace/service.ts and packages/core/src/workspace/canvas-tab.ts; add packages/core/test/workspace/canvas-tab-removal.test.ts.

**Interfaces:** Consumes Task 2 registry. Produces WorkspaceService.block.archiveAndRemove(workspaceID, blockID, kind, tuple, expectedLayoutRevision, clientID, user), returning { archivedCount, layoutRevision, tabRevision }. The tuple is Workspace.Layout.Tuple with the authenticated user applied. It archives all owned tabs, sets V2 SessionTable.time_archived for Master Agent/Operating Chat, fences the block, tombstones the functionality instance, and removes the block ID from every matching workspace layout tuple in one database transaction. Chat Relay page cleanup runs only after commit and must retain restorable live archived pages.

- [ ] **Step 1: Write failing removal tests.** Test cancellation at UI later; here test success, CAS conflict, archive failure rollback, retry idempotency, replay of the V2 archived state, and two layout tuples sharing the same block ID:

```ts
const removed = yield* workspace.block.archiveAndRemove(workspaceID, blockID, 'master-agent', tuple, revision, clientID, user)
expect(removed.archivedCount).toBe(2)
expect((yield* tabs.listArchived(workspaceID, 'master-agent', '', undefined, 10)).items).toHaveLength(2)
expect(yield* workspace.block.get(workspaceID, blockID)).toBeUndefined()
expect((yield* sessions.get(firstSessionID)).time.archived).toBeDefined()
```

- [ ] **Step 2: Run red.** From packages/core: bun test test/workspace/canvas-tab-removal.test.ts. Expected: missing archiveAndRemove.
- [ ] **Step 3: Implement one authoritative transaction.** Resolve all layout rows containing the block within the authorized workspace, check the authoritative client/revision and user, update every matching descriptor and revision, archive registry/session rows, then tombstone the functionality instance. Record the V2 archive state through a durable event/projection path so replay keeps SessionTable.time_archived aligned. Publish layout/registry events after commit; do not call the current post-save cleanup path before archiving:

```ts
// matchingLayouts, requireRemovalAuthority, archiveOwnedTabs,
// removeBlockFromLayouts, and fenceBlock are local helpers in service.ts.
const result = yield* db.transaction((tx) => Effect.gen(function* () {
  const layouts = yield* matchingLayouts(tx, workspaceID, blockID)
  yield* requireRemovalAuthority(layouts, expectedLayoutRevision, clientID, user)
  const archivedCount = yield* archiveOwnedTabs(tx, workspaceID, kind, blockID)
  yield* removeBlockFromLayouts(tx, layouts, blockID)
  yield* fenceBlock(tx, workspaceID, kind, blockID)
  return { archivedCount, layoutRevision: expectedLayoutRevision + 1 }
}))
```

Keep generic workspace.layout.save from silently removing a session block without this operation: reject that delta or route it through the same archive transaction. This covers clients older than the new UI.
- [ ] **Step 4: Run green and existing layout tests.** From packages/core: run removal test, test/workspace/workspace-handover.test.ts, the relevant Session event replay tests, and bun typecheck.
- [ ] **Step 5: Commit.** Message: feat(canvas): archive tabs before block removal.

### Task 5: Preserve Chat Relay tabs and restart snapshots

**Files:** Modify packages/server/src/chat-proxy-worker.mjs, packages/server/src/chat-proxy.ts, packages/server/src/handlers/chat-proxy.ts, packages/schema/src/chat-proxy.ts, and packages/core/src/workspace/canvas-tab.ts; update packages/server/test/chat-proxy-worker.test.mjs, packages/server/test/chat-proxy-worker.browser.integration.mjs, and packages/server/test/chat-proxy-service.test.ts.

**Interfaces:** Consumes Task 2 registry. Produces ChatProxyService.createTab(user, workspaceID, blockID, requestID), selectTab(user, workspaceID, blockID, tabID), snapshotTab(user, workspaceID, blockID, tabID), and archiveBlock(user, workspaceID, blockID). Each live tab keeps its own page and messages, keyed by tabID; the registry owns block selection and durable snapshot. The worker returns snapshots; the authenticated handler persists them through CanvasTabService after each mutating worker response. snapshotTab returns a read-only saved transcript when no live page exists.

- [ ] **Step 1: Write failing worker/service tests.** Assert + creates a second tab without closing the first, old tab can resume prompts, archive/restore changes ownership without stale access, the authenticated service returns the saved transcript as read-only after worker restart, and prompt against a stale tab rejects:

```js
const first = await worker.execute('ensure', owner)
const second = await worker.execute('createTab', { ...owner, requestID: 'new-1' })
expect(first.tabID).not.toBe(second.tabID)
expect(pages.get(first.tabID).isClosed()).toBe(false)
// After constructing a fresh worker, query persisted history through the service.
expect((await service.snapshotTab({ ...owner, tabID: first.tabID })).readonly).toBe(true)
await expect(restarted.execute('prompt', { ...owner, tabID: first.tabID, text: 'hi' })).rejects.toThrow()
```

- [ ] **Step 2: Run red.** From packages/server: bun test test/chat-proxy-worker.test.mjs test/chat-proxy-service.test.ts. Expected: createTab/snapshotTab unavailable and old page closed.
- [ ] **Step 3: Change worker ownership from one state per block to tabID-indexed states plus selected ID.** Keep older pages alive within the worker. Return the updated snapshot after each transcript/title/URL change and persist it through the authenticated handler into CanvasTabService. Derive readonly from whether a live page is present. Do not accept a prompt merely because a saved snapshot contains an old tabID:

```js
function requireLiveTab(user, workspaceID, blockID, tabID) {
  const state = liveTabs.get(tabID)
  if (!state || state.workspaceID !== workspaceID || state.blockID !== blockID || state.page.isClosed())
    throw staleTab()
  return state
}
```

Adapt existing reset API callers to create/select behavior until the UI no longer calls reset. Keep Chat Relay's separate V2 session binding unchanged.
- [ ] **Step 4: Run green and browser integration.** From packages/server: run both worker test files, test/chat-proxy-service.test.ts, and bun typecheck. Verify saved snapshots contain no credentials/cookies.
- [ ] **Step 5: Commit.** Message: feat(canvas): retain chat relay tab history.

### Task 6: Expose authenticated registry APIs and regenerate clients

**Files:** Create packages/protocol/src/groups/workspace-canvas-tab.ts, packages/server/src/handlers/workspace-canvas-tab.ts, packages/protocol/test/workspace-canvas-tab.test.ts, packages/server/test/handlers/workspace-canvas-tab.test.ts, and packages/server/test/workspace-canvas-tab-removal.test.ts; modify packages/protocol/src/api.ts, packages/server/src/handlers/workspace.ts, packages/server/src/routes.ts, packages/opencode/src/server/routes/instance/httpapi/server.ts, packages/schema/src/workspace-event.ts; generate packages/client/src/generated and packages/client/src/generated-effect.

**Interfaces:** Consumes Tasks 3–5. Produces GET /api/workspace/:workspaceID/canvas-tab/:kind/owned/:blockID, GET /api/workspace/:workspaceID/canvas-tab/:kind/archived, POST /api/workspace/:workspaceID/canvas-tab/:kind/owned/:blockID/create, POST .../select, POST .../restore, and POST .../archive-and-remove. Query includes limit, search, and stable cursor. Mutations include expectedRevision, and create includes requestID. Archive-and-remove includes tuple, expectedLayoutRevision, and clientID. Responses expose selected tab and registry revision. Typed 403/404/409 errors cover access, missing tab, wrong type, stale revision, and busy state.

- [ ] **Step 1: Write failing protocol/handler tests.** Validate malformed cursor/limit, cross-workspace access, cross-type restoration, stale revision, busy response, stable page order, and archive-and-remove idempotency and failure rollback through the HTTP endpoint:

```ts
const page = yield* client['workspace.canvasTab.listArchived']({
  params: { workspaceID }, query: { kind: 'master-agent', limit: 6, search: 'alpha' },
})
expect(page.items.every((item) => item.workspaceID === workspaceID)).toBe(true)
expect(page.items.map((item) => item.createdAt)).toEqual([30, 20, 10])
```

- [ ] **Step 2: Run red.** From packages/protocol: bun test test/workspace-canvas-tab.test.ts. From packages/server: bun test test/handlers/workspace-canvas-tab.test.ts test/workspace-canvas-tab-removal.test.ts. Expected: group/handler absent.
- [ ] **Step 3: Add schemas, group, and thin handlers.** Authenticate with requestUser and WorkspaceService.get(workspaceID, user.id) before dispatching to the correct block lifecycle service. Use only the shared public schema for request/response types:

```ts
const user = yield* requestUser
yield* workspace.get(ctx.params.workspaceID, user.id)
return yield* tabs.listArchived(ctx.params.workspaceID, ctx.query.kind,
  ctx.query.search ?? '', ctx.query.cursor, ctx.query.limit ?? 6)
```

Mount the group/layer in both server compositions and publish a workspace-scoped registry-changed event after committed mutations.
- [ ] **Step 4: Generate and verify.** From packages/client: bun run generate, bun run check:generated, bun typecheck. Run the protocol/server tests and bun typecheck in each package. Do not hand-edit generated files.
- [ ] **Step 5: Commit.** Message: feat(canvas): expose block tab history API.

### Task 7: Build the responsive canvas tab strip and history menu

**Files:** Create packages/app/src/pages/canvas/canvas-tabs.tsx, canvas-tabs.css, canvas-tabs.browser.test.tsx, and canvas-tab-layout.ts with canvas-tab-layout.test.ts.

**Interfaces:** Consumes CanvasTab.Entry/Page from Task 1. Produces CanvasTabs(props) with owned, archived, selectedID, status, loading/error, search/onSearch, onCreate, onSelect, onRestore, onLoadMore, and onRetry callbacks. The pure visibleTabs(entries, selectedID, availableWidth, measuredWidths) function returns visible and overflow IDs without shrinking any visible label below its measured 16-character minimum.

- [ ] **Step 1: Write failing layout and DOM tests.** Cover wide/narrow widths, selected old tab, long and Unicode titles, plus/ellipsis positioning, six visible menu rows, scroll pagination, archived search, empty/error/retry, keyboard selection/Escape/outside click:

```ts
expect(visibleTabs(entries, 'old', 420, widths).visible).toContain('old')
expect(visibleTabs(entries, 'old', 220, widths).visible.length).toBeLessThan(3)
expect(menu.querySelectorAll('[role="option"]').length).toBeGreaterThan(6)
expect(host.querySelector('input[aria-label="Search archived sessions"]')).not.toBeNull()
```

- [ ] **Step 2: Run red.** From packages/app: bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/canvas-tab-layout.test.ts; then bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/canvas-tabs.browser.test.tsx. Expected: components/helper absent.
- [ ] **Step 3: Implement the shared component.** Observe its own width, measure the first 16 Unicode graphemes in the actual tab font, reserve +, ellipsis, and status widths, then select whole tabs. Keep active first if space permits, then newest remaining. Use canvas tokens and no shadows:

```css
.canvas-tab-history-list { --canvas-tab-row-height: 40px; max-height: calc(6 * var(--canvas-tab-row-height)); overflow-y: auto; }
.canvas-tab-strip { min-width: 0; display: flex; align-items: center; }
.canvas-tab-button:focus-visible { outline: 2px solid var(--accent); }
```

The menu contains owned tabs plus same-type archived tabs; search filters only archived entries. Keep the selected title in the menu when no tab fits.
- [ ] **Step 4: Run green and typecheck.** Run both new tests and bun typecheck from packages/app; in Playwright verify the menu viewport is no taller than six rows while additional rows scroll, then inspect minimum-width and wide cards in light and dark canvas themes.
- [ ] **Step 5: Commit.** Message: feat(canvas): add responsive session tabs.

### Task 8: Wire all three block bodies to the registry

**Files:** Create packages/app/src/pages/canvas/canvas-tab-controller.ts. Modify packages/app/src/pages/canvas/master-agent/block.tsx, master-agent/block-shell.tsx, master-agent/master-agent.css, packages/app/src/pages/canvas/workspace.tsx (OperatingChatBody only), packages/app/src/pages/canvas/session-target.tsx, session-surface.tsx, packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts, blocks/chat-relay/view.tsx, packages/app/src/pages/canvas/block-chat.tsx, block-chat.css, and matching existing browser tests.

**Interfaces:** Consumes Tasks 6–7 APIs/component. createCanvasTabController(workspaceID, kind, blockID, client) exposes owned(), archived(), selectedID(), create(), select(), restore(), loadMore(), search(), setSearch(), retry(), and error(). Master Agent and Operating Chat pass this controller through CanvasSessionSurface props to BlockChat's status row and rebind CanvasSessionSurfaceProviders to the selected V2 session. Chat Relay places CanvasTabs in its own status row and selects its live relay or saved snapshot; readonly snapshots render transcript without composer.

- [ ] **Step 1: Update tests first.** In master-agent/block-shell.test.tsx, operating-chat.browser.test.tsx, blocks/chat-relay/view.browser.test.tsx, session-surface-providers.browser.test.tsx, master-agent.e2e.browser.test.tsx, and packages/app/e2e/chat-relay-controls.spec.ts, assert the existing Reset control disappears, + selects a new conversation, old tabs are still writable, readonly Relay after restart hides its composer, and layout JSON contains no tab IDs:

```ts
expect([...host.querySelectorAll('button')].some((button) => /Reset session/i.test(button.textContent ?? ''))).toBe(false)
host.querySelector<HTMLButtonElement>('button[aria-label="New session"]')!.click()
await waitFor(() => host.querySelector('[data-chat-session="session-2"]'))
expect(savedLayout.blocks[0]).not.toHaveProperty('sessionID')
```

- [ ] **Step 2: Run red.** From packages/app, run the targeted browser files with bun test --conditions=browser --isolate --preload ./happydom.ts, and run the Playwright scenario with bun run test:e2e e2e/chat-relay-controls.spec.ts. Expected: Reset is still rendered and + is absent.
- [ ] **Step 3: Replace the block-specific reset controls with CanvasTabs.** Subscribe to registry events/query, preserve existing Full page and Open ChatGPT actions, and make mutation failures leave the old target mounted:

```tsx
<CanvasTabs owned={tabs.owned()} archived={tabs.archived()}
  selectedID={tabs.selectedID()} status={status()}
  search={tabs.search()} onSearch={tabs.setSearch}
  onCreate={tabs.create} onSelect={tabs.select}
  onRestore={tabs.restore} onLoadMore={tabs.loadMore} onRetry={tabs.retry} />
```

Remove the explanatory text on the left of each status panel, put the tabs at its left edge, and retain the Ready/Working/Attention indicator at the right. Keep session IDs in runtime view/context, never in canvas layout or local persistence. On an uncertain create response, re-read registry by requestID before offering retry so it cannot duplicate a conversation.
- [ ] **Step 4: Run green and regressions.** From packages/app: run targeted browser files, bun run test:e2e e2e/chat-relay-controls.spec.ts, bun run test:unit, and bun typecheck. Inspect wide/narrow block renders against the canvas palette.
- [ ] **Step 5: Commit.** Message: feat(canvas): use tabs in session blocks.

### Task 9: Add confirmed archive-on-remove UI

**Files:** Modify packages/app/src/pages/canvas/workspace.tsx; create packages/app/src/pages/canvas/archive-block-dialog.tsx and packages/app/src/pages/canvas/archive-block-dialog.browser.test.tsx; update packages/app/src/pages/canvas/master-agent.e2e.browser.test.tsx and blocks/chat-relay/view.browser.test.tsx.

**Interfaces:** Consumes Task 6 archiveAndRemove endpoint. The existing remove button and Delete/Backspace shortcut call one requestRemoveBlock(blockID) path. Local helpers sessionKind(block), confirmArchive(block, count), tabCount(block), archiveAndRemove(block), and applyCommittedRemoval(id, revision) live in workspace.tsx or archive-block-dialog.tsx. Session-capable blocks open a confirmation with tab count; ordinary blocks retain direct removal. Confirm waits for authoritative server success before local removal; cancel/error changes neither local layout nor selection.

- [ ] **Step 1: Write failing removal tests.** Assert both entry points open the same confirmation, cancel preserves the block, server failure preserves it with an error, successful archive removes it, and exactly the same blockID reaches the API:

```ts
removeButton.click()
expect(dialog.textContent).toContain('archive 2 sessions')
cancelButton.click()
expect(host.querySelector('[data-card-id="block-1"]')).not.toBeNull()
removeButton.click()
host.querySelector<HTMLButtonElement>('[role="dialog"] button[data-confirm-archive]')!.click()
await waitFor(() => host.querySelector('[data-card-id="block-1"]') === null)
```

- [ ] **Step 2: Run red.** From packages/app: bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/archive-block-dialog.browser.test.tsx. Expected: dialog absent/direct local removal.
- [ ] **Step 3: Implement a single guarded removal path.** Use the existing DialogV2 danger-confirm pattern. Disable confirm while submitting, show a scoped error on failure, and only remove the local card after the server returns archivedCount and layoutRevision:

```ts
async function requestRemoveBlock(id: string) {
  const block = state.blocks.find((item) => item.id === id)
  if (!block) return
  if (!sessionKind(block)) return removeOrdinaryBlock(id)
  const confirmed = await confirmArchive(block, await tabCount(block))
  if (!confirmed) return
  const result = await archiveAndRemove(block)
  applyCommittedRemoval(id, result.layoutRevision)
}
```

- [ ] **Step 4: Run green and deletion regressions.** From packages/app: run dialog test, master-agent.e2e.browser.test.tsx, relevant Chat Relay view test, bun typecheck, and bun run test:unit.
- [ ] **Step 5: Commit.** Message: feat(canvas): confirm block tab archive.

## Integrated verification

During Task 8, before production wiring, add the Chat Relay restart/read-only scenario to packages/app/e2e/chat-relay-controls.spec.ts and the cross-block restore-and-prompt scenario to packages/app/src/pages/canvas/master-agent.e2e.browser.test.tsx. After Task 9, verify that a deleted block's archived tab appears in another same-type block in the same workspace, can become its active conversation, and can accept a new message; verify that a restarted Chat Relay snapshot cannot.

From each affected package run bun typecheck. From packages/core run the new registry/removal tests and bun script/migration.ts --check; from packages/protocol and packages/server run their new API/worker suites; from packages/client run bun run check:generated; from packages/app run bun run test:unit, bun run test:browser, and the targeted Playwright scenario. Run full package suites where practical and report every observed failure by file/test name, including pre-existing failures. Inspect git diff --check and review only this feature's diff; do not stage existing unrelated changes.
