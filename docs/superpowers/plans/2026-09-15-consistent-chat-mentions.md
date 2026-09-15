# Consistent Chat Mentions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Implementation was authorized on 2026-09-15. Verification and review results are summarized below.

**Goal:** Give every chat message composer the same `@` interaction, including explicit skill selection, and make ChatRelay and future chat blocks reuse it.

**Architecture:** Reuse the transport-independent `PromptInputV2` editor, interaction controller, and draft store in `packages/session-ui`. Share app-side candidate construction and add small transport adapters: native sessions request the existing permission-checked skill tool; ChatRelay sends server-resolved skill instructions through its existing browser transport.

**Tech Stack:** SolidJS, TypeScript, Effect, Bun, existing Schema/Protocol/Client packages, existing browser relay worker.

**Spec:** The audited findings and proposed behavior below implement the user request of 2026-09-15. The user explicitly confirmed that ChatRelay must include skill instructions in the message sent to ChatGPT.

## Global constraints

- Prioritise stability, simplicity, performance, in that order.
- Reuse `SkillV2` discovery, plugin contributions, name identity, and permission evaluation. Do not build another skill registry.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- After changing public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit generated files directly. Regenerate the legacy JavaScript SDK with `./packages/sdk/js/script/build.ts` when its public contract changes.
- Run tests and `bun typecheck` from affected package directories. Never run tests from the repository root or invoke `tsc` directly.
- Record a production benchmark baseline before changes to session or timeline code, and compare after the change. Never restart the app or server process.
- Use i18n keys for every new visible label, empty state, description, and error.
- Preserve SessionV2 durable admission, exact retries, steer/queue behavior, and provider execution ownership.
- Preserve ChatRelay ownership by authenticated user, workspace, block, and tab incarnation; no SessionV2 or Codex/API fallback.
- Existing unrelated working-tree changes, including CtxPack changes, are outside this plan.

## 1. Audit: what exists already

Paths in this document are relative to the repository root, `D:/OpencodeDev`.

| Surface | Current implementation | Finding |
| --- | --- | --- |
| New-session composer | `packages/app/src/pages/new-session/new-session-view.tsx` | Uses `PromptInputV2Composer`. |
| Full session composer | `packages/app/src/pages/session-surface-base.tsx` | Uses the same V2 composer. |
| Operating Chat and MasterAgent | `packages/app/src/pages/canvas/block-chat-composer.tsx` through `CanvasSessionSurface` | Already share the V2 composer. |
| Active ChatRelay | `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx` | Separate textarea and string draft; no `@` picker. Sends through `v2.chatProxy.prompt`. |
| Legacy composer | `packages/app/src/components/prompt-input.tsx` | Separate picker implementation; inspected production surfaces above use V2. Avoid extending the legacy implementation speculatively. |

**Execution correction:** The current Canvas shell replaces the routed new/full-session
views. Their retained V2 implementations share the updated adapter, but cannot be
exercised as separate routes in this shell. Before the 2026-09-14 sunset, the old
shell selects the legacy composer instead. Browser acceptance therefore covers
the active Operating Chat, MasterAgent, and ChatRelay blocks; it does not claim
browser coverage of the retired routes or change their routing.

Existing reusable pieces:

- `packages/session-ui/src/v2/components/prompt-input/{types,store,machine,interaction}.ts` and `index.tsx` own suggestions, token insertion, editor rendering, and keyboard behavior.
- `packages/app/src/components/prompt-input-v2.tsx` builds reference, agent, MCP resource, and file suggestions. Skills are absent.
- The shared suggestion union includes `agent`, `command`, `file`, `reference`, and `resource`; structured mentions support file and agent parts only.
- `packages/core/src/skill.ts` owns discovered skills and `available(...)`; `packages/core/src/tool/skill.ts` loads a skill and asserts permission.
- `GET /api/skill` exists in `packages/protocol/src/groups/skill.ts`, backed by `packages/server/src/handlers/skill.ts`. It returns full `Skill.Info` including content and location, and the handler does not apply selected-agent filtering. It is not a ready-made filtered composer catalog.
- `SessionV2.skill` in `packages/core/src/session.ts` returns `OperationUnavailableError`. Do not wire the picker to it.
- ChatRelay already resolves CtxPack references on the server and separates displayed text from submitted content. Reuse that transport boundary, but do not label a skill as a CtxPack: the current capsule schema explicitly requires a CtxPack source.
- No matching end-to-end skill mention plan was found in `specs`, `docs/superpowers`, or `devplan`. `specs/workspace-canvas/block-plugin-skill-tool-composition-plan.md` concerns contribution lifecycle, not composer behavior.

The active relay architecture is `specs/relay/architecture.md`. The older session migration document is historical and must not guide this change.

## 2. Proposed behavior

### Shared interaction

1. Typing `@` at the start of text or after whitespace opens the same picker at the caret. Typing a query filters it. Embedded email addresses do not open it.
2. Keep the existing arrow-key navigation, Enter/Tab selection, Escape dismissal, and IME behavior. Selecting an item never submits the message.
3. A skill appears with its name, description, and a distinct skill category. Use a typed `skill:<name>` candidate identity so a same-named agent or file remains a separate result.
4. Selection inserts an atomic `@skill-name` token plus a trailing space, preserving surrounding text and source offsets. Removing the token removes its associated skill selection.
5. Skill identity survives draft persistence and history restoration. Clipboard paste remains ordinary text; do not silently interpret every `@name` as a skill.
6. Deduplicate selected skills by canonical name during submission, preserving first-selection order. A skill-only message is valid.
7. Loading, no results, stale skill, and unavailable transport states are visible and localized. Candidate requests are scoped to server, resolved Location, selected agent/policy, and composer identity; late responses cannot populate another block.

### Transport semantics

**Native sessions:** Selecting a skill explicitly asks the model to load it through the existing `skill` tool. Lower the structured selection into a deterministic user instruction alongside the typed prompt. The tool remains responsible for loading its instructions and requesting permission. Selection itself does not execute the skill or guarantee that the model follows the request. Do not attach `SKILL.md` through the unrestricted file path to bypass skill permissions.

**ChatRelay:** Include the selected skill's instruction body in the outgoing ChatGPT message, as confirmed by the user. Send only canonical references from the client; the authenticated server resolves content. Keep the typed message and skill labels in the mirrored transcript, with a preview of the instructions being included. Preserve local paths inside the authored skill instructions, but do not scan or upload sibling files. Explain in the preview that local tools and files referenced by the skill are not supplied by this relay.

**Supported categories:** Native composers retain their current file, reference, resource, and agent behavior and gain skills. ChatRelay gains skills in this increment and retains CtxPack attachments. It must not offer selectable file/resource/agent mentions until it has a real transport implementation for them. Consistency means the same interaction and honest capability presentation; unsupported items must never silently become inert labels.

**Scope:** New-session, full-session, Operating Chat, MasterAgent, and ChatRelay message composers. Scratchpad text, question-answer fields, and inline review comments are separate editors and are not chat submission surfaces.

### Options considered

- **Recommended: shared V2 editor with small adapters.** Uses existing ownership boundaries and lets future blocks inherit behavior.
- Add a custom picker to ChatRelay. Smaller first patch, but duplicates interaction, token editing, and regression fixes.
- Move ChatRelay back onto `CanvasSessionSurface`. Would change its execution and authentication model and contradict the active relay architecture.

## 3. Implementation tasks

### Task 1: Add skill tokens to the shared editor

**Modify:**

- `packages/session-ui/src/v2/components/prompt-input/types.ts`
- `packages/session-ui/src/v2/components/prompt-input/store.ts`
- `packages/session-ui/src/v2/components/prompt-input/machine.ts`
- `packages/session-ui/src/v2/components/prompt-input/interaction.ts`
- `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- `packages/app/src/context/prompt-state.ts` and its re-exports in `prompt.tsx`
- Relevant history normalization in `packages/app/src/components/prompt-input/history.ts`

**Interface:** Extend the existing mention union with this client draft part; it contains identity, never the skill body:

```ts
export type PromptInputV2SkillPart = PromptInputV2PartBase & {
  type: "skill"
  name: string
  contentHash?: string
}
```

The optional hash supports restoration of old drafts; ChatRelay requires a fresh catalog hash before first submission. Add `skill` to the suggestion kind union and to every mention operation rather than branching in each block.

- [x] Add failing store tests for insertion in the middle of text, skill/file name collision, and removal without losing the suffix.
- [x] Extend token render/parse, offsets, equality, draft validation, and history normalization to round-trip the skill part.
- [x] Cover mention-only validity and keyboard behavior in `machine.test.ts` and existing browser test coverage. Review text-only assumptions in `populated(...)` and submission enablement.
- [x] Keep add-menu behavior and IME input consistent with typing `@` directly.
- [x] Run focused package tests and typecheck.

Example store assertion, using the existing test fixture convention:

```ts
store.setText("Before @rev after")
store.setCursor(11)
store.addMention({ type: "skill", name: "review", content: "@review", start: 0, end: 0 })
expect(store.state.prompt.some((part) => part.type === "skill" && part.name === "review")).toBe(true)
expect(store.state.prompt.map((part) => part.content).join("")).toBe("Before @review  after")
```

### Task 2: Share candidate construction and expose safe skill metadata

**Create:** `packages/app/src/components/prompt-input/mention-candidates.ts` and `mention-candidates.test.ts`.

**Modify:** `packages/app/src/components/prompt-input-v2.tsx`, `packages/schema/src/skill.ts`, `packages/protocol/src/groups/skill.ts`, `packages/server/src/handlers/skill.ts`, and the app's typed API facade where needed.

**Interface:** Add a metadata projection `Skill.Candidate` containing `name`, optional `description`, and `contentHash`. Add a separate `skill.candidates` endpoint without changing the existing `skill.list` response. Its native-session context uses the effective selected agent; new-session context uses the selected agent in the resolved Location. It exposes no content or absolute path.

- [x] Add handler tests proving denied skills are omitted, ask-policy skills can be discovered for native tool execution, and unknown agents do not fall back to a more permissive agent.
- [x] Reuse `SkillV2.Service.list` and permission evaluation server-side. Include plugin-contributed and embedded skills, not just filesystem `SKILL.md` files.
- [x] Move the existing app candidate mapping into the shared module and add skill mapping. Keep file search supplied by each composer context; do not introduce a provider registry or dependency.
- [x] Fetch when opening the picker, deduplicate in-flight reads within the same scope, and discard results when identity changes. Refresh on the next opening so plugin/catalog changes do not require reloading the app.
- [x] Test same-name items across categories, catalog changes, empty results, and rapid switching between blocks or servers.
- [x] Generate clients and run affected tests/typechecks.

### Task 3: Make native skill selection reach the existing tool workflow

**Modify:** `packages/app/src/components/prompt-input/build-request-parts.ts`, `build-request-parts.test.ts`, and `submit.ts` only where required to preserve structured selections through submission.

**Contract:** Serialize selected skill names once, in selection order, into a deterministic user instruction. Keep source offsets relative to the original typed text by appending the instruction after it. Use JSON string encoding for the names so punctuation cannot corrupt the envelope.

```text
Selected skills: ["review", "superpowers:brainstorming"]
Use the skill tool to load these selected skills before responding. If a skill is unavailable or permission is denied, explain that instead of claiming it was loaded.
```

- [x] Write serializer tests for one skill, repeated selection, skill-only messages, names containing punctuation, and mixed file/agent/skill parts.
- [x] Verify the instruction reaches the actual V2 request through `packages/app/src/utils/server.ts`; cover the legacy API adapter in `server-compat.ts` if it is used by an inspected caller.
- [x] Keep optimistic user text and submitted selected-skill intent reconcilable after refresh. The deliberate minimal representation is visible text in the native transcript, not a new durable skill part.
- [x] Ensure failed sends retain the draft and selected skills; exact retry uses the same serialized request. Preserve steer and queue modes.
- [x] Reject structured skills combined with custom slash commands before side effects, preserving the draft and showing a localized explanation. Command templates may interpolate arguments into shell snippets, so their arguments must not receive a skill-instruction suffix.
- [x] Run `packages/core/test/tool-skill.test.ts` to verify the reused load/deny path remains intact, plus app serializer/submission tests.

### Task 4: Include validated skill instructions in ChatRelay

**Modify:**

- `packages/schema/src/chat-proxy.ts`
- `packages/protocol/src/groups/chat-proxy.ts`
- `packages/server/src/handlers/chat-proxy.ts`
- `packages/server/src/chat-proxy.ts` and the existing worker request/retry handling where necessary
- `packages/server/test/chat-proxy-handler.test.ts`, `chat-proxy-service.test.ts`, and `chat-proxy-worker.test.mjs`

**Create:** `packages/core/src/skill/selection.ts` for the reused catalog-to-selection resolution boundary, with `packages/core/test/skill/selection.test.ts`.

**Wire contract:** Extend `ChatProxy.PromptPayload` with optional `skills: { name: string; contentHash: string }[]`. Add `chatProxy.skills` alongside the other block-scoped endpoints, returning metadata candidates only. It derives the Location from the authorized workspace primary directory; the client cannot supply an unrelated directory.

**Policy proposal:** ChatRelay has no Session agent or permission-request lifecycle. Evaluate skills against the resolved Location's configured default agent and allow only `allow` results for direct inclusion. `ask` and `deny` are unavailable for this transport. Resolve that policy server-side on both discovery and submission; an absent default agent fails closed. This does not execute or select that agent. Native composers continue their normal selected-agent permission behavior.

- [x] Test membership and block-functionality validation before reading skills, including attempts to use another workspace's references.
- [x] Resolve names through the existing registry, verify the selected hash, and reject removed, changed, or disallowed selections before any browser Send action. Do not trust a client path or body.
- [x] Deduplicate by name and enforce the existing interactive context budget across skill instructions and CtxPack content together. Reject an oversized selection with an actionable error; do not silently truncate instructions.
- [x] Render skill instructions as explicit user-supplied context with skill labels. Preserve the existing distinction between `displayText` and outgoing `apiContent`; compose with CtxPack content instead of replacing it.
- [x] Extend retry identity to include the original text, skill names/hashes, and CtxPack references. Once accepted, retain the resolved bytes in the existing worker-owned prompt record. An exact retry returns that record before re-resolving a changed catalog and never clicks Send again. Conflicting reuse fails.
- [x] Preserve uncertain-send behavior: inspection, not automatic retry. A failed pre-admission resolution leaves the draft intact. Re-selecting a changed skill creates a new message ID.
- [x] Test mixed CtxPack/skill sends, skill-only sends, catalog replacement, exact retry after replacement, conflicting ID reuse, stale tab IDs, and combined budget overflow.
- [x] Generate both client surfaces as required, run focused server/Core tests and package typechecks.

### Task 5: Put ChatRelay on the shared editor and prevent future drift

**Create:** `packages/app/src/pages/canvas/blocks/chat-relay/composer.tsx` as the thin relay adapter and `packages/app/e2e/chat-mentions.spec.ts` for real composer interaction coverage.

**Modify:**

- `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`
- `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts`
- Existing relay view/runtime tests
- `packages/app/src/i18n/en.ts` and the relevant shared UI i18n catalog
- `specs/relay/architecture.md`
- `specs/workspace-canvas/requirements.md`

**Interface:** The relay adapter creates a `PromptInputV2PersistedState` store and uses `createPromptInputV2Controller` plus `PromptInputV2` directly. It supplies the shared candidate mapping, relay submit callback, and existing CtxPack preview/remove callbacks. It does not mount the native app controller, which owns Session submission and native provider controls.

- [x] Mount the adapter with `chatOnly: true`, no native slash commands or agent selection, and only supported mention candidates. Keep relay model/effort discovery controls and their manual refresh behavior.
- [x] Migrate persisted `{ draft: string }` into a text part. Persist structured identity for new drafts while maintaining workspace/block ownership; invalidate skill readiness and in-flight results on tab/server changes.
- [x] Clear only the acknowledged draft revision and attachments after success. Text or selections edited while a request is in flight must survive its acknowledgement.
- [x] Preserve focused-input CtxPack targeting, drag/drop, preview/remove, send-disabled states, reset behavior, and attachment-only sends.
- [x] Add shared browser interactions for active Operating Chat, MasterAgent, and ChatRelay: `@`, query, keyboard selection, no accidental send, removal, and draft isolation. Validate submitted requests, not merely token appearance. Retained new/full-session views use the same adapter; see the route-coverage correction above.
- [x] Include two simultaneous blocks, switching focus while lookup is pending, caret insertion in the middle of a sentence, email text, and IME Enter in that coverage.
- [x] Document the new-block rule: a chat message block must use the shared editor/controller and declare supported candidate categories through its adapter. Every new composer is added to the browser test surface matrix before release; unsupported raw-text submission is not treated as skill support.
- [x] Run focused interaction and existing relay regression tests, build production, and record the baseline limitation below.

## 4. Verification and completion

Use the package scripts and test preloads already declared in each package. Representative focused commands:

```powershell
# From packages/session-ui
bun test src/v2/components/prompt-input/store.test.ts src/v2/components/prompt-input/machine.test.ts
bun typecheck

# From packages/app
bun test --conditions=solid --isolate --preload ./happydom.ts ./src/components/prompt-input/build-request-parts.test.ts
bun test --conditions=browser --isolate --preload ./happydom.ts ./src/pages/canvas/blocks/chat-relay/view.browser.test.tsx
bun run test:e2e -- chat-mentions.spec.ts
bun typecheck

# From packages/core
bun test test/tool-skill.test.ts test/skill/selection.test.ts
bun typecheck

# From packages/server
bun test test/chat-proxy-handler.test.ts test/chat-proxy-service.test.ts
bun typecheck

# From packages/client, after public API changes
bun run generate
bun typecheck
```

Also run affected schema/protocol checks, worker tests through their existing runner, the draft/history tests changed in Task 1, and the full focused submission regressions. Run against existing dev processes; do not restart them for verification.

Done means every active production composer passes the shared interaction matrix, native requests retain explicit skill intent, ChatRelay sends validated instruction content exactly once within the existing worker lifetime, existing mentions/CtxPacks still work, and future block authoring guidance points to the shared implementation. Report separately any browser verification that could not run; unit tests alone do not prove live ChatGPT compatibility.

## 5. Boundaries of this plan

- No new skill discovery lifecycle, generic provider plugin framework, or Session execution loop.
- No new durable native skill-message schema: native intent uses the existing text/tool path.
- No implementation of the placeholder `SessionV2.skill` method.
- No automatic execution or upload of skill supporting scripts/files through ChatRelay.
- No new file, MCP resource, or agent execution transport for ChatRelay in this increment.
- No changes to unrelated text editors or removal of the legacy composer without an actual production caller requiring it.

## Execution result — 2026-09-15

All five implementation tasks are complete. Backend and frontend review findings were fixed and re-reviewed with no remaining findings.

- 17 browser scenarios passed against the production build, covering the active composer matrix, independent drafts, caret insertion, email text, IME Enter, native/relay requests, relay controls/reset, and CtxPack attachment/preview/removal/exact retry.
- Focused unit and component tests, affected package typechecks, generated clients, and the production build passed during implementation.
- The pre-edit production benchmark failed before collecting timing data because its routed session heading never appeared in the current Canvas shell. No before/after performance claim is made.
- No live ChatGPT message was sent. Browser acceptance uses deterministic mocked service responses; backend worker tests exercise admission/retry and resolved instruction bytes.
- Retired new/full-session routes were not separately browser-tested; see the audit correction above. Their V2 code shares the updated composer adapter.
