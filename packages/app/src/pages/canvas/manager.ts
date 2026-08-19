// Canvas communication manager: the subsystem that talks to the backend on
// behalf of the standalone canvas UI. The UI owns rendering and local
// interactions (client-authoritative); everything the backend owns — the
// workspace layout, its revision and authority, the OperatingAgent model, and
// the project permission config — is fetched, pushed, and updated here, then
// handed to the UI through callbacks and reactive signals.

import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import { createEffect, createRoot, createSignal, type Accessor } from "solid-js"
import type {
  PermissionAction,
  PermissionConfig,
  WorkspaceBlockRecord,
  WorkspaceLayoutInfo,
  WorkspaceLayoutTuple,
} from "@opencode-ai/sdk/v2/client"
import type { createSdkForServer } from "@/utils/server"
import {
  createCoderController,
  type CoderController,
  type CoderTaskPermission,
} from "./master-agent/coder-controller"
import { createMasterAgentEventReconciliation } from "./master-agent/event-reconciliation"
import {
  MASTER_AGENT_FUNCTIONALITY_ID,
  MASTER_AGENT_MODULE,
  type MasterAgentBlockModule,
} from "./master-agent/functionality"
import {
  createMasterAgentLifecycleController,
  type MasterAgentLifecycleController,
} from "./master-agent/lifecycle-controller"
import { createMasterAgentPort } from "./master-agent/port"
import { createMasterAgentSdkPort } from "./master-agent/sdk-port"
import type { BindingState, MasterAgentPort, ModelSelection } from "./master-agent/types"

export interface CanvasManagerInput {
  clientID: string
  directory: () => string | undefined
  isMobile: () => boolean
  /** Serialize the UI's local blocks for a layout push. */
  getRecords: () => WorkspaceBlockRecord[]
  /** The backend handed the UI a layout; the UI applies it to its blocks. */
  onServerLayout: (layout: WorkspaceLayoutInfo) => void
  /** The server announces authoritative chat-relay session bindings; keep
   * descriptor-owned session IDs in sync with UI state. */
  onChatRelayBinding?: (binding: { blockID: string; sessionID: string | undefined }) => void
  /** Whether the UI currently has local (non-legacy) blocks. */
  hasLocalBlocks: () => boolean
  notify: (message: string) => void
  /** M5 sdk-port factory: maps G1's generated master-agent endpoints and the
   * workspace coderModel patch/read onto the M1 client port. Defaults to the
   * M5 composition (createMasterAgentPort(createMasterAgentSdkPort(client)));
   * hosts may override for tests or alternative transports. */
  masterAgentPort?: MasterAgentPortFactory
  /** Client-side availability gate for the workspace Coder model; the host
   * re-validates server-side. Defaults to always available. */
  isCoderModelAvailable?: (model: ModelSelection) => boolean
  /** Test seam: overrides the ServerSDK context accessor. */
  serverSDK?: Accessor<ServerSDK>
}

/** M5's sdk-port factory shape (spec 02 §11). */
export type MasterAgentPortFactory = (client: ReturnType<typeof createSdkForServer>) => MasterAgentPort

/** Narrow MasterAgent surface consumed by B3 (spec 02 §12). Owns binding and
 * workspace Coder configuration communication only; Session messages, prompt
 * admission, queue projection, terminal, files, and review state stay in the
 * existing Session subsystems. */
export interface MasterAgentManagerApi {
  state(blockID: string): Accessor<BindingState>
  ensure(blockID: string): Promise<void>
  retry(blockID: string): Promise<void>
  reset(blockID: string): Promise<void>
  removeLocalProjection(blockID: string): void
  coder: CoderController<ModelSelection>
  /** The master-agent functionality descriptor (block type/module metadata). */
  descriptor: MasterAgentBlockModule
}

export interface CanvasManager {
  workspaceID: () => string | undefined
  revision: () => number | undefined
  connected: () => boolean
  dirty: () => boolean
  operatingAgentKey: () => string | undefined
  modelKey: () => string | undefined
  directories: () => string[] | undefined
  configPermission: () => PermissionConfig | undefined
  /** The UI edited blocks; the manager decides dirty vs local-authoritative. */
  noteLocalEdit: () => void
  connect: () => Promise<void>
  refresh: () => Promise<WorkspaceLayoutInfo | undefined>
  sync: () => Promise<void>
  selectOperatingAgent: (key: string) => Promise<void>
  selectModel: (key: string) => Promise<void>
  updateDirectories: (directories: string[]) => Promise<void>
  loadConfig: () => Promise<void>
  masterAgent: MasterAgentManagerApi
  start: () => void
  dispose: () => void
}

// A layout whose only block is the unit-sized default chat block means the
// server has never received a user arrangement.
export function isPristineDefault(layout: WorkspaceLayoutInfo) {
  const only = layout.blocks.length === 1 ? layout.blocks[0] : undefined
  return only !== undefined && only.functionality === "builtin:chat" && only.transform.w <= 1 && only.transform.h <= 1
}

export function createCanvasManager(input: CanvasManagerInput): CanvasManager {
  const serverSDK = input.serverSDK ?? useServerSDK()
  const [workspaceID, setWorkspaceID] = createSignal<string>()
  const [revision, setRevision] = createSignal<number>()
  const [connected, setConnected] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [operatingAgentKey, setOperatingAgentKey] = createSignal<string>()
  const [modelKey, setModelKey] = createSignal<string>()
  const [directories, setDirectories] = createSignal<string[]>()
  const [configPermission, setConfigPermission] = createSignal<PermissionConfig>()

  let tupleCache: WorkspaceLayoutTuple | undefined
  let syncInFlight = false
  let refreshInFlight = false
  let localAuthoritative = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let configUnsubscribe: (() => void) | undefined
  let layoutUnsubscribe: (() => void) | undefined
  let chatRelayBindingUnsubscribe: (() => void) | undefined
  let started = false

  // MasterAgent domain state (M6): per-block lifecycle controllers, the
  // binding-event reconciliation, and the workspace-wide Coder controller.
  // The host owns the authoritative binding and Coder model; this manager
  // owns only client projections. Layout serialization, localStorage, and
  // IndexedDB never carry binding/session/queue state (spec 02 §1-2).
  const [coderModelValue, setCoderModelValue] = createSignal<ModelSelection | null>(null)
  const controllers = new Map<string, MasterAgentLifecycleController>()
  const reconnectListeners = new Set<() => void>()
  let port: MasterAgentPort | undefined
  let coderController: CoderController<ModelSelection> | undefined
  let hasConnectedOnce = false
  let disposed = false
  const chatRelayRevisions = new Map<string, number>()

  // The layout tuple is fixed for the lifetime of the client session: the
  // server resolves/stores one layout per (user, style, deviceClass).
  function layoutTuple(): WorkspaceLayoutTuple {
    tupleCache ??= { user: "", style: "default", deviceClass: input.isMobile() ? "mobile" : "desktop" }
    return tupleCache
  }

  async function ensureWorkspace() {
    const current = workspaceID()
    if (current) return current
    const client = serverSDK().client
    const list = await client.v2.workspace.list({ throwOnError: true })
    let id = list.data[0]?.id
    if (!id) {
      const created = await client.v2.workspace.create({ name: "Default" }, { throwOnError: true })
      id = created.data.id
    }
    setWorkspaceID(id)
    return id
  }

  // Flips the client to connected and, on any connect after the first, tells
  // the master-agent reconciliation to re-sync known blocks (authoritative
  // get/ensure, spec 02 §11): the event stream may have dropped while
  // disconnected and buffered events are transient.
  function markConnected() {
    setConnected(true)
    if (hasConnectedOnce) fireMasterAgentReconnect()
    hasConnectedOnce = true
  }

  // Pull: runs when the client connects. The server is authoritative here;
  // afterwards the client owns the layout until the next change is synced.
  // Pulling also claims layout authority for this client (handover): the
  // last client to pull a tuple owns its layout.
  async function connect() {
    if (connected()) return
    try {
      const client = serverSDK().client
      const id = await ensureWorkspace()
      const workspaceResult = await client.v2.workspace.get({ id }, { throwOnError: true })
      setOperatingAgentKey(workspaceResult.data.operatingAgent)
      setModelKey(workspaceResult.data.model)
      setDirectories(workspaceResult.data.directories)
      setCoderModelValue(parseModelKey(workspaceResult.data.coderModel))
      const result = await client.v2.workspace.layout.get(
        { workspaceLayoutGetPayload: { workspaceID: id, tuple: layoutTuple(), clientID: input.clientID } },
        { throwOnError: true },
      )
      const layout = result.data
      // The client edited while the backend was unreachable (DEV mode): those
      // edits are authoritative. Keep them and push once connected, instead
      // of clobbering the canvas with the server's stale layout.
      const clientOwnsLayout = localAuthoritative || (isPristineDefault(layout) && input.hasLocalBlocks())
      if (clientOwnsLayout) {
        setRevision(layout.revision)
        markConnected()
        setDirty(true)
        localAuthoritative = false
        void sync()
        void syncChatRelayBindings()
        return
      }
      input.onServerLayout(layout)
      setRevision(layout.revision)
      markConnected()
      setDirty(false)
      void syncChatRelayBindings()
    } catch {
      setConnected(false)
      retryTimer = setTimeout(() => void connect(), 5000)
    }
  }

  // Re-pull the authoritative layout. Pulling re-claims authority, so a
  // handed-over client re-syncs to the latest state and can push again.
  async function refresh() {
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      const client = serverSDK().client
      const result = await client.v2.workspace.layout.get(
        { workspaceLayoutGetPayload: { workspaceID: workspaceID()!, tuple: layoutTuple(), clientID: input.clientID } },
        { throwOnError: true },
      )
      input.onServerLayout(result.data)
      void syncChatRelayBindings()
      setRevision(result.data.revision)
      return result.data
    } catch {
      return undefined
    } finally {
      refreshInFlight = false
    }
  }

  // Push: only when the layout actually changed after connect. Movements are
  // already live client-side; this just re-syncs the settled state.
  async function sync() {
    if (syncInFlight || !connected() || !dirty() || revision() === undefined || !workspaceID()) return
    syncInFlight = true
    setDirty(false)
    const blocks = input.getRecords()
    const expectedRevision = revision()!
    try {
      const client = serverSDK().client
      const result = await client.v2.workspace.layout.save(
        {
          workspaceLayoutSavePayload: {
            workspaceID: workspaceID()!,
            tuple: layoutTuple(),
            blocks,
            expectedRevision,
            clientID: input.clientID,
          },
        },
        { throwOnError: true },
      )
      if (result.data.status === "saved") {
        setRevision(result.data.layout.revision)
        if (dirty()) void sync()
        return
      }
      if (result.data.status === "handed-over") {
        // Authority was handed over to another client (another window/device
        // connected after us). Re-pull to re-claim, adopt the latest layout,
        // and re-push our settled state (explicit retry = last-write-wins).
        await refresh()
        input.notify("Layout updated from another window")
        setDirty(true)
        void sync()
        return
      }
      // Conflict: the server is the tie-breaker. Re-pull and adopt.
      await refresh()
      setDirty(false)
      input.notify("Layout updated from server")
    } catch {
      // The change is not lost: re-raise the dirty flag and retry after a
      // short delay, so a transient failure re-syncs without user input.
      setDirty(true)
      setTimeout(() => void sync(), 3000)
    } finally {
      syncInFlight = false
    }
  }

  // Selects the workspace's OperatingAgent model: optimistic on the client,
  // authoritative on the server (workspace.operatingAgent).
  async function selectOperatingAgent(key: string) {
    const id = workspaceID()
    if (!id) return
    setOperatingAgentKey(key)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { operatingAgent: key } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save OperatingAgent model")
    }
  }

  // Selects the workspace's frontend model: optimistic on the client,
  // authoritative on the server (workspace.model).
  async function selectModel(key: string) {
    const id = workspaceID()
    if (!id) return
    setModelKey(key)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { model: key } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save workspace model")
    }
  }

  // Updates the workspace's working directories: optimistic on the client,
  // authoritative on the server (workspace.directories). The first directory
  // is the workspace's primary directory (chat blocks bind to it).
  async function updateDirectories(next: string[]) {
    const id = workspaceID()
    if (!id) return
    setDirectories(next)
    try {
      const client = serverSDK().client
      await client.v2.workspace.update(
        { workspaceUpdatePayload: { id, patch: { directories: next } } },
        { throwOnError: true },
      )
    } catch {
      input.notify("Failed to save workspace directories")
    }
  }

  // Config: loads the project config (the project's .opencode config folder
  // via the directory-scoped SDK). If the project has no permission
  // configuration yet, one is created with ALL permissions denied.
  async function loadConfig() {
    const directory = input.directory()
    if (!directory) return
    try {
      const client = serverSDK().createClient({ directory, throwOnError: true })
      const result = await client.config.get({ directory }, { throwOnError: true })
      const config = result.data
      if (config.permission === undefined) {
        await client.config.update({ directory, config: { permission: "deny" } }, { throwOnError: true })
        setConfigPermission("deny")
        input.notify("Project config created — all permissions denied")
        return
      }
      setConfigPermission(config.permission)
    } catch {
      /* offline or no project yet — retried on reconnect */
    }
  }

  function noteLocalEdit() {
    if (connected()) setDirty(true)
    else if (import.meta.env.DEV) localAuthoritative = true
  }

  // Chat-relay block IDs in the current layout records.
  function chatRelayBlockIDs(): string[] {
    return input
      .getRecords()
      .filter((record) => record.functionality === "builtin:chat-relay")
      .map((record) => record.id)
  }

  // Chat-relay bindings are authoritative. Rebuild descriptor bindings from the
  // chat-relay API after layout changes so the first-boot path can hydrate
  // existing server-bound sessions even without events.
  function syncChatRelayBindings() {
    const id = workspaceID()
    if (!id) return
    const blockIDs = chatRelayBlockIDs()
    if (blockIDs.length === 0) return

    void Promise.all(
      blockIDs.map(async (blockID) => {
        try {
          const result = await serverSDK().client.v2.workspace.chatRelay.get(
            { workspaceID: id, blockID },
            { throwOnError: true },
          )
          const response = result.data
          if (response.status === "bound") {
            chatRelayRevisions.set(blockID, response.binding.revision)
            input.onChatRelayBinding?.({ blockID, sessionID: response.binding.sessionID })
            return
          }
          chatRelayRevisions.delete(blockID)
          input.onChatRelayBinding?.({ blockID, sessionID: undefined })
        } catch {
          /* chat-relay fetch failures are non-blocking for canvas interactions */
        }
      }),
    )
  }

  // ---- MasterAgent domain (M6) ----

  // Master-agent block IDs in the current layout records; layout is the only
  // client-side source of block identity (never session/binding state).
  function masterAgentBlockIDs(): string[] {
    return input
      .getRecords()
      .filter((record) => record.functionality === MASTER_AGENT_FUNCTIONALITY_ID)
      .map((record) => record.id)
  }

  // M5's sdk-port maps the generated master-agent endpoints onto the M1
  // transport; the default composition adapts that transport to this
  // manager's port. Hosts may inject an alternative via `masterAgentPort`.
  function resolvePort(): MasterAgentPort {
    port ??= (input.masterAgentPort ?? defaultMasterAgentPort)(serverSDK().client)
    return port
  }

  function controllerFor(blockID: string): MasterAgentLifecycleController {
    let controller = controllers.get(blockID)
    if (!controller) {
      controller = createMasterAgentLifecycleController({
        workspaceID,
        blockID,
        port: resolvePort(),
      })
      controllers.set(blockID, controller)
    }
    return controller
  }

  function fireMasterAgentReconnect() {
    for (const listener of reconnectListeners) listener()
  }

  // A binding-updated event can land before the block's initial get finishes;
  // hand the newest buffered event to the controller once it has a revision
  // to compare against (stale events are dropped by the reducer).
  function drainBufferedBinding(blockID: string) {
    const event = reconciliation.takeBuffered(blockID)
    if (event) controllers.get(blockID)?.dispatch({ type: "binding-updated", event })
  }

  const reconciliation = createMasterAgentEventReconciliation({
    workspaceID,
    isKnownBlock: (blockID) => masterAgentBlockIDs().includes(blockID),
    knownBlocks: masterAgentBlockIDs,
    currentRevision: (blockID) => {
      const state = controllers.get(blockID)?.state()
      return state?.status === "ready" ? state.binding.revision : undefined
    },
    onBindingUpdated: (event) => {
      controllers.get(event.blockID)?.dispatch({ type: "binding-updated", event })
    },
    refetch: (blockID) => void controllerFor(blockID).refetch(),
    listen: (listener) =>
      serverSDK().event.listen((entry) => {
        // The ServerSDK emitter delivers `{ name, details }` with `details`
        // being the ServerEvent (type + properties); the reconciliation
        // filters by `details.type` and drops stale/foreign payloads.
        listener({ name: entry.name, details: { type: entry.details.type, properties: entry.details.properties } })
      }),
    onReconnect: (listener) => {
      reconnectListeners.add(listener)
      return () => {
        reconnectListeners.delete(listener)
      }
    },
  })

  // Drop projections for master-agent blocks that left the layout; the canvas
  // block-removal flow never needs to know about them.
  const disposeBlockTracking = createRoot((disposeRoot) => {
    createEffect(() => {
      const blockIDs = masterAgentBlockIDs()
      for (const [blockID, controller] of controllers) {
        if (blockIDs.includes(blockID)) continue
        controller.dispose()
        controllers.delete(blockID)
      }
    })
    return disposeRoot
  })

  // The project config's `task` permission gates Coder configuration; the
  // host enforces it again server-side.
  function taskPermission(): CoderTaskPermission {
    const permission = resolveConfigPermission(configPermission(), "task")
    if (permission === "allow" || permission === "ask" || permission === "deny") return permission
    return "default"
  }

  // Workspace-wide Coder settings (spec 02 §12): one controller per manager,
  // shared by every master-agent block in the workspace.
  function coder(): CoderController<ModelSelection> {
    coderController ??= createCoderController({
      workspaceID,
      coderModel: coderModelValue,
      patchCoderModel: (id, model, signal) => resolvePort().patchCoderModel(id, model, signal),
      onServerModel: (model) => setCoderModelValue(model),
      taskPermission,
      isModelAvailable: input.isCoderModelAvailable ?? (() => true),
    })
    return coderController
  }

  const masterAgent: MasterAgentManagerApi = {
    state: (blockID) => controllerFor(blockID).state,
    ensure: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).ensure()
      drainBufferedBinding(blockID)
    },
    retry: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).retry()
      drainBufferedBinding(blockID)
    },
    reset: async (blockID) => {
      if (disposed) return
      await controllerFor(blockID).reset()
    },
    removeLocalProjection: (blockID) => {
      const controller = controllers.get(blockID)
      if (!controller) return
      controller.dispose()
      controllers.delete(blockID)
    },
    coder: {
      get model() {
        return coder().model
      },
      get enabled() {
        return coder().enabled
      },
      get pending() {
        return coder().pending
      },
      get error() {
        return coder().error
      },
      set: (model) => coder().set(model),
      clear: () => coder().clear(),
      retry: () => coder().retry(),
    },
    descriptor: MASTER_AGENT_MODULE,
  }

  let cleanupLocalListeners: () => void = () => {}

  function start() {
    if (started) return
    started = true
    makeEventListeners()
    void serverSDK().event.start()
    void connect()
    void loadConfig()
  }

  function makeEventListeners() {
    const unsubs: (() => void)[] = []
    const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void) => {
      target.addEventListener(type, handler as EventListener)
      unsubs.push(() => target.removeEventListener(type, handler as EventListener))
    }

    on<Event>(window, "online", () => {
      if (!connected()) void connect()
      else fireMasterAgentReconnect()
      if (configPermission() === undefined) void loadConfig()
    })
    // Re-claim layout authority when the window regains focus: push pending
    // edits, otherwise re-pull so another client's handover becomes visible.
    on<Event>(window, "focus", () => {
      if (!connected()) void connect()
      else if (dirty()) void sync()
      else void refresh()
    })

    // The project config (permissions) can change server-side; re-gate the
    // blocks live when a config.updated event arrives.
    configUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "config.updated") return
      void loadConfig()
    })
    // Realtime layout fan-out: another client (or surface) saved this
    // workspace's layout. Re-pull to adopt it live; pending local edits are
    // re-pushed after adoption (last-write-wins, mirroring the handover flow).
    layoutUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "workspace.layout.updated") return
      const properties = entry.details.properties as { workspaceID?: string; revision?: number }
      if (!connected() || syncInFlight || refreshInFlight) return
      if (workspaceID() && properties.workspaceID && properties.workspaceID !== workspaceID()) return
      if (properties.revision !== undefined && properties.revision <= (revision() ?? 0)) return
      if (dirty()) {
        void refresh().then(() => {
          setDirty(true)
          void sync()
        })
        return
      }
      void refresh()
    })

    chatRelayBindingUnsubscribe = serverSDK().event.listen((entry) => {
      const type = entry.details.type as string
      if (type !== "workspace.chatRelay.binding.updated") return
      const properties = entry.details.properties as
        | {
            workspaceID?: unknown
            blockID?: unknown
            sessionID?: unknown
            revision?: unknown
          }
        | undefined
      if (!isRecord(properties)) return
      if (typeof properties.workspaceID !== "string" || properties.workspaceID !== workspaceID()) return
      if (typeof properties.blockID !== "string") return
      if (properties.sessionID !== undefined && typeof properties.sessionID !== "string") return
      if (typeof properties.revision !== "number") return
      const existingRevision = chatRelayRevisions.get(properties.blockID)
      if (existingRevision !== undefined && existingRevision >= properties.revision) return
      chatRelayRevisions.set(properties.blockID, properties.revision)
      input.onChatRelayBinding?.({
        blockID: properties.blockID,
        sessionID: typeof properties.sessionID === "string" ? properties.sessionID : undefined,
      })
    })

    cleanupLocalListeners = () => unsubs.forEach((unsub) => unsub())
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(retryTimer)
    cleanupLocalListeners()
    configUnsubscribe?.()
    layoutUnsubscribe?.()
    chatRelayBindingUnsubscribe?.()
    configUnsubscribe = undefined
    layoutUnsubscribe = undefined
    chatRelayBindingUnsubscribe = undefined
    reconciliation.dispose()
    disposeBlockTracking()
    reconnectListeners.clear()
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    port = undefined
    coderController = undefined
    chatRelayRevisions.clear()
    started = false
  }

  return {
    workspaceID,
    revision,
    connected,
    dirty,
    operatingAgentKey,
    modelKey,
    directories,
    configPermission,
    noteLocalEdit,
    connect,
    refresh,
    sync,
    selectOperatingAgent,
    selectModel,
    updateDirectories,
    loadConfig,
    masterAgent,
    start,
    dispose,
  }
}

// Workspace model fields are `providerID:modelID` keys (the canvas model
// picker's key format); M1's ModelSelection is the structured view of the
// same selection. Malformed or missing keys decode as null.
function parseModelKey(key: string | null | undefined): ModelSelection | null {
  if (!key) return null
  const [providerID, modelID, variant] = key.split(":")
  if (!providerID || !modelID) return null
  return variant === undefined ? { providerID, modelID } : { providerID, modelID, variant }
}

// Mirrors the canvas page's config normalization for the `task` permission
// key. The page's helper cannot be imported here without a module cycle.
function resolveConfigPermission(config: PermissionConfig | undefined, key: string): PermissionAction | undefined {
  if (!config) return undefined
  if (typeof config === "string") return config
  const value = config[key] ?? config["*"]
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  return resolveConfigPermission(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Default port composition (M5): sdk-port adapts G1's generated
// master-agent endpoints and the workspace coderModel patch onto the M1
// transport; the port layer adapts that transport to this manager's port.
function defaultMasterAgentPort(client: ReturnType<typeof createSdkForServer>): MasterAgentPort {
  return createMasterAgentPort(createMasterAgentSdkPort(client))
}
