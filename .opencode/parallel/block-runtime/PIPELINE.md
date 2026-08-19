# ChatRelay Block — End-to-End Pipeline Architecture & Compacted Source

Generated 2026-08-19 (Cybermaster). Purpose: single self-contained reference for the
ChatRelay block runtime — backend→frontend communication pipeline, diagnosis notes,
and all critical-path source code.

## TL;DR — current status

- **Backend pipeline VERIFIED working end-to-end** (2026-08-19, live dev server :4096):
  `ensure` → binding created → `session.prompt` ("ping") → assistant `pong!` persisted
  + event stream flowing.
- **User-visible symptoms were caused by a STALE frontend bundle**: the dev server
  serves the embedded UI from `packages/opencode/src/server/shared/opencode-web-ui.gen.ts`,
  which still pointed at `index-mjRXeggk.js` (built 13:23, BEFORE the relay→native
  migration UI landed). That bundle polls the DELETED `/relay/status` route and shows
  "The account auth subsystem reported an error. Retry initialization." when the poll
  fails, and never receives live updates because the legacy relay provider is gone.
- Fix: rebuild the embedded UI (`bun run packages/opencode/script/embed-web-ui.ts`) —
  the dev server (bun --watch) then serves the current frontend, which uses
  `v2.workspace.chatRelay.ensure` + `CanvasSessionSurface` (native session events).
- Dev data dir: source runs use `D:/OpencodeDev/.test-data/opencode-test.db`
  (`Database.path()` → `InstallationLocal` → repo `.test-data/`), NOT
  `~/.local/share/opencode/opencode.db`. All migrations are applied there.

## Architecture — request/response and live-update paths

### 1. Block mount → binding (ensure)

```
LegacyChatRelayBody (blocks/chat-relay/view.tsx)
  onMount → serverSDK().client.v2.workspace.chatRelay.ensure({workspaceID, blockID})
    POST /api/workspace/:workspaceID/chat-relay/:blockID/ensure
      → ChatRelaySessionHandler (server/handlers/chat-relay-session.ts)
        → access check (chat-relay-session-access.ts)
        → ChatRelaySessionService.ensure (core/workspace/chat-relay-session.ts)
          → WorkspaceService.get (workspace_v2)
          → verifyBlock: layout.get → blocks.find(id)   [BlockNotFoundError if the
             canvas hasn't synced its layout to the server yet]
          → FunctionalityInstance.getOrCreate (functionality_instance table, CAS on revision)
          → SessionPortService.create → SessionV2.create({location})  [plain session;
             default agent/model → user config deepseek-v4-pro/inferai]
          → persist configuration.sessionBinding = {mode:"owned", sessionID, generation}
  ← {workspaceID, blockID, functionalityInstanceID, sessionID, directory, generation, revision}
  → applyPersistedChatRelayBinding (workspace.tsx) persists sessionID into the
    block's descriptor bindings (localStorage + next layout sync)
```

### 2. Prompt

```
SessionSurfaceBase (session-surface-base.tsx, via CanvasSessionSurface)
  composer submit → useSession prompt
    POST /api/session/:id/prompt  {prompt:{text}, delivery:"steer"|"queue"}
      → SessionV2.prompt (core/session.ts — V2 session core; admits session_input row,
        wakes SessionExecution; AGENTS.md V2 rules)
      → model resolution (session.agent ?? config default agent.build → model
        deepseek-v4-pro via inferai api key)
      → provider call → assistant message parts persisted (session_message)
```

### 3. Live updates (event fan-out)

```
Model work → SessionV2/EventV2 durable events (aggregateID=sessionID, seq)
  → EventV2 bus (core/event.ts pubsub + event_sequence table)
  → GET /api/event (SSE; server/handlers/event.ts handleRaw + Sse.encode + heartbeat)
  → app server-sdk context (context/server-sdk.tsx) — for-await over sse.get().stream,
     adaptServerEvent() → per-directory queues → session state (SessionStateKey)
  → SessionSurfaceBase re-renders messages/parts incrementally
```

### 4. New Block Runtime v2 layer (this run; flag-gated, OFF by default)

```
workspace.tsx onMount: VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true
  → enableChatRelayBlockRuntime (runtime/bootstrap.ts)
    → registry.register("builtin:chat-relay", ChatRelayRuntimeAdapter)
    → createServerBlockRuntimeContext (runtime/server-transport.ts)
       snapshot:  POST /api/block-runtime/snapshot  → resourceSnapshot
                  (runtime/resource-snapshot.ts; sessions/messages/parts/permissions/auth
                  over SessionV2/Credential/PermissionV2)
       subscribe: GET  /api/block-runtime/event (SSE) → blockRuntimeStream
                  (runtime/block-runtime-gateway.ts; EventV2.allBounded → translate →
                  dedupe (aggregateID,seq) → gap→resync.required → cursor
                  `runtime:<millis+n>` → groupedWithin batching)
    → globalThis.__CHAT_RELAY_RUNTIME_V2__ / __CHAT_RELAY_RUNTIME_CONTEXT__
  → ChatRelayBody (view.tsx) renders RuntimeChatRelayBody when flag on,
    LegacyChatRelayBody otherwise (plan §H fallback — legacy default)
```

### 5. Canvas layout sync (descriptor ↔ server)

```
manager.ts (createCanvasManager) — backend-authoritative:
  layout pull: v2.workspace.layout.get → applyServerLayout (workspace.tsx;
    merges ONLY descriptor fields + prior runtime presentation state, never
    replaces messages/bindings)
  layout put: local edits → toRecords() → layout.put (revision CAS)
  chat-relay binding: onChatRelayBinding → applyPersistedChatRelayBinding →
    descriptor.bindings.sessionID persisted (localStorage + layout sync)
```

## Diagnosis notes (2026-08-19)

1. **"account auth subsystem reported an error"** = stale-bundle message from the
   migration-era ChatRelayBody (13:23 build). It polls the deleted `/relay/status`;
   every poll fails → error state. The current source never emits this string.
2. **"block not updating live"** = same stale bundle: legacy relay provider deleted;
   current bundle uses native session events (/api/event SSE) which are flowing.
3. `v2.workspace.chatRelay.ensure` works live (verified: created session
   `ses_fe69c2ae8ffeudqNuSaDHxh0lN` in `.test-data` DB, prompted "ping" → "pong!").
4. Ensure fails with `ChatRelayBlockNotFoundError` when the canvas hasn't synced
   layout (server layout row must contain the block id).
5. Account/credential tables are EMPTY in both dev and prod DBs — irrelevant for the
   ChatRelay block (default model = inferai/deepseek, api key). The old relay
   ChatGPT creds remain at `~/.local/share/opencode/chat-relay/chatgpt/credentials.json`
   (only needed if a ChatGPT-account model is re-introduced).
6. **Layout authority theft (fixed 2026-08-19)**: `Workspace.layout.get` claims
   layout authority for the requesting clientID ("last puller owns the tuple").
   The block lifecycle services read the layout with FIXED clientIDs
   (`chat-relay-service`, `master-agent-service`) on every get/ensure/reset →
   every block operation silently stole authority from the browser canvas →
   the UI's next save got `handed-over` → refresh → adopt server layout →
   "server authoritative" feel. Fix: `layout.get` accepts
   `{ claimAuthority?: boolean }`; both services pass `claimAuthority: false`
   (core/workspace/service.ts, chat-relay-session.ts, master-agent.ts).
   Verified live: authority holder unchanged after an ensure call.

---
## COMPACTED SOURCE — critical path
---

### A. Frontend — ChatRelay body (legacy + runtime paths)

File: `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx` (key excerpts)

```tsx
// Flag: legacy is the safe default; runtime path activates only when explicitly set.
function parseRuntimeV2(): boolean {
  const value = (globalThis as { __CHAT_RELAY_RUNTIME_V2__?: unknown }).__CHAT_RELAY_RUNTIME_V2__
  return value === true || value === "true" || value === 1 || value === "1"
}

export function ChatRelayBody(props: ChatRelayBodyProps): JSX.Element {
  if (parseRuntimeV2()) return <RuntimeChatRelayBody {...props} />
  return <LegacyChatRelayBody {...props} />
}

// Legacy path (default): ensure binding → CanvasSessionSurface (native session).
function LegacyChatRelayBody(props: ChatRelayBodyProps) {
  const serverSDK = useServerSDK()
  const [binding, setBinding] = createSignal<{ workspaceID; blockID; functionalityInstanceID;
    sessionID; directory?; generation; revision }>()
  const [status, setStatus] = createSignal<"uninitialized" | "loading" | "ready" | "error">("uninitialized")
  const networkDenied = () => permissionDenied(props.permissions, "webfetch") || permissionDenied(props.permissions, "websearch")
  const ensureBinding = async () => {
    if (networkDenied() || !props.workspaceID || status() === "loading") return
    setStatus("loading")
    try {
      const result = await serverSDK().client.v2.workspace.chatRelay.ensure(
        { workspaceID: props.workspaceID, blockID: props.block.id }, { throwOnError: true })
      setBinding(result.data); setStatus("ready")
    } catch { setBinding(undefined); setStatus("error") }
  }
  onMount(() => { void ensureBinding() })
  const sessionOptions = () => {
    const current = binding()
    if (!current) return undefined
    return createMasterAgentSessionOptions({ sessionID: current.sessionID,
      directory: current.directory, workspaceID: current.workspaceID })
  }
  return (
    <div class="canvas-relay-layout">
      <Show when={networkDenied()}>…Permission denied…</Show>
      <Show when={!networkDenied() && status() !== "ready"}>…status/retry…</Show>
      <Show when={!networkDenied() && status() === "ready"}>
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurface target={options().target}
              surfaceID={`chat-relay-${props.block.id}`} focused={props.focused}
              onFocus={props.onFocus} queueEnabled={options().queueEnabled} />
          )}
        </Show>
      </Show>
    </div>
  )
}

// Runtime path (flag on): adapter over BlockRuntimeContext (mock fallback).
function RuntimeChatRelayBody(props: ChatRelayBodyProps) {
  // … resolves globalThis.__CHAT_RELAY_RUNTIME_CONTEXT__ ?? createMockChatRelayContext()
  //   hydrate → applySnapshot → subscribe(bindings, cursor, onEvent)
  //   render: auth awaiting-login gate / disconnected banner / messages / permission
  //   buttons / composer (promptText + submitError component-local)
}
```

### B. Frontend — adapter + view model + mock context

File: `packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts` (key excerpts)

```ts
export interface ChatRelayRuntimeContext {
  state?: RuntimeResourceState
  snapshot(bindings?: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(bindings: RuntimeResourceBinding[], cursor: string,
            onEvent: (event: RuntimeEventEnvelope) => void): () => void
  sendCommand(command: ChatRelayCommand): Promise<void>
}

export const CHAT_RELAY_DEFAULT_SESSION_ID = "chat-relay-default-session"

export const ChatRelayRuntimeAdapter = {
  getBindings(descriptor: ChatRelayBlockDescriptor) {
    const sessionID = descriptor.bindings?.sessionID ?? CHAT_RELAY_DEFAULT_SESSION_ID
    return [
      { type: "auth", id: "opencode" },
      { type: "session", id: sessionID },
      { type: "message", id: sessionID },
      { type: "message-part", id: sessionID },
      { type: "permission", id: sessionID },
    ] satisfies RuntimeResourceBinding[]
  },
  async hydrate(descriptor, context) { return context.snapshot(this.getBindings(descriptor)) },
  select(descriptor, state) { /* messages filtered by sessionID, sorted by timeCreated;
      text = parts.filter(kind==="text").map(p=>p.text).join("") */ },
  async dispatch(descriptor, command, context) { return context.sendCommand(command) },
}
```

### C. Frontend — server-backed runtime transport + bootstrap

File: `packages/app/src/pages/canvas/runtime/server-transport.ts`

```ts
import type { ServerSDK } from "@/context/server-sdk"

export const createServerBlockRuntimeContext = (sdk: Accessor<ServerSDK>): ChatRelayRuntimeContext => ({
  async snapshot(bindings = []) {
    const result = await sdk().client.v2.blockRuntime.snapshot({ bindings }, { throwOnError: true })
    return { cursor: result.data.cursor, state: result.data.state }
  },
  subscribe(bindings, cursor, onEvent) {
    let cancelled = false
    void (async () => {
      try {
        const iterable = await sdk().client.v2.blockRuntime.subscribe({ bindings, cursor })
        for await (const event of iterable.stream) { if (cancelled) break; onEvent(event) }
      } catch { /* keep last snapshot */ }
    })()
    return () => { cancelled = true }
  },
  async sendCommand(command) {
    throw new Error(`sendCommand(${command.type}): routes through Track C OpencodeChat adapter — integration follow-up`)
  },
})
```

File: `packages/app/src/pages/canvas/runtime/bootstrap.ts`

```ts
export const enableChatRelayBlockRuntime = (sdk: ServerSDKGetter) => {
  const registry = createBlockRuntimeRegistry()
  registry.register("builtin:chat-relay", ChatRelayRuntimeAdapter as never)
  const context = createServerBlockRuntimeContext(sdk)
  const globals = globalThis as { __CHAT_RELAY_RUNTIME_CONTEXT__?: unknown; __CHAT_RELAY_RUNTIME_V2__?: unknown }
  globals.__CHAT_RELAY_RUNTIME_CONTEXT__ = context
  globals.__CHAT_RELAY_RUNTIME_V2__ = true
  return () => { delete globals.__CHAT_RELAY_RUNTIME_CONTEXT__; delete globals.__CHAT_RELAY_RUNTIME_V2__ }
}
```

### D. Frontend — canvas descriptor / binding persistence (workspace.tsx excerpts)

```ts
// CanvasBlock carries bindings (sessionID) instead of relay runtime state.
interface CanvasBlock { id; type; x; y; w; h; z; collapsed; defaultRect;
  text; listening; messages: CanvasMessage[]; agentKey; layers; history;
  bindings?: Record<string, string | undefined> }

// Server-authoritative hydration: merges ONLY descriptor fields + prior runtime
// presentation state (messages/listening/agentKey/layers/history/text/bindings).
function applyServerLayout(layout: WorkspaceLayoutInfo) { /* recordToBlock per record,
  mergeServerRuntime(block, existing) — never replaces runtime state */ }

// Binding update op: persists a newly created sessionID without touching runtime.
function applyPersistedChatRelayBinding(binding: { blockID: string; sessionID?: string }) {
  // find block → if chat-relay → setState("blocks", index, "bindings", {…sessionID}) → persist()
}
```

### E. Backend — protocol group

File: `packages/protocol/src/groups/chat-relay.ts` (full, abridged errors)

```ts
const root = "/api/workspace"
export const ChatRelayGroup = HttpApiGroup.make("server.workspace.chatRelay")
  .add(HttpApiEndpoint.get("workspace.chatRelay.get",
    `${root}/:workspaceID/chat-relay/:blockID`,
    { params: { workspaceID: Workspace.ID, blockID: Schema.String },
      success: ChatRelay.GetResponse, error: [/*404/400/403/409 set*/] }))
  .add(HttpApiEndpoint.post("workspace.chatRelay.ensure",
    `${root}/:workspaceID/chat-relay/:blockID/ensure`,
    { params: ChatRelayParams, success: ChatRelay.Binding, error: [/*…*/] }))
  .add(HttpApiEndpoint.post("workspace.chatRelay.reset",
    `${root}/:workspaceID/chat-relay/:blockID/reset`,
    { params: ChatRelayParams, payload: ChatRelay.ResetPayload,
      success: ChatRelay.Binding, error: [/*… incl. StaleBinding/Busy*/] }))
```

### F. Backend — handler (access + domain error mapping)

File: `packages/server/src/handlers/chat-relay-session.ts` (excerpts)

```ts
export const ChatRelaySessionHandler = HttpApiBuilder.group(Api, "server.workspace.chatRelay", (handlers) =>
  Effect.gen(function* () {
    const chatRelaySession = yield* ChatRelaySessionService.Service
    const access = yield* ChatRelaySessionAccessService
    return handlers
      .handle("workspace.chatRelay.get", Effect.fn(function* (ctx) {
        yield* access.requireAccess(ctx.params.workspaceID, ctx.params.blockID).pipe(Effect.mapError(toHttpGetError))
        const binding = yield* chatRelaySession.get(ctx.params.workspaceID, ctx.params.blockID).pipe(Effect.mapError(toHttpGetError))
        return binding === undefined ? { status: "unbound" } : { status: "bound", binding }
      }))
      .handle("workspace.chatRelay.ensure", Effect.fn(function* (ctx) {
        yield* access.requireAccess(ctx.params.workspaceID, ctx.params.blockID).pipe(Effect.mapError(toHttpGetError))
        return yield* chatRelaySession.ensure(ctx.params.workspaceID, ctx.params.blockID).pipe(Effect.mapError(toHttpGetError))
      }))
      .handle("workspace.chatRelay.reset", /* same + payload expectedSessionID/expectedRevision */)
  }),
)
```

### G. Backend — binding service (core/workspace/chat-relay-session.ts excerpts)

```ts
export interface Interface {
  get(workspaceID, blockID): Effect<ChatRelay.Binding | undefined, Ws/Block/WrongFn errors>
  ensure(workspaceID, blockID): Effect<ChatRelay.Binding, Ws/Block/WrongFn errors>
  reset(workspaceID, blockID, expectedSessionID, expectedRevision): Effect<Binding, …|Stale|Busy|InstanceNotFound>
}

// ensure (abridged):
//  requireWorkspace → verifyBlock (layout.get → blocks.find) → parseConfiguration
//  (sessionBinding: {mode:"owned", sessionID, generation} | null)
//  existing owned binding → return; else create candidate session via
//  SessionPortService.create({location: {directory, workspaceID}})
//  claimInstance (insert or CAS on revision) → persist configuration with owned binding
//  publish ChatRelay event via EventV2
// reset: guard hasPendingInput(session_input.promoted_seq IS NULL) → BusyError;
//  CAS expectedRevision → StaleBindingError; create fresh session; keep old one.
```

### H. Backend — block runtime gateway + snapshot (this run)

File: `packages/server/src/runtime/block-runtime-gateway.ts` (excerpts)

```ts
export const translateEvent = (event: EventV2.Payload): Option.Option<RuntimeEventEnvelope> => {
  // session.next.prompt.admitted → message.created (role user)
  // session.next.prompted            → session.status busy
  // session.next.text.started/delta/ended → message-part.updated kind text
  // session.next.reasoning.*         → message-part.updated kind reasoning
  // session.next.tool.*              → message-part.updated kind tool (state passthrough)
  // permission.v2.asked/replied      → permission.requested/resolved (reply once/always/reject)
  // session.next.step.failed         → session.status idle + error
}

export const blockRuntimeStream = (bindings, resume?) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    // latestSequence per bound session → seqBase
    const live = (yield* EventV2.allBounded(events, 512)) as Stream<NativeEvent>
    // filter(isRelevant) → mapEffect(translateEvent + durable dedupe (aggregateID,seq)
    //   + gap→resync.required) → cursor = `runtime:${Date.now()+counter++}`
    // → groupedWithin(64, "50 millis") → flattenIterable
  })
```

File: `packages/server/src/runtime/resource-snapshot.ts` (excerpts)

```ts
export const resourceSnapshot = (bindings) =>
  Effect.gen(function* () {
    // sessions: SessionV2.get → {id, status: active.has(id)?busy:idle, modelID, agentID}
    // messages: SessionV2.messages → {id, sessionID, role, timeCreated} (+ user text part)
    // parts: assistant content → {id, messageID, kind, text|state, error}
    // permissions: PermissionV2.forSession → pending requests
    // auth: Credential.get(providerID) → ready|missing
    // cursor: `snapshot:${maxSeq}` over bound sessions' EventV2.latestSequence
  })
```

### I. Server composition (boot wiring; Credential.node fix)

File: `packages/opencode/src/server/routes/instance/httpapi/server.ts` (excerpts)

```ts
const serverRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(handlers),                 // all @opencode-ai/server handlers
  Layer.provide(chatRelaySessionAccessLive),
  Layer.provide(masterAgentAccessLive),
  Layer.provide(PluginPtyEnvironment.layer),
  Layer.provide([serverHttpApiAuthLayer, v2SchemaErrorLayer]),
)
const app = LayerNode.group([
  Npm.node, FSUtil.node, Database.node, Credential.node /* ← added: required by
  BlockRuntimeHandler (first httpapi consumer of Credential.Service; without it:
  boot crash "Service not found: opencode/v2/Credential") */, Auth.node, …, EventV2.node, …,
])
```

## Verification commands

```bash
# backend pipeline (live server on 4096, unsecured dev)
curl -X POST "http://127.0.0.1:4096/api/workspace/<wid>/chat-relay/<blockID>/ensure"
curl -X POST "http://127.0.0.1:4096/api/session/<sid>/prompt" -H "Content-Type: application/json" -d '{"prompt":{"text":"ping"},"delivery":"steer"}'
# dev DB (NOT the prod one): D:/OpencodeDev/.test-data/opencode-test.db
# UI rebuild (after frontend changes): bun run packages/opencode/script/embed-web-ui.ts
# flag (runtime v2): VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true (app build-time env)
```
