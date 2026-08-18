# MasterAgent Contracts and Data Model

Target branch: `feature/UnrealViewer`.

This is the normative interface snapshot that lets leaf agents begin concurrently. Repository naming may be adapted to established conventions, but field meaning, authority, and call direction must remain unchanged. Temporary local type aliases are allowed only inside a track's owned files and must be replaced before final verification.

## 1. Ownership model

```text
Workspace
  model                   primary model
  operatingAgent          primary coordinator agent
  coderModel              optional workspace-wide Coder model

Functionality instance
  workspaceID
  blockID
  functionalityID         builtin:master-agent
  directoryBinding
  sessionBinding          server-managed
  revision/tombstone

Session domain
  messages
  prompt input admission
  queued/steered inputs
  runs
  child Coder sessions
  terminal/file/review state

Canvas layout
  block identity
  functionality/type
  transform/presentation
  never session binding or queue state
```

## 2. Workspace schema

Use the exact existing model-selection schema used by `Workspace.Info.model`.

```ts
interface WorkspaceInfo {
  // existing fields
  model: ModelSelection | null
  operatingAgent: string | null
  coderModel: ModelSelection | null
}

interface WorkspacePatch {
  // existing fields
  coderModel?: ModelSelection | null
}
```

Semantics:

- omitted patch: unchanged
- explicit `null`: disable/clear Coder
- concrete selection: persist provider/model exactly
- existing rows: decode as `null`

## 3. MasterAgent schema

```ts
namespace MasterAgent {
  const FunctionalityID = "builtin:master-agent" as const

  type DirectoryBinding =
    | { mode: "workspace-primary" }
    | { mode: "fixed"; directory: string }

  interface SessionBinding {
    mode: "owned"
    sessionID: Session.ID
    generation: number
  }

  interface InstanceConfiguration {
    version: 1
    directoryBinding: DirectoryBinding
    sessionBinding: SessionBinding | null // server-managed
  }

  interface Binding {
    workspaceID: Workspace.ID
    blockID: string
    functionalityInstanceID: string
    sessionID: Session.ID
    directory: string
    generation: number
    revision: number
  }

  interface GetRequest {
    workspaceID: Workspace.ID
    blockID: string
  }

  interface EnsureRequest {
    workspaceID: Workspace.ID
    blockID: string
  }

  interface ResetRequest {
    workspaceID: Workspace.ID
    blockID: string
    expectedSessionID: Session.ID
    expectedRevision: number
  }

  interface BindingUpdatedEvent {
    type: "workspace.master-agent.binding.updated"
    workspaceID: Workspace.ID
    blockID: string
    sessionID: Session.ID
    generation: number
    revision: number
  }
}
```

Operations:

```text
workspace.masterAgent.get
workspace.masterAgent.ensure
workspace.masterAgent.reset
```

There is no MasterAgent prompt endpoint.

## 4. Typed lifecycle errors

Use repository error conventions, preserving these distinguishable meanings:

```ts
type MasterAgentError =
  | { type: "workspace-not-found" }
  | { type: "block-not-found" }
  | { type: "wrong-functionality"; actual?: string }
  | { type: "instance-not-found" }
  | { type: "session-not-found" }
  | { type: "access-denied" }
  | { type: "stale-binding"; current?: MasterAgent.Binding }
  | { type: "reset-busy" }
  | { type: "reset-has-pending-input" }
  | { type: "concurrent-conflict" }
```

Do not collapse stale conflicts, access denial, and reset policy failures into a generic 500.

## 5. Functionality-instance repository port

```ts
interface FunctionalityInstanceRepository {
  get(key: {
    workspaceID: Workspace.ID
    blockID: string
    functionalityID: "builtin:master-agent"
  }): Effect<FunctionalityInstance | null>

  getOrCreate(key, initialConfiguration): Effect<FunctionalityInstance>

  compareAndSwapConfiguration(input: {
    instanceID: string
    expectedRevision: number
    nextConfiguration: MasterAgent.InstanceConfiguration
  }): Effect<
    | { type: "updated"; instance: FunctionalityInstance }
    | { type: "conflict"; current: FunctionalityInstance }
  >

  tombstone(instanceID: string, expectedRevision: number): Effect<void>
}
```

The concrete repository stays generic and does not create Sessions.

## 6. Binding transition port

Pure functions should cover:

```ts
parseConfiguration(raw): MasterAgent.InstanceConfiguration
existingBinding(configuration, instanceRevision, directory): MasterAgent.Binding | null
initialBinding(candidateSessionID, generation, directory): next configuration
resetBinding(current, candidateSessionID): next configuration
validateResetExpected(current, expectedSessionID, expectedRevision): result
```

Session idle/pending information is passed in; the pure state machine does not query services.

## 7. Session adapter port

```ts
interface MasterAgentSessionAdapter {
  createTopLevel(input: {
    directory: string
    workspaceID: Workspace.ID
    blockID: string
  }): Effect<Session.ID>

  validate(sessionID: Session.ID): Effect<"valid" | "missing" | "deleted">

  activity(sessionID: Session.ID): Effect<{
    idle: boolean
    pendingInputCount: number
  }>

  cleanupLosingCandidate(sessionID: Session.ID): Effect<
    "removed" | "archived" | "not-empty" | "unsupported"
  >
}
```

Reset never deletes the previously bound session.

## 8. Event publisher port

```ts
interface MasterAgentEventPublisher {
  bindingUpdated(event: MasterAgent.BindingUpdatedEvent): Effect<void>
}
```

Publish only after persistence succeeds. Do not publish for idempotent ensure or stale CAS. Reconnect recovery reads persisted state.

## 9. Lifecycle service port

```ts
interface MasterAgentService {
  get(request: MasterAgent.GetRequest): Effect<MasterAgent.Binding | null, MasterAgentError>
  ensure(request: MasterAgent.EnsureRequest): Effect<MasterAgent.Binding, MasterAgentError>
  reset(request: MasterAgent.ResetRequest): Effect<MasterAgent.Binding, MasterAgentError>
}
```

## 10. Host Coder context and runner

```ts
interface MasterAgentSessionContext {
  workspaceID: Workspace.ID
  blockID: string
  functionalityInstanceID: string
  parentSessionID: Session.ID
  directory: string
  primaryModel: ModelSelection | null
  operatingAgent: string | null
  coderModel: ModelSelection | null
  taskPermission: "allow" | "deny" | "ask" | "default"
}

interface ChildTaskRunner {
  runTrusted(input: {
    parentSessionID: Session.ID
    directory: string
    agentID: "coder"
    model: ModelSelection
    task: string
    context?: string
  }): Effect<ChildTaskResult>
}
```

The model-visible Coder tool argument schema may contain task/context only. It must not contain workspace ID, directory, parent session, agent, provider, model, or permission override.

## 11. Client port and reducer

```ts
interface MasterAgentPort {
  get(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding | null>
  ensure(workspaceID: string, blockID: string, signal?: AbortSignal): Promise<MasterAgent.Binding>
  reset(input: MasterAgent.ResetRequest, signal?: AbortSignal): Promise<MasterAgent.Binding>
  patchCoderModel(workspaceID: string, coderModel: ModelSelection | null, signal?: AbortSignal): Promise<WorkspaceInfo>
}

type BindingState =
  | { status: "uninitialized" }
  | { status: "loading" }
  | { status: "ready"; binding: MasterAgent.Binding }
  | { status: "permission-denied" }
  | { status: "unavailable"; reason: string }
  | { status: "error"; error: unknown; recoverable: boolean }
```

Events with `revision <= current.revision` are ignored. Reconnect triggers authoritative get/ensure.

## 12. Manager API

```ts
interface MasterAgentManagerApi {
  state(blockID: string): Accessor<BindingState>
  ensure(blockID: string): Promise<void>
  retry(blockID: string): Promise<void>
  reset(blockID: string): Promise<void>
  removeLocalProjection(blockID: string): void

  coder: {
    model: Accessor<ModelSelection | null>
    pending: Accessor<boolean>
    error: Accessor<unknown | null>
    set(model: ModelSelection): Promise<void>
    clear(): Promise<void>
    retry(): Promise<void>
  }
}
```

This API owns binding/config communication only. It does not own Session messages, prompt admission, queue projection, terminal, files, or review state.

## 13. Explicit Session surface

```ts
interface SessionSurfaceTarget {
  sessionID: Session.ID
  directory?: string
  workspaceID?: Workspace.ID
}

interface CanvasSessionSurfaceProps {
  target: SessionSurfaceTarget
  surfaceID: string
  focused: boolean
  queueEnabled: boolean
  onFocus(): void
  onRequestOpenFullPage?(): void
}
```

The existing Session subsystem remains authoritative. The surface must support more than one mounted instance without route or singleton collisions.

## 14. Presentational block contract

```ts
interface MasterAgentBlockShellProps {
  status: BindingState["status"]
  focused: boolean
  canReset: boolean
  resetDisabledReason?: string
  onFocus(): void
  onRetry(): void
  onReset(): void
  onOpenFullPage?(): void
  sessionSlot?: JSX.Element
  coderSlot?: JSX.Element
}
```

The controlled Coder selector receives a view model from the manager; it never imports the SDK.

## 15. Queue contract

The block sets the existing Session composer option equivalent to:

```ts
queueEnabled: true
```

When busy, the existing composer calls:

```ts
handleSubmit(event, "queue")
```

which immediately sends:

```ts
delivery: "queue"
```

No new queue type, reducer, persistence, timer, or prompt endpoint is permitted.

## 16. Interface-first development rule

A leaf track may define a temporary type-only interface inside its owned file when an upstream module is not merged. It must:

1. Match this document exactly.
2. Be used only behind the track's public constructor/port.
3. Be removed or replaced during rebase.
4. Never leak into generated SDK output or a shared barrel.
5. Never justify editing another track's file.
