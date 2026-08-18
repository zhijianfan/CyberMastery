# ChatRelay Block — File-Only Design

Status: proposed
Companion: [ImplementationPlan_ContractFirstParallel_v2.md](../devplan/relay/ImplementationPlan_ContractFirstParallel_v2.md), [workspace-canvas/functionality-subsystem-management-architecture.md](../workspace-canvas/functionality-subsystem-management-architecture.md), [oauth.md](./oauth.md) (upstream capture: account auth + API)

## 1. Objective

Relay ideas into design documents through third-party AI chat providers and turn
the captured output into stored product documents, architecture documents, and
a highly parallelized implementation plan.

## 2. Hard constraint — file-only block

This block is a **passive file-ingestion organizer**. Its entire capability
surface is:

| Capability | Allowed | Notes |
|---|---|---|
| Read files | Yes | Existing specs, transcripts, ADRs, implementation plans |
| Write text files | Yes | Markdown documents only — never binary, never code in the repo |
| Organize files | Yes | Create/move/rename directories and files under `specs/` |
| Execute | **No** | No shell, no subprocess, no code execution, no git commit/push, no browser automation, no network requests |

Consequences:

- **Provider interaction happens upstream, outside the block.** The block never
  drives a chat webpage or calls a provider API. Capture is done by an
  execute-capable component (the account-authenticated provider adapter, or a
  manual export) whose only handoff artifact is a
  **transcript file**. The capture portion — account authorization, the API
  exchange, and session threading — is specified in [oauth.md](./oauth.md).
- **The block's inputs are files, not live sessions.** It consumes transcripts
  dropped into an inbox directory.
- **Git stays outside.** The block organizes the working tree; committing and
  pushing remain explicit, separate, execute-capable steps.

## 3. Flow

```
Capture (upstream, execute-capable — NOT this block)
    provider chat / API / manual export
        │
        ▼
    transcript file(s) → specs/relay/inbox/

ChatRelay Block (file-only)
    inbox watch
        │
        ▼
    artifact extraction (structural split + doc-type classify)
        │
        ▼
    write text docs → specs/<domain>/
        requirements.md · architecture.md · ImplementationPlan*.md (now output to devplan/ subfolders)
        + provenance frontmatter + raw transcript retained
        │
        ▼
    organize: move transcripts to archive/, update index

Downstream (separate execute-capable passes, out of block scope)
    coherence pass (Alignment*) → plan executor (subagent fan-out)
```

## 4. Inbox contract

- `specs/relay/inbox/` — any text file arriving here is a candidate transcript.
- One turn per file is acceptable; multi-file conversations are grouped by a
  conversation id in the frontmatter or filename (`<conversationId>-<turn>.md`).
- The block never reads from or writes to directories outside `specs/`.

## 5. Artifact extraction

- Split on turn boundaries and `## ` headers matching known doc kinds
  (`requirements | architecture | implementation plan`).
- Classify each chunk as `product-doc | architecture | plan | notes`; unknown
  chunks are preserved under `notes/`, never dropped.
- Write each doc with provenance frontmatter:

```yaml
---
source: chatgpt | claude | api | manual
conversationId: <id>
capturedAt: <iso>
adapter: <name>
rawTranscript: specs/relay/archive/<file>
---
```

## 6. Capability profile (functionality manifest)

If the block is registered as a workspace functionality, its manifest is:

```ts
rights: {
  mount: ["read"],
  operations: {
    "relay.ingest":     ["read"],           // read inbox transcripts
    "relay.extract":    ["read"],           // classify + split (pure)
    "relay.write-doc":  ["write"],          // markdown docs only
    "relay.organize":   ["write"],          // archive + index under specs/
  },
}
```

`execute` appears nowhere in the manifest, so the platform's default-deny
rule for execution keeps the block fully inert even if a transcript contains
embedded instructions, code fences, or malicious content.

## 7. Safety properties

- Untrusted transcript content is treated as data: code fences and instructions
  inside transcripts are written into documents verbatim, never interpreted.
- The block rejects non-text writes (extension allowlist: `.md`, `.txt`,
  `.json` for index/ledger; everything else fails closed).
- No symlink-following, no absolute paths outside `specs/`.
- The ingest ledger (`specs/relay/index.jsonl`) records message hash →
  conversation → produced files → plan hash, making re-ingestion idempotent.

## 8. Explicitly out of scope for the block

- Webpage chat crawling, account authorization, and provider API calls
  (execute).
- Running or even scheduling the coherence pass or implementation subagents
  (execute).
- Committing, pushing, or tagging the repo (execute).
- Editing any existing source code file.
