// Canvas communication manager: the subsystem that talks to the backend on
// behalf of the standalone canvas UI. The UI owns rendering and local
// interactions (client-authoritative); everything the backend owns — the
// workspace layout, its revision and authority, the OperatingAgent model, and
// the project permission config — is fetched, pushed, and updated here, then
// handed to the UI through callbacks and reactive signals.

import { useServerSDK } from "@/context/server-sdk"
import { createSignal } from "solid-js"
import type {
  PermissionConfig,
  WorkspaceBlockRecord,
  WorkspaceLayoutInfo,
  WorkspaceLayoutTuple,
} from "@opencode-ai/sdk/v2/client"

export interface CanvasManagerInput {
  clientID: string
  directory: () => string | undefined
  isMobile: () => boolean
  /** Serialize the UI's local blocks for a layout push. */
  getRecords: () => WorkspaceBlockRecord[]
  /** The backend handed the UI a layout; the UI applies it to its blocks. */
  onServerLayout: (layout: WorkspaceLayoutInfo) => void
  /** Whether the UI currently has local (non-legacy) blocks. */
  hasLocalBlocks: () => boolean
  notify: (message: string) => void
}

export interface CanvasManager {
  workspaceID: () => string | undefined
  revision: () => number | undefined
  connected: () => boolean
  dirty: () => boolean
  operatingAgentKey: () => string | undefined
  modelKey: () => string | undefined
  configPermission: () => PermissionConfig | undefined
  /** The UI edited blocks; the manager decides dirty vs local-authoritative. */
  noteLocalEdit: () => void
  connect: () => Promise<void>
  refresh: () => Promise<WorkspaceLayoutInfo | undefined>
  sync: () => Promise<void>
  selectOperatingAgent: (key: string) => Promise<void>
  selectModel: (key: string) => Promise<void>
  loadConfig: () => Promise<void>
  disposeRelay: () => Promise<void>
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
  const serverSDK = useServerSDK()
  const [workspaceID, setWorkspaceID] = createSignal<string>()
  const [revision, setRevision] = createSignal<number>()
  const [connected, setConnected] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [operatingAgentKey, setOperatingAgentKey] = createSignal<string>()
  const [modelKey, setModelKey] = createSignal<string>()
  const [configPermission, setConfigPermission] = createSignal<PermissionConfig>()

  let tupleCache: WorkspaceLayoutTuple | undefined
  let syncInFlight = false
  let refreshInFlight = false
  let localAuthoritative = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let configUnsubscribe: (() => void) | undefined
  let layoutUnsubscribe: (() => void) | undefined
  let started = false

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
        setConnected(true)
        setDirty(true)
        localAuthoritative = false
        void sync()
        return
      }
      input.onServerLayout(layout)
      setRevision(layout.revision)
      setConnected(true)
      setDirty(false)
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

  // Tears down the backend-side relay session when its block is removed.
  async function disposeRelay() {
    try {
      await serverSDK().client.v2.relay.dispose({ throwOnError: true })
    } catch {
      /* the server may already have disposed the session */
    }
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

    cleanupLocalListeners = () => unsubs.forEach((unsub) => unsub())
  }

  function dispose() {
    clearTimeout(retryTimer)
    cleanupLocalListeners()
    configUnsubscribe?.()
    layoutUnsubscribe?.()
    configUnsubscribe = undefined
    layoutUnsubscribe = undefined
    started = false
  }

  return {
    workspaceID,
    revision,
    connected,
    dirty,
    operatingAgentKey,
    modelKey,
    configPermission,
    noteLocalEdit,
    connect,
    refresh,
    sync,
    selectOperatingAgent,
    selectModel,
    loadConfig,
    disposeRelay,
    start,
    dispose,
  }
}
