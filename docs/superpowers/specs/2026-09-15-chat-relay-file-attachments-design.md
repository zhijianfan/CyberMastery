# ChatRelay File Attachments Design

Status: approved on 2026-09-15

## Summary

Every AI message composer will accept text files dropped from the client machine as named attachments. The existing session, new-session, OperatingChat, and MasterAgent composers already do this through the shared V2 prompt input. This change closes the remaining ChatRelay gap. Scratchpad/Notes is explicitly out of scope.

ChatRelay will reuse the shared attachment cards and durable draft blob store, carry files through the existing ChatProxy prompt request, and upload them through the real file input in the controlled ChatGPT tab before sending. Files are never flattened into prompt text.

## Goals

- Accept local text and source files in every AI message composer.
- Show dropped ChatRelay files with their original filenames in the standard attachment UI.
- Preserve unsent ChatRelay attachment bytes across a full app restart.
- Upload ChatRelay files as real ChatGPT attachments.
- Support prompts containing text and files or files alone.
- Preserve ChatRelay CtxPack drop behavior, retry identity, and concurrent draft-edit safety.

## Non-goals

- Add attachments to Scratchpad/Notes.
- Add a separate upload service or temporary-file lifecycle.
- Embed file contents into the visible or model-facing prompt text.
- Mirror ChatGPT's changing file-size and file-type limits in OpenCode.
- Change existing attachment behavior in session, new-session, OperatingChat, or MasterAgent composers.

## Architecture

### Shared composer behavior

ChatRelay's `PromptInputV2` controller will receive the same attachment configuration used by the other App composers: picker integration, drag-and-drop handling, duplicate detection, MIME normalization, error toasts, and blob storage. Its existing `view.onDrop` remains first in the drop chain. A valid CtxPack payload returns `true` and is consumed as context; every other file drop falls through to the shared file-attachment handler.

The shared prompt input already renders non-image files as named attachment cards and treats attachments as submit-capable content. No parallel ChatRelay-specific attachment component will be introduced.

### Durable drafts

ChatRelay's full `PromptInputV2PersistedState` will be stored through the App's existing blob-aware draft persistence. File bytes remain in the draft blob store, while serialized prompt parts retain stable blob IDs. Reloading the draft rehydrates fresh blob URLs before the composer becomes interactive.

The Canvas local-view draft remains a lightweight coordination and migration snapshot. It must not become the byte store and must not persist base64 file data in `localStorage`. The existing draft revision guard continues to prevent an acknowledged request from clearing edits made after submission began.

### ChatProxy request

`ChatProxy.PromptPayload` gains an optional `files` array using the existing public prompt file shape:

```ts
{
  uri: string
  mime: string
  name?: string
}
```

The App converts each submitted blob reference to a data URI only at submission time. The ChatRelay command and runtime forward that exact file set with the message ID, text, skills, and context attachments.

Files participate in the request identity hash, including their URI, MIME type, and filename. Reusing a message ID with different file bytes or metadata is therefore a conflict. A successful response clears only the attachment objects captured for that submission; a newer draft revision remains intact.

### Server and browser worker

The ChatProxy handler accepts only data-URI file payloads for browser upload. It never dereferences arbitrary client paths or remote URLs. It adds submitted filenames to the local transcript display text, while keeping file bytes out of transcript messages, logs, context envelopes, and errors.

The service forwards the files to the Chat Proxy worker over its existing request channel. The worker decodes each data URI into a Playwright file payload, assigns all files to the file input associated with the visible regular-ChatGPT composer, and waits for ChatGPT to show the submitted filenames. Only after every attachment is acknowledged does it verify the Send action, admit the message ID, and click Send.

The worker permits an empty text value when at least one file is present. Text is still filled exactly when provided. A file-only prompt uses the filenames as its local transcript display text without injecting that label into ChatGPT's text composer.

## Failure behavior

- Unsupported or binary local files use the existing attachment warning and are not added.
- Duplicate files use the existing duplicate warning.
- A non-data URI reaching the ChatProxy API is rejected before browser interaction.
- A missing or ambiguous ChatGPT file input, an upload timeout, or a rejected upload fails the prompt before Send is clicked.
- Any failed conversion, transport, or browser upload leaves the ChatRelay draft and attachments available for retry.
- ChatGPT remains authoritative for provider upload limits; its rejection is surfaced through the existing ChatRelay error area.
- A successful admission clears the submitted attachments and context attachments. Concurrently added or edited draft content is preserved by the existing revision comparison.

## Security and privacy

- File bytes remain device-local until the user submits the ChatRelay prompt.
- The authenticated ChatProxy endpoint remains workspace- and block-scoped.
- The server accepts browser-upload files only as explicit data URIs and does not read client-supplied paths.
- Request identity hashes may cover file bytes, but raw data URIs and file contents are not logged or included in transcript projections.
- The browser worker uploads only into a verified regular ChatGPT Chat tab, preserving the existing Work-mode, login, and challenge guards.

## Testing

1. A ChatRelay browser test drops a local text file and observes the named standard attachment card.
2. The same path proves a CtxPack drop is consumed before built-in file handling.
3. Draft persistence tests reload a ChatRelay draft and verify filename, MIME type, blob identity, and bytes.
4. Runtime tests verify files are forwarded unchanged and included in submission/revision behavior.
5. handler tests verify data-URI enforcement, filename-only transcript display, file-aware idempotency, and file-only prompts.
6. The real Playwright browser fixture verifies file name and bytes reach ChatGPT's file input before Send, including file-only submission.
7. Failure tests verify no Send click and retained App attachments when upload acknowledgement fails.
8. The generated Promise and Effect clients, affected package tests, and package-local typechecks must pass.

## Generation

Changing `ChatProxy.PromptPayload` changes the public Protocol/Server HTTP API. After the schema and protocol compile, run `bun run generate` from `packages/client`. Do not edit `packages/client/src/generated` or `packages/client/src/generated-effect` directly.

## Alternatives rejected

### Temporary server files

Rejected because it adds cleanup, collision, crash-recovery, and host-path concerns without improving the text-file workflow.

### Separate multipart upload endpoint

Rejected because it adds an upload lifecycle and server-side state for a request that the existing prompt transport can carry. It can be reconsidered if measured attachment sizes make in-band data URIs a practical bottleneck.

### Embed file contents into prompt text

Rejected because the user requires a real named ChatGPT attachment, and flattening content changes provider semantics and transcript presentation.
