# ChatRelay File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI message composer accept client-local text/source files as named attachments by adding the missing ChatRelay path, including restart-safe drafts and real uploads into the controlled ChatGPT conversation.

**Architecture:** Reuse the existing `PromptInputV2` attachment controller and blob-aware `DraftStore`. ChatRelay keeps its CtxPack-first drop handler, persists full drafts through `DraftStore`, converts captured blob references to data URIs only during runtime submission, carries the canonical public file shape through ChatProxy, and lets the Playwright worker upload in-memory file payloads through ChatGPT's visible composer before admission and Send.

**Tech Stack:** SolidJS, TypeScript, Effect Schema/HttpApi, Bun, the generated Promise and Effect clients, the legacy JavaScript SDK, Playwright, and the existing ChatProxy JSON worker channel.

**Spec:** [`docs/superpowers/specs/2026-09-15-chat-relay-file-attachments-design.md`](../specs/2026-09-15-chat-relay-file-attachments-design.md)

## Global Constraints

- Scope is AI message composers only. Scratchpad/Notes remains unchanged.
- The session, new-session, Operating Chat, and MasterAgent composers already inherit text/source drop support from `PromptInputV2`; do not duplicate or rewrite that implementation.
- Reuse the existing `Prompt.FileAttachment` schema shape (`uri`, `mime`, optional `name`, `description`, and `source`) and send only `uri`, `mime`, and `name` from ChatRelay.
- Accept only base64 `data:` URIs at the authenticated ChatProxy handler. Never dereference a client path or remote URL on the server.
- Keep raw data URIs and file bytes out of transcript messages, logs, errors, local-view storage, request metadata, and admitted worker state.
- Keep CtxPack handling first in the existing `view.onDrop` chain. Returning `true` must consume the drop; returning `false` must let the shared file handler run.
- Preserve message-ID reconciliation, the draft revision guard, workspace/block/tab ownership, and uncertain-send behavior.
- Upload and acknowledge every file before `admit()` and the Send click. Any conversion, file-input, or acknowledgement failure is pre-admission and leaves the App draft intact.
- Do not create temporary server files, a multipart endpoint, an upload service, or a ChatRelay-specific attachment-card component.
- Keep `BlockRuntimeServices.draftStore` optional so tests and other runtimes are not forced to supply it.
- Preserve the user's existing uncommitted CtxPack work, especially the `CtxPackLimits` change in `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`; this plan does not need to edit that file.
- Follow repository style: no `any`, import aliases, star imports, unnecessary helpers, or direct edits to generated clients.
- Run tests and `bun typecheck` from package directories, never from repository root and never with `tsc` directly.
- After the public payload changes, run `bun run generate` from `packages/client`, then run the legacy SDK generator. Do not edit generated output by hand.

---

## Task 1: Add and enforce the public ChatProxy file contract

**Files:**

- Modify: `packages/schema/src/chat-proxy.ts`
- Modify: `packages/protocol/test/chat-proxy.test.ts`
- Modify: `packages/server/src/handlers/chat-proxy.ts`
- Modify: `packages/server/test/chat-proxy-handler.test.ts`

### Step 1: Write the failing schema and protocol tests

- [ ] Extend `packages/protocol/test/chat-proxy.test.ts` with a prompt payload containing two files, one named and one unnamed:

```ts
files: [
  { uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "notes.txt" },
  { uri: "data:application/json;base64,e30=", mime: "application/json" },
]
```

- [ ] Assert the HttpApi request schema decodes the array without losing order or optional `name`.
- [ ] Run the focused protocol test from `packages/protocol` and confirm it fails because `ChatProxy.PromptPayload` does not yet accept `files`.

### Step 2: Add the failing handler acceptance tests

- [ ] Extend the backend call capture in `packages/server/test/chat-proxy-handler.test.ts` with a final optional `files` argument.
- [ ] Add a valid file-only request test using `text: ""`. Assert:
  - the exact file array reaches `service.prompt`;
  - the local/display text contains `notes.txt` and no `data:` URI;
  - browser text remains exactly `""`;
  - the request identity is non-empty.
- [ ] Add an idempotency test that reuses one `messageID` with one changed field at a time: bytes, MIME type, and filename. Assert each variant produces a different request identity and therefore conflicts with an admitted request.
- [ ] Add invalid URI tests for `file:///tmp/notes.txt`, `https://example.com/notes.txt`, a non-base64 `data:` URI, and a `data:` MIME that disagrees with `file.mime`. Assert both `reconcilePrompt` and `prompt` have zero calls.
- [ ] Run the focused handler tests from `packages/server` and confirm they fail for the missing payload/forwarding behavior.

### Step 3: Extend the schema with the canonical file type

- [ ] Import `FileAttachment` from `./prompt` in `packages/schema/src/chat-proxy.ts`.
- [ ] Extend `PromptPayload` without introducing a duplicate schema:

```ts
export const PromptPayload = Schema.Struct({
  tabID: Schema.String,
  messageID: Schema.String,
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(optional),
  contextAttachments: optional(SessionInput.ContextAttachments),
  skills: optional(Schema.Array(Skill.Selection)),
}).annotate({ identifier: "ChatProxy.PromptPayload" })
```

- [ ] Re-run the protocol test and confirm the file payload now decodes.

### Step 4: Validate before reconciliation or browser work

- [ ] In `packages/server/src/handlers/chat-proxy.ts`, validate `ctx.payload.files` immediately after `requireRelayBlock(...)` and before the text-only fast path or `reconcilePrompt(...)`.
- [ ] Accept only the App's exact `data:<mime>;base64,<payload>` form. Require the embedded MIME to equal `file.mime`, require a syntactically valid base64 payload, and allow an empty base64 payload for an empty file.
- [ ] Map failures to an `InvalidRequestError` with stable kind `chat_proxy_file_attachment` and a message that contains neither filename nor URI.
- [ ] Keep the old fast path only when all three optional features are absent:

```ts
if (!ctx.payload.files?.length && !ctx.payload.contextAttachments?.length && !ctx.payload.skills?.length) {
  // existing text-only call
}
```

### Step 5: Make display and retry identity file-aware

- [ ] Include ordered file metadata and a hash of each URI in the request identity. Do not serialize raw data URIs into a loggable intermediate value:

```ts
files: (ctx.payload.files ?? []).map((file) => ({
  uriHash: Hash.sha256(file.uri),
  mime: file.mime,
  name: file.name,
})),
```

- [ ] Keep `browserText` as the existing user text plus selected-skill/CtxPack envelope. File-only input therefore passes `""` to the worker textarea.
- [ ] Append a filename-only line to `displayText`, using the same JSON-string quoting style as the existing context/skill labels:

```ts
const fileLabels = (ctx.payload.files ?? []).map((file) => JSON.stringify(file.name ?? "attachment")).join(", ")
```

- [ ] Pass `ctx.payload.files` as the final service argument. Ensure CtxPack usage accounting is unchanged.
- [ ] Re-run `bun test test/chat-proxy-handler.test.ts` from `packages/server` and the focused protocol test from `packages/protocol`.

### Step 6: Commit the contract boundary

- [ ] Review the staged diff for raw data URI literals outside tests and for accidental changes to unrelated dirty files.
- [ ] Commit only these source/tests:

```text
feat(server): accept ChatRelay file attachments
```

---

## Task 2: Upload files through the controlled ChatGPT composer

**Files:**

- Modify: `packages/server/src/chat-proxy.ts`
- Modify: `packages/server/src/chat-proxy-worker.mjs`
- Modify: `packages/server/test/chat-proxy-service.test.ts`
- Modify: `packages/server/test/chat-proxy-worker.test.mjs`
- Modify: `packages/server/test/chat-proxy-worker.browser.integration.mjs`

### Step 1: Write the failing service transport test

- [ ] Extend the socket/process fixture in `packages/server/test/chat-proxy-service.test.ts` to call `ChatProxyService.prompt(...)` with a final files array.
- [ ] Assert the worker request receives the exact array, in order, without transforming its data URI, MIME, or name.
- [ ] Run `bun test test/chat-proxy-service.test.ts` from `packages/server` and confirm the array is currently missing.

### Step 2: Write worker unit tests before implementation

- [ ] Extend the fake page/locator only with behavior the real implementation uses: nearest-form scoping, `input#upload-files[type="file"]` count, `setInputFiles`, exact role-group acknowledgement, and Send click ordering.
- [ ] Add a success test with two text/source files. Decode the captured Playwright payload buffers in the assertion and verify exact names, MIME types, byte contents, and original order.
- [ ] Assert the worker called `setInputFiles`, observed both acknowledgement groups, checked Send availability, admitted the message, and only then clicked Send.
- [ ] Add a file-only test with local transcript text `Attached files: "notes.txt"` and `browserText: ""`; assert the textarea was filled with the empty string and the filename was never inserted into it.
- [ ] Add missing-input and ambiguous-input cases. Both must reject with a stable error, make zero Send clicks, and leave `reconcilePrompt(...)` as `null`.
- [ ] Add an acknowledgement-failure case with the same no-click/no-admission assertions.
- [ ] Extend the existing uncertain-Send case with a file to prove upload acknowledgement precedes admission, while a click timeout remains admitted for inspection.
- [ ] Run `bun test test/chat-proxy-worker.test.mjs` and confirm the new tests fail.

### Step 3: Carry files through the service boundary

- [ ] Append `files?: ChatProxy.PromptPayload["files"]` to `ChatProxyService.prompt(...)` in `packages/server/src/chat-proxy.ts`.
- [ ] Include `files` in the existing `relay("prompt", ...)` payload. Do not add storage, a new request method, or a new endpoint.
- [ ] Re-run the service transport test.

### Step 4: Decode and upload files in memory

- [ ] In `packages/server/src/chat-proxy-worker.mjs`, forward `request.files` through the request dispatcher, `prompt(...)`, and `beginPrompt(...)`.
- [ ] Update the direct-worker fallback identity to include the exact ordered file tuples so non-HTTP callers cannot reuse one message ID with changed files.
- [ ] Permit empty `text`/`browserText` only when `files.length > 0`; keep rejecting a completely empty prompt.
- [ ] Always call `composer.fill(browserText)`, including when it is `""`, to clear stale text for a file-only send.
- [ ] Decode each already-validated URI into Playwright's in-memory payload:

```js
{
  name: file.name || "attachment",
  mimeType: file.mime,
  buffer: Buffer.from(file.uri.slice(file.uri.indexOf(",") + 1), "base64"),
}
```

- [ ] Resolve the visible regular-chat composer, then its nearest `form`, then require exactly one `input#upload-files[type="file"]` in that form. Do not use a page-wide generic `input[type=file]` selector because ChatGPT can expose camera/photo inputs.
- [ ] Call `setInputFiles(payloads)` once for the whole ordered array.
- [ ] Wait inside the same form for a visible `role="group"` with exact accessible name equal to each submitted filename. If ChatGPT exposes an alert instead, surface its text through the existing worker error response; otherwise throw a stable filename-free upload acknowledgement error.
- [ ] Re-run the existing regular-chat guard after upload.
- [ ] Keep `admit()` immediately before Send click, after every acknowledgement and after the final Send-enabled check. Store only identity and transcript/browser text in `state.admitted`, never the files.

### Step 5: Prove the behavior in a real browser fixture

- [ ] Update `packages/server/test/chat-proxy-worker.browser.integration.mjs` so the composer is inside a `form` with a hidden multiple `#upload-files` input.
- [ ] On `change`, asynchronously read every `File`, record name/type/bytes, and render acknowledgement elements such as:

```html
<div role="group" aria-label="notes.txt"></div>
```

- [ ] Record `filesAtSend` and `textAtSend` in the Send handler.
- [ ] Add a text-plus-multiple-files test asserting exact byte order and proving all files were present before Send.
- [ ] Add a file-only test asserting the textarea remained empty and the actual file reached the input before Send.
- [ ] Run from `packages/server`:

```powershell
bun test test/chat-proxy-worker.test.mjs test/chat-proxy-service.test.ts
node --test test/chat-proxy-worker.browser.integration.mjs
```

### Step 6: Commit the worker boundary

- [ ] Review that no temporary files, file contents, or data URIs are persisted or logged.
- [ ] Commit only the service, worker, and focused tests:

```text
feat(server): upload ChatRelay files to ChatGPT
```

---

## Task 3: Make ChatRelay attachment drafts survive restart

**Files:**

- Modify: `packages/app/src/pages/canvas/runtime/contracts.ts`
- Modify: `packages/app/src/pages/canvas/runtime/provider.tsx`
- Modify: `packages/app/src/pages/canvas/workspace.tsx`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/runtime.test.ts`

### Step 1: Add a blob-aware restart test

- [ ] In `runtime.test.ts`, create one in-memory documents map and one in-memory blobs map, then instantiate an actual `createDraftStore(...)` around that driver. Reuse the maps across two store instances to model a full App restart.
- [ ] Persist a ChatRelay draft containing a `type: "image"` attachment for `notes.txt` with MIME `text/plain` and known UTF-8 bytes.
- [ ] Construct fresh runtime services and resolve the same workspace/block through the second store instance.
- [ ] Assert filename, MIME, stable blob ID, a newly rehydrated blob URL, and exact fetched bytes all survive.
- [ ] Inspect the `BlockLocalViewStore` value and assert it contains no attachment part, blob URL, data URI, or file bytes.
- [ ] Add a legacy migration test: seed only the current local-view `{ draft, revision }`, resolve with a `draftStore`, and assert the document is copied to durable storage while the same revision is returned.
- [ ] Add malformed/missing-blob coverage: discard an attachment whose durable blob cannot be rehydrated, but preserve text, skills, cursor, context, and revision.
- [ ] Run the focused runtime test from `packages/app` and confirm restart persistence fails with the current local-view-only implementation.

### Step 2: Thread the optional draft store into Canvas runtimes

- [ ] Import `DraftStore` as a type in `packages/app/src/pages/canvas/runtime/contracts.ts` and add:

```ts
draftStore?: DraftStore
```

to `BlockRuntimeServices` next to `localView`.

- [ ] Add an optional `draftStore?: DraftStore` prop to `BlockRuntimeProvider` and forward it into the service object.
- [ ] In `CanvasWorkspace`, call the existing `usePlatform()` context and pass `platform.draftStore` to `BlockRuntimeProvider`.
- [ ] Keep this optional; existing provider fixtures and all non-ChatRelay runtime adapters remain valid.

### Step 3: Read, migrate, and sanitize persisted ChatRelay drafts

- [ ] During `ChatRelayRuntimeAdapter.resolve`, await `services.draftStore?.getItem(storageKey)` before constructing the view so blob IDs are rehydrated into fresh URLs before the composer mounts.
- [ ] Parse the returned JSON defensively. Prefer the durable document; fall back to the legacy `localView` value only when the durable key is absent.
- [ ] When the fallback supplied a legacy value and a draft store exists, persist `{ draft, revision }` into the durable store before returning.
- [ ] Normalize every loaded draft. Retain only structurally valid attachment parts whose blob has both string `id` and rehydrated string `url`; drop a missing/corrupt attachment without discarding the rest of the draft.
- [ ] For both `set-draft` and acknowledged clearing, await:

```ts
services.draftStore?.setItem(resolved.storageKey, JSON.stringify({ draft, revision }))
```

- [ ] Continue writing a local-view coordination snapshot, but remove every `type: "image"` part before the write. Preserve the other draft fields and revision. When `draftStore` is absent, retain the existing local-view fallback behavior so test seams and constrained hosts remain usable.
- [ ] Do not revoke blob URLs here; the shared store owns rehydration and reuse.

### Step 4: Add runtime submission conversion tests

- [ ] Extend `ChatRelayCommand` with:

```ts
files?: Pick<PromptInputV2Attachment, "filename" | "mime" | "blob">[]
```

- [ ] Add a file-only command test. Assert the runtime converts the captured blob URL with `blobDataUrl(...)` and forwards:

```ts
files: [{ uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "notes.txt" }]
```

- [ ] Assert a conversion failure or rejected API request leaves `resolved.draft` and its revision unchanged.
- [ ] Assert an accepted request clears the current submitted revision in both durable and local-view state, while a newer revision and its newly added attachment survive the older acknowledgement.
- [ ] Implement conversion with `Promise.all(...)` immediately before the API call in `runtime.ts`. Omit the API field when no files were captured.
- [ ] Re-run `runtime.test.ts` from `packages/app`.

### Step 5: Commit restart-safe runtime persistence

- [ ] Run a targeted provider/runtime typecheck or focused provider test if the prop plumbing needs runtime coverage.
- [ ] Stage only the runtime, workspace, and runtime-test files; do not stage the user's unrelated changes.
- [ ] Commit:

```text
feat(app): persist ChatRelay attachment drafts
```

---

## Task 4: Enable named file drop in the ChatRelay composer

**Files:**

- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/composer.tsx`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/view.browser.test.tsx`

### Step 1: Expose attachment behavior in the browser test harness

- [ ] Keep the existing `PromptInputV2` test double, but expose/render enough of the real controller contract to inspect `controller.attachments()` and dispatch a form-level drop through the controller's real handlers.
- [ ] Supply a blob-aware platform test double whose `draftStore.putBlob(file)` returns a stable blob ID and object URL.
- [ ] Drop a `File(["hello"], "notes.txt", { type: "text/plain" })` into ChatRelay. Assert the attachment list contains exactly one part with the original filename and normalized MIME.
- [ ] Assert the rendered attachment card/accessible label shows `notes.txt` rather than inserting `hello` into the text editor.
- [ ] Submit with no text and assert the emitted `prompt` command captures `{ filename, mime, blob }`.
- [ ] Add a mixed drop carrying both a valid CtxPack drag payload and a `File`. Assert only the CtxPack is admitted, proving `view.onDrop` consumed the event before built-in file handling.
- [ ] Add unsupported/binary and duplicate cases and assert the existing localized warning callbacks fire.
- [ ] Add failure/retry coverage: when `onPrompt` rejects or returns `false`, the attachment remains and a retry reuses the same message ID; an acknowledged current revision clears it through the existing runtime-view update.
- [ ] Run the focused browser test from `packages/app` and confirm it fails because ChatRelay has no attachment controller configuration.

### Step 2: Reuse the shared attachment adapter

- [ ] Import `usePlatform`, `PromptInputV2Attachment`, and the existing toast/error utilities in `composer.tsx`.
- [ ] Obtain `const platform = usePlatform()` and add the same controller config used by `packages/app/src/components/prompt-input-v2.tsx`:

```ts
attachments: {
  picker: platform.openAttachmentPickerDialog,
  directory: () => "",
  isDialogActive: () => !!dialog.active,
  warn: () =>
    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    }),
  duplicate: () => showToast({ title: language.t("prompt.toast.attachmentDuplicate.title") }),
  onError: (error) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    }),
  readClipboardImage: platform.readClipboardImage,
  getPathForFile: platform.getPathForFile,
  store: platform.draftStore?.putBlob,
},
```

- [ ] Leave the existing CtxPack `view.onDrop` unchanged: it returns `true` only for a parsed CtxPack payload, allowing ordinary files to fall through to the new shared attachment handler.
- [ ] Use `controller.attachments()` in `ready()` through the existing `controller.canSubmit()` behavior. Do not add a second attachment signal or card component.

### Step 3: Capture the exact submitted file set

- [ ] At the start of `submit()`, capture `const files = controller.attachments()` alongside the existing CtxPack snapshot and draft revision.
- [ ] Add only transport fields to the command:

```ts
...(files.length
  ? { files: files.map((file) => ({ filename: file.filename, mime: file.mime, blob: file.blob })) }
  : {}),
```

- [ ] Do not convert to a data URI in the component. Runtime conversion keeps errors inside the existing dispatch/busy/error path and prevents a second submit while conversion is pending.
- [ ] Keep `submissionIdentity = JSON.stringify(draft.prompt)`: attachment add/remove changes the revision and resets the message ID because the attachment part includes its stable blob ID.
- [ ] Keep the existing accepted-response behavior for CtxPack. Prompt attachments clear only when the runtime publishes the acknowledged empty draft; a concurrent newer revision remains untouched.
- [ ] Re-run `view.browser.test.tsx` and the existing general drag tests from `packages/app` to prove shared composer behavior did not regress.

### Step 4: Commit the composer wiring

- [ ] Review the UI diff to confirm Scratchpad/Notes and `chat-relay/view.tsx` were not changed.
- [ ] Commit only the composer and its focused test:

```text
feat(app): accept files in ChatRelay composer
```

---

## Task 5: Regenerate clients and verify the complete path

**Generated files (do not edit manually):**

- `packages/client/src/generated/types.ts`
- `packages/client/src/generated/client.ts`
- `packages/client/src/generated-effect/client.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`
- Any additional generator-owned JavaScript SDK files changed by the canonical build script

### Step 1: Generate both client surfaces

- [ ] From `packages/client`, run:

```powershell
bun run generate
```

- [ ] From the repository-supported legacy SDK location, run the mandated generator:

```powershell
bun ./packages/sdk/js/script/build.ts
```

- [ ] Inspect generated diffs. `ChatProxyPromptPayload` must expose optional `files` using the existing prompt-file attachment type; no unrelated endpoint or schema churn is acceptable.

### Step 2: Run focused tests in dependency order

- [ ] From `packages/protocol`, run the focused ChatProxy protocol test.
- [ ] From `packages/server`, run:

```powershell
bun test test/chat-proxy-handler.test.ts test/chat-proxy-service.test.ts test/chat-proxy-worker.test.mjs
node --test test/chat-proxy-worker.browser.integration.mjs
```

- [ ] From `packages/app`, run:

```powershell
bun test --conditions=browser --isolate --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
bun test --conditions=solid --isolate --preload ./happydom.ts src/pages/canvas/blocks/chat-relay/runtime.test.ts
bun test --conditions=browser --preload ./happydom.ts --preload ./test-browser/ctxpack-solid.ts ./test-browser/prompt-input-drag.test.ts
```

- [ ] Run any narrower command required by the package's current test preload if a listed command is rejected; record the exact successful equivalent.

### Step 3: Run package-local typechecks and builds

- [ ] Run `bun typecheck` from each changed package: `packages/schema`, `packages/protocol`, `packages/server`, `packages/client`, `packages/sdk/js`, and `packages/app`.
- [ ] Run `bun run build` from `packages/app` to catch browser bundle and lazy-import problems.
- [ ] Run `bun run check:generated` from `packages/client` and confirm it produces no diff.

### Step 4: Inspect security, persistence, and scope invariants

- [ ] Search changed production code for `data:` logging, transcript insertion, temporary file writes, path dereferencing, and direct generated-file edits. Expected result: none.
- [ ] Confirm the worker's upload acknowledgement happens before `admit()` and Send in both source order and tests.
- [ ] Confirm local-view snapshots contain no `type: "image"` attachment when a durable draft store is available.
- [ ] Confirm file-only, text-plus-file, retry after pre-admission failure, concurrent draft edit, CtxPack-first drop, and full-restart rehydration are all covered by passing tests.
- [ ] Review `git diff --check` and `git status --short`; exclude every pre-existing unrelated CtxPack/Core file from commits.

### Step 5: Request review and finish

- [ ] Use `superpowers:requesting-code-review` on the complete diff and address only verified findings through `superpowers:receiving-code-review`.
- [ ] Re-run the focused verification affected by any review fix.
- [ ] Commit generated output and any final integration-only adjustments with:

```text
chore(sdk): regenerate ChatRelay file types
```

- [ ] Use `superpowers:verification-before-completion` before reporting success. Include exact passing test/typecheck/build evidence and call out any unrelated pre-existing dirty files left untouched.
