# Canvas block session tabs and shared archive

## Intent and scope

Replace the Reset session control in every session-capable canvas block (Master Agent, Operating Chat, and Chat Relay) with an in-block tab strip. A block may hold multiple conversation tabs, select an older one, and start a fresh one with `+`. Deleting a block archives its tabs after confirmation. Archived tabs are discoverable and restorable from any block of the same type in the same workspace. No history crosses block types or workspace boundaries.

This is a server-owned feature, not an extension of the app's global titlebar tabs. Global titlebar tab state remains independent, although archiving a V2 conversation also updates its ordinary session-archive state. The canvas preserves its existing flat, rounded, accent-coloured art style.

## Ownership and lifecycle

The server stores a tab registry keyed by workspace, block type, and tab identity. Each entry records its originating block, current owning block (or archived state), conversation reference, title, and creation time. Writable capability is determined from the current conversation/runtime state, not trusted from a saved flag. A block has at most one selected tab; it may retain other inactive tabs. A tab has at most one owning block. All list, create, select, archive, and restore operations authorize the workspace and verify that the target block has the same functionality type.

`+` creates a new conversation, adds a registry entry, and selects it. Existing tabs remain available. Selecting a tab makes it the block's active conversation; its composer, transcript, drafts, and context target rebind to that conversation. Restoring an archived tab atomically moves it to the receiving block and selects it. The receiving block's former active tab remains among its inactive tabs. Concurrent selection, creation, and archive operations use revisions/compare-and-swap so a stale client cannot silently overwrite another choice. Do not replace a live binding while it has active execution or pending admitted input; report the existing busy condition and keep the prior selection.

Master Agent and Operating Chat tabs reference durable V2 sessions. Their registry, selected tab, and transcripts survive app and backend restarts. Existing single-session bindings are enrolled idempotently when first read; sessions from resets before this feature have no reliable block ownership metadata and are not guessed into a block's history. They remain in the existing global session history.

Chat Relay entries reference browser-backed conversations while the worker is alive. Starting a new tab must not close older live tabs. The server saves their titles, creation times, URLs where available, and transcript snapshots. A live archived tab restored before a worker restart can continue chatting. After a backend/worker restart, saved Chat Relay tabs remain searchable and selectable, but are read-only even when selected as a block's active tab; the composer is hidden and `+` creates a new writable conversation. This limitation is explicit in the UI. The server must never claim a stale browser page is writable.

## Block removal and archive

The remove button and Delete/Backspace shortcut use the same confirmation for session-capable blocks. The dialog states how many tabs will be archived and that they can be restored from same-type blocks in this workspace. Cancel changes nothing. Confirm asks the server to archive all tabs, tombstone the binding, and persist removal of the block descriptor as one authoritative deletion operation; the canvas removes its local block only after that succeeds. If the operation fails, the block remains visible with an error. The operation must be idempotent, and a concurrent create/select cannot leave an owned tab behind after block deletion. Non-session blocks keep their current removal behavior.

Archiving preserves conversations; it does not delete their transcripts. For Master Agent and Operating Chat, the server marks the underlying V2 session archived together with its registry entry, so ordinary active-session lists do not continue presenting it as active. Restoration clears that session archive marker while assigning the tab to its receiving block. An archived tab no longer belongs to the removed block. The server returns a count and current registry revision so clients can reconcile after network errors.

## Canvas tab UI

In the panel containing the Ready/Working/Attention indicator, remove the explanatory text on the left and place the tabs at the left edge. Keep the indicator at the right. Remove the Reset session buttons from all three block types; preserve unrelated actions, such as opening a full page or opening ChatGPT, without crowding the tab strip. A selected read-only Chat Relay tab shows an unobtrusive read-only state.

Tabs are ordered by **creation time, newest first**, with stable identity as the tie-breaker. The selected tab is kept visible when there is room; remaining room shows as many recent tabs as fit. A visible tab reserves enough width to display at least the first 16 characters of its title when the title is that long. Resizing a block recomputes the visible count; it moves whole tabs into overflow rather than shrinking their labels below that minimum. If the block is too narrow for one tab plus controls, the active title remains accessible through the history menu. A `+` control starts a new tab. A three-dot button is the rightmost control after the visible recent tabs and opens the history menu.

The menu contains every tab owned by the block and the same-type archive for the current workspace. It sorts each set by creation time, newest first, marks the selected and archived states, and presents a search field that filters archived tabs by title (and exact conversation/tab ID) without searching transcript contents. The results area is at most six tab rows high and scrolls for more. A clear empty state covers no tabs and no search matches. Keyboard focus, Enter/Space selection, Escape, outside-click dismissal, and accessible names follow existing canvas controls. The menu uses canvas surface, border, text, accent, and focus tokens; no new shadow/elevation system.

## Integration and failure handling

Add registry-backed APIs/events for listing/paging, new-tab creation, selection, block archive, and archive restoration. Keep runtime dependency direction from Schema through Core/Protocol to Server. Generate client bindings after public Protocol/Server `HttpApi` changes. Do not edit generated client code directly. Canvas block runtime views expose only the selected conversation plus the registry query needed by the shared tab component; they must not write session IDs into layout serialization.

Load history in pages so the menu can scroll through all entries without eagerly fetching every session. Preserve creation-time order across pages. Refresh the current block and same-type archive when registry events arrive. If list or search fails, retain currently visible tabs and show a retryable menu error. If create, select, or restore fails, keep the previous active conversation and show a scoped error. Reconcile an uncertain mutation by re-reading the registry before offering retry, so a duplicate conversation is not created.

## Verification and acceptance

- Core and API tests cover workspace/type authorization, unique ownership, creation order, pagination/search, single selected tab, concurrent revisions, busy guards, atomic restore, archive idempotency, and archive failure without block removal.
- Master Agent and Operating Chat integration tests prove transcripts remain writable after switching and after app/backend restart.
- Chat Relay tests prove older live tabs remain usable, snapshots survive restart as read-only, and stale pages cannot accept prompts.
- Canvas browser tests cover all three block types, absence of Reset controls and left explanatory text, `+`, responsive 16-character minimum, selected-tab visibility, three-dot overflow, six-row scrolling, search/empty/error states, keyboard access, and visual token reuse.
- Deletion tests cover both button and keyboard paths, confirmation cancellation, successful archiving, and failure that leaves the block in place.

## Out of scope

No cross-workspace archive, cross-type restore, transcript-content search, automatic recovery of pre-feature orphaned reset sessions, or change to global titlebar tabs.
