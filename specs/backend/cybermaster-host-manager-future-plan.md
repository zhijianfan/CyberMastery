# CyberMaster Host-Manager Migration Plan

Status: future implementation plan, 2026-08-23

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` to derive a phase-specific execution plan, then use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement it. Do not execute this program as one undivided change.

**Goal:** Introduce a `cybermaster` host-manager command that owns the Web UI, host metadata, compatibility boundary, and lifecycle of one process-wide agent backend while preserving the current OpenCode implementation and data.

**Architecture:** CyberMaster becomes the only browser-visible origin and supervises a private OpenCode child process. The first release transparently proxies the existing OpenCode APIs, SSE, and PTY WebSockets, while a separate CyberMaster database stores manager metadata only. Host-domain extraction and Hermes support remain later, explicit programs.

**Tech stack:** Bun, TypeScript, Effect, Effect HTTP/Socket, SQLite/Drizzle, SolidJS, OpenCode V1/V2 APIs.

**Spec:** This document supersedes the earlier assumption that backend selection belongs inside the existing OpenCode server or in individual canvas/session bindings.

## Global constraints

- Preserve dependency direction: Schema to Core and Protocol, then Core and Protocol to Server; Client may depend on Schema and Protocol but never Core or Server.
- Keep backend selection process-wide and immutable for a running CyberMaster process.
- Keep Session IDs, transcripts, queues, backend selection, and runtime status out of layout and browser persistence.
- Keep the current OpenCode data unit intact for the first release; do not split or dual-write its workspace, session, message, CtxPack, or context records.
- Keep `opencode serve` and `opencode web` working as rollback paths.
- Run tests and `bun typecheck` only from package directories.
- Regenerate clients after public Protocol or Server `HttpApi` changes; never edit generated clients directly.

---

## 1. Current-project classification

| Classification | Treatment |
| --- | --- |
| Reuse | SolidJS UI, Canvas/Block Runtime v3, `CanvasSessionSurface`, Workspace/Layout services, FunctionalityInstance, SessionV2, EventV2, CtxPack, and context capsules |
| Finish first | The uncommitted OperatingChat SessionV2 migration |
| Replace after manager parity | ChatRelay proxy/polling/localStorage flow, legacy canvas binding synchronization, and renderer fallbacks |
| Add | Dedicated `cybermaster` executable, host metadata DB, UI front door, OpenCode supervisor, and transparent HTTP/SSE/WebSocket compatibility proxy |
| Deliberately defer | Host migration of workspace/session data, generic operation/artifact platforms, and Hermes implementation |

Locked decisions:

- Stable command: `cybermaster --backend opencode -- <backend arguments>`.
- OpenCode is the default when `--backend` is omitted.
- OpenCode runs as a supervised foreground child.
- Releases bundle a version-matched sibling OpenCode binary.
- The browser communicates only with CyberMaster's same-origin listener.
- Hermes is an accepted selector that fails before any persistent or external side effect.
- Unexpected child exits trigger indefinite jittered backoff; CyberMaster never replays requests automatically.

## 2. Phase 0: complete the current OperatingChat migration

- [ ] Preserve the current dirty worktree and finish OperatingChat as a separate, reviewable change before starting manager work.
- [ ] Keep `workspace.operatingAgent` distinct from the MasterAgent model, with no model fallback or draft OperatingContext injection.
- [ ] Complete typed get/ensure/reset behavior, revision and busy-state handling, workspace/block validation, runtime invalidation, and retry/reset UI.
- [ ] Render only through the canonical `CanvasSessionSurface`; remove any remaining browser-owned transcript or fake execution behavior.
- [ ] Keep the durable binding in FunctionalityInstance configuration and out of layout/local view state.
- [ ] Regenerate the Promise, Effect, and legacy JavaScript clients, then verify a second generation produces no changes.

Exit gate:

- Concurrent ensure calls produce one visible binding.
- Reconnect reuses the persisted binding.
- Reset is revision-guarded and blocked while active or pending.
- Package-scoped tests and typechecks pass.

## 3. Phase 1: CyberMaster/OpenCode vertical slice

### 3.1 Composition and command

Create `packages/cybermaster` as a new composition-root package. Do not rename or repurpose either existing OpenCode CLI.

```text
cybermaster \
  [--backend opencode|hermes] \
  [--hostname HOST] [--port PORT] \
  [--backend-bin PATH] [--open] \
  -- [backend-specific arguments...]
```

Defaults:

- backend: `opencode`;
- hostname: `127.0.0.1`;
- port: first available port beginning at `4096`;
- browser opening: disabled unless `--open` is supplied;
- backend executable: bundled sibling `opencode[.exe]`.

Everything after `--` must remain an argv array in its original order. Never construct a shell command string.

`--backend hermes` must fail before creating host paths, opening a database, generating credentials, binding a listener, or spawning a process.

### 3.2 Host storage and ownership

Use independent CyberMaster paths:

```text
<data>/cybermaster/cybermaster.db
<state>/cybermaster/
```

Support absolute deployment/test overrides with `CYBERMASTER_DB`, `CYBERMASTER_DATA_DIR`, and `CYBERMASTER_STATE_DIR`.

The first database contains only:

```text
managed_backend
  id
  kind
  data_root
  adapter_version
  last_seen_version
  created_at
  updated_at
```

Rules:

- Insert or update the row only after authenticated backend readiness.
- Treat the startup flag as authoritative; a stored kind mismatch fails with a migration-required error.
- Do not mirror OpenCode workspaces, layouts, sessions, messages, CtxPack records, artifacts, or transcripts.
- Acquire an exclusive manager lock for the selected OpenCode data unit.
- Never overlap an old child process with its replacement.

### 3.3 Managed OpenCode launch contract

CyberMaster launches:

```text
<bundled-opencode> serve <unchanged trailing argv>
```

Add a versioned internal OpenCode control file selected through `OPENCODE_SERVER_CONTROL_FILE`:

```ts
type ManagedServerControlV1 = {
  readonly version: 1
  readonly nonce: string
  readonly hostname: "127.0.0.1"
  readonly port: 0
  readonly ephemeralPort: true
  readonly mdns: false
  readonly cors: readonly []
  readonly readyFile: string
}
```

OpenCode applies these trusted values after normal CLI/config parsing. This is the manager-wins rule: backend network arguments remain present and ordered but cannot expose or relocate the private listener.

After listening, OpenCode atomically writes:

```ts
type ManagedServerReadyV1 = {
  readonly version: 1
  readonly nonce: string
  readonly pid: number
  readonly url: string
  readonly opencodeVersion: string
}
```

CyberMaster accepts readiness only after verifying the launch nonce, child PID, loopback URL, compatible version, and an authenticated `/global/health` response. A stale readiness file must never satisfy a later generation.

Generate a fresh random backend Basic-auth credential for each child launch. Do not persist or expose it.

### 3.4 Front door, UI, and proxy

CyberMaster is the only browser-visible origin.

- Serve the current SolidJS app from embedded assets in production.
- Support `CYBERMASTER_WEB_UI_URL` for Vite development.
- Add a CyberMaster-hosted UI mode that always targets `location.origin` and disables direct remote-server addition/switching.
- Reserve `/api/cybermaster/*` for host-owned APIs.
- Initially expose:

```ts
type CyberMasterHealth = {
  readonly host: { readonly healthy: true }
  readonly backend: {
    readonly kind: "opencode"
    readonly status: "starting" | "ready" | "restarting"
    readonly generation: number
    readonly restartAttempt: number
    readonly version?: string
  }
}
```

Proxy every current OpenCode API required by the UI, including legacy and V2 endpoints. The proxy must:

- stream HTTP bodies and SSE without buffering;
- bridge PTY WebSockets bidirectionally while preserving subprotocols, binary frames, close codes, and backpressure;
- preserve paths, queries, Location parameters, and directory/workspace routing headers;
- remove hop-by-hop headers;
- strip browser authorization before injecting the private backend authorization;
- never expose the private URL, PID, credentials, arguments, or data paths;
- serve known static files and SPA navigation before treating a request as a backend request.

Extract the existing HTTP/WebSocket proxy mechanics into a reusable primitive with a configurable header policy. Preserve OpenCode's current remote-workspace stripping behavior; CyberMaster's policy must forward the routing headers.

`/api/event` remains the one browser event connection and is transparently proxied in this phase. Do not add another persistent browser stream.

### 3.5 Authentication and supervision

- Allow password-free loopback use.
- Require `CYBERMASTER_SERVER_PASSWORD` before any non-loopback bind; default the username to `cybermaster`.
- Do not add TLS termination in this phase; non-loopback deployment must use a TLS reverse proxy.
- Bind the public listener before starting the child, but print/open the ready URL only after first backend readiness.

On an unexpected child exit:

- increment the generation;
- close proxied SSE/WebSocket connections;
- return a stable `503 backend_unavailable` response with `Retry-After` for proxied traffic;
- retry after 250 ms, doubling to a 30-second cap with ±20% jitter;
- reset the attempt counter after 60 seconds of healthy runtime;
- never replay HTTP mutations, prompts, WebSocket frames, or provider execution.

Browser recovery must refetch authoritative state. An ambiguous OpenCode prompt may only be reconciled through its existing message-ID/idempotency behavior.

SIGINT/SIGTERM stops retries, terminates only the owned child, waits for graceful shutdown, kills the owned process tree if necessary, then closes the listener, lock, temporary files, and database.

### 3.6 Development and packaging

- [ ] Point root development orchestration and Vite at CyberMaster's public port; keep OpenCode on its private managed port.
- [ ] Build platform bundles containing matching `cybermaster` and `opencode` sibling executables plus embedded UI assets.
- [ ] Permit `--backend-bin` for development/custom installations, but enforce the same readiness and exact-version check.
- [ ] Keep standalone OpenCode commands unchanged for rollback.

## 4. Phase 2: remove functional duplication behind the front door

- [ ] Convert ChatRelay's visible block to its existing SessionV2 binding and `CanvasSessionSurface`.
- [ ] Remove ChatRelay browser transcript authority, localStorage, 750 ms polling, fake optimistic execution, and `/api/chat-proxy` usage.
- [ ] Disable and remove legacy ChatProxy routes after parity; retain old payload tables read-only for one migration window before an explicit later drop.
- [ ] Remove manager-level ChatRelay binding listeners, MasterAgent renderer fallback, and unused session-binding adapters once no active registration uses them.
- [ ] Convert the legacy browser workspace context from localStorage authority into an API-backed projection/cache.
- [ ] Reconcile the `layout_option.device_id` migration/table mismatch.
- [ ] Keep Block Runtime v3 and one browser event stream; reconnect always refetches instead of trusting missed transient events.

## 5. Verification and acceptance

### Unit and process tests

- CLI delimiter parsing, defaults, exact trailing argv, backend-bin resolution, authentication rules, and Hermes no-side-effect failure.
- Control/ready-file schema, nonce/PID/version validation, loopback enforcement, and stale-file rejection.
- Real fixture child processes covering delayed readiness, malformed readiness, crash loops, graceful shutdown, and forced termination.

### Proxy and integration tests

- Streaming requests/responses, large bodies, SSE heartbeats, cancellation, routing headers, and authorization replacement.
- PTY WebSocket text/binary frames, subprotocols, close propagation, and restart disconnection.
- A real managed OpenCode child using temporary complete data roots.
- Existing workspaces, layouts, sessions, prompts, approvals, files, review, and terminals through the CyberMaster origin.

### Browser tests

- OperatingChat and MasterAgent parity.
- Initial ChatRelay compatibility followed by canonical SessionV2 parity.
- Exactly one `/api/event` browser connection.
- Backend restart, authoritative refetch, and no automatic prompt duplication.
- CyberMaster-hosted mode cannot connect directly to a remote backend.

### Package verification

- Run affected package tests and `bun typecheck` from each package directory.
- Run `bun run generate` from `packages/client` after public Protocol or Server `HttpApi` changes.
- Rebuild the legacy JavaScript SDK after its public surface changes.
- Verify a second generation is clean.
- Build and smoke-test the paired binaries on the current platform.

Acceptance gates:

- `cybermaster` defaults to a private managed OpenCode backend and serves the current UI without visible behavior loss.
- Existing OpenCode data remains accessible and unmodified in ownership.
- The browser never learns or connects to the child URL.
- A user action creates at most one backend prompt; restart never causes replay.
- Host UI/status remains available during automatic backend restart.
- Hermes selection has no side effects and exits nonzero with an explicit unsupported-backend error.
- Standalone OpenCode remains a working rollback path against the same data unit.

## 6. Deliberately deferred programs

The first host-manager release does not include:

- migration of Workspace, Layout, FunctionalityInstance, Session, CtxPack, or transcript authority into CyberMaster storage;
- a universal session/event schema or third transcript database;
- generic operation, artifact, audit, or execution-target platforms without a concrete consumer;
- simultaneous OpenCode and Hermes execution;
- live session conversion between engines.

Hermes support later uses managed `hermes serve` and its JSON-RPC/WebSocket gateway rather than only an OpenAI-compatible chat endpoint. It requires host-owned normalized APIs, capability discovery, interaction mapping, and reconnect reconciliation. Backend switching requires a new host profile or explicit migration and never reinterprets existing OpenCode sessions.

Reference: [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md).

## 7. Rollout, estimates, and assumptions

Roll out `cybermaster` as opt-in. Keep standalone OpenCode selectable until proxy, restart, and browser parity gates pass. Rollback consists of stopping CyberMaster and launching the unchanged OpenCode server against the same OpenCode data unit.

Estimated effort for one experienced engineer:

| Workstream | Estimate |
| --- | --- |
| Finish OperatingChat | 3–5 days |
| Manager/front-door vertical slice | 3–5 engineer-weeks |
| Runtime and ChatRelay convergence | 1–2 engineer-weeks |
| Production hardening | 1–2 engineer-weeks |

Usable OpenCode-backed CyberMaster manager: approximately 5–8 engineer-weeks. Host-domain extraction and Hermes are separate follow-on programs.

Assumptions:

- The initial deployment is single-user and manages exactly one backend process.
- Existing OpenCode data remains in place and is neither split nor dual-written.
- Backend selection is immutable for a running process and absent from layouts and block bindings.
- Unsupported capabilities are never simulated.
- The current OperatingChat work is preserved and completed before manager implementation.
- Repository findings reflect the `feature/CyberMaster` tree audited on 2026-08-23.
