type BlockLayout = Record<string, unknown>

export interface FakeWorkspaceStateSnapshot {
  id: string
  model: string
  operatingAgent: string | null
  coderModel: string | null
}

type WorkspacePatch = {
  id: string
  patch: Record<string, unknown>
}

type FailureMode = "none" | "not-found" | "conflict" | "handover"

interface FakeWorkspaceFailure {
  mode: FailureMode
  handoverWorkspaceID?: string
}

type FakeWorkspaceError = Error & {
  code: FailureMode
  handoverWorkspaceID?: string
}

export interface FakeWorkspaceAPI {
  client: {
    workspace: {
      list: () => Promise<{ data: { id: string }[] }>
      get: () => Promise<{ data: FakeWorkspaceStateSnapshot }>
      create: () => Promise<{ data: FakeWorkspaceStateSnapshot }>
      update: (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => Promise<{ data: FakeWorkspaceStateSnapshot }>
      layout: {
        get: () => Promise<{ data: { blocks: BlockLayout[]; revision: number } }>
        save: (parameters: { workspaceLayoutSavePayload: { blocks: BlockLayout[] } }) => Promise<{ data: { status: "saved"; layout: { blocks: BlockLayout[]; revision: number } } }>
      }
    }
    v2: {
      workspace: {
        list: () => Promise<{ data: { id: string }[] }>
        get: () => Promise<{ data: FakeWorkspaceStateSnapshot }>
        create: () => Promise<{ data: FakeWorkspaceStateSnapshot }>
        update: (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => Promise<{ data: FakeWorkspaceStateSnapshot }>
        layout: {
          get: () => Promise<{ data: { blocks: BlockLayout[]; revision: number } }>
          save: (parameters: { workspaceLayoutSavePayload: { blocks: BlockLayout[] } }) => Promise<{ data: { status: "saved"; layout: { blocks: BlockLayout[]; revision: number } } }>
        }
      }
    }
  }
  listCalls: string[]
  getCalls: string[]
  createCalls: string[]
  updateCalls: Array<{ id: string; patch: Record<string, unknown> }>
  savedLayouts: BlockLayout[][]
  workspacePatches: WorkspacePatch[]
  layoutGets: () => number
  layoutRevisions: () => number
  workspaceRevision: () => number
  workspaceEpoch: () => number
  getCurrentWorkspaceID: () => string | undefined
  getWorkspaceState: () => FakeWorkspaceStateSnapshot
  injectNotFound: () => void
  injectConflict: () => void
  injectHandover: (workspaceID: string) => void
  clearInjectedFailure: () => void
  deleteCurrentWorkspace: () => void
  resetCurrentWorkspace: () => void
  workspaceSnapshot: () => unknown
  reset: () => void
}

const DEFAULT_BLOCKS: BlockLayout[] = [{ id: "default-chat", functionality: "builtin:chat", transform: { x: 0, y: 0, w: 1, h: 1, z: 0 } }]

function clone<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createFakeWorkspaceAPI(options?: { workspaceID?: string; model?: string; initialBlocks?: BlockLayout[] }) {
  const workspaceID = options?.workspaceID ?? "ws-default"
  const model = options?.model ?? "acme:primary"
  const initialBlocks = options?.initialBlocks ?? clone(DEFAULT_BLOCKS)

  const listCalls: string[] = []
  const getCalls: string[] = []
  const createCalls: string[] = []
  const updateCalls: WorkspacePatch[] = []
  const savedLayouts: BlockLayout[][] = []
  const workspacePatches: WorkspacePatch[] = []
  const layoutBlocks: BlockLayout[] = clone(initialBlocks)
  let layoutRevision = 1
  let getCallsCount = 0
  let layoutGets = 0
  let listGets = 0
  let workspaceEpochCounter = 0
  let currentWorkspaceID: string | undefined = workspaceID
  let currentModel = model
  let currentCoderModel: string | null = null
  let currentOperatingAgent: string | null = null
  let workspaceRevision = 1
  let failure: FakeWorkspaceFailure = { mode: "none" }

  function currentSnapshot() {
    if (currentWorkspaceID === undefined) {
      throw Object.assign(new Error("not-found"), { code: "not-found" }) as FakeWorkspaceError
    }

    return {
      id: currentWorkspaceID,
      model: currentModel,
      operatingAgent: currentOperatingAgent,
      coderModel: currentCoderModel,
    } satisfies FakeWorkspaceStateSnapshot
  }

  function maybeThrow() {
    if (failure.mode === "none") return

    const mode = failure.mode
    const target = failure.handoverWorkspaceID
    failure = { mode: "none" }

    const error = new Error(mode) as FakeWorkspaceError
    error.code = mode

    if (mode === "handover" && target) {
      error.handoverWorkspaceID = target
    }

    throw error
  }

  const workspace = {
    list: async () => {
      listGets += 1
      listCalls.push(`list-${listGets}`)
      if (currentWorkspaceID === undefined) throw Object.assign(new Error("not-found"), { code: "not-found" })
      maybeThrow()
      return { data: [{ id: currentWorkspaceID }] }
    },
    get: async () => {
      getCallsCount += 1
      getCalls.push(`get-${getCallsCount}`)
      if (currentWorkspaceID === undefined) throw Object.assign(new Error("not-found"), { code: "not-found" })
      maybeThrow()
      return { data: currentSnapshot() }
    },
    create: async () => {
      if (!currentWorkspaceID) currentWorkspaceID = workspaceID
      createCalls.push(`create-${currentWorkspaceID}`)
      workspaceRevision += 1
      return { data: currentSnapshot() }
    },
    update: async (parameters: { workspaceUpdatePayload: { id: string; patch: Record<string, unknown> } }) => {
      const patch = parameters.workspaceUpdatePayload.patch
      workspacePatches.push({ id: parameters.workspaceUpdatePayload.id, patch })
      updateCalls.push({ id: parameters.workspaceUpdatePayload.id, patch })
      currentModel = (patch.model as string | undefined) ?? currentModel
      currentCoderModel = (patch.coderModel as string | null | undefined) ?? currentCoderModel
      currentOperatingAgent = (patch.operatingAgent as string | null | undefined) ?? currentOperatingAgent
      return { data: currentSnapshot() }
    },
    layout: {
      get: async () => {
        layoutGets += 1
        return { data: { blocks: clone(layoutBlocks), revision: layoutRevision } }
      },
      save: async (parameters: { workspaceLayoutSavePayload: { blocks: BlockLayout[] } }) => {
        const blocks = clone(parameters.workspaceLayoutSavePayload.blocks)
        savedLayouts.push(blocks)
        layoutRevision += 1
        layoutBlocks.length = 0
        layoutBlocks.push(...clone(blocks))
        return { data: { status: "saved", layout: { blocks: clone(blocks), revision: layoutRevision } } }
      },
    },
  }

  const createFakeWorkspaceState = {
    client: {
      workspace,
      v2: {
        workspace,
      },
    },
    listCalls,
    getCalls,
    createCalls,
    updateCalls,
    savedLayouts,
    workspacePatches,
    layoutGets: () => layoutGets,
    layoutRevisions: () => layoutRevision,
    workspaceRevision: () => workspaceRevision,
    workspaceEpoch: () => workspaceEpochCounter,
    getCurrentWorkspaceID: () => currentWorkspaceID,
    getWorkspaceState: () => currentSnapshot(),
    injectNotFound: () => {
      failure.mode = "not-found"
    },
    injectConflict: () => {
      failure.mode = "conflict"
    },
    injectHandover: (id: string) => {
      failure.mode = "handover"
      failure.handoverWorkspaceID = id
    },
    clearInjectedFailure: () => {
      failure = { mode: "none" }
    },
    deleteCurrentWorkspace: () => {
      currentWorkspaceID = undefined
    },
    resetCurrentWorkspace: () => {
      currentWorkspaceID = workspaceID
      workspaceEpochCounter += 1
      currentModel = model
      currentCoderModel = null
      currentOperatingAgent = null
      workspaceRevision = 1
    },
    workspaceSnapshot: () => ({
      workspaceID: currentWorkspaceID,
      model: currentModel,
      coderModel: currentCoderModel,
      operatingAgent: currentOperatingAgent,
      layoutBlocks: clone(layoutBlocks),
      failure,
      revision: workspaceRevision,
      epoch: workspaceEpochCounter,
    }),
    reset() {
      listCalls.length = 0
      getCalls.length = 0
      createCalls.length = 0
      updateCalls.length = 0
      workspacePatches.length = 0
      savedLayouts.length = 0
      layoutGets = 0
      layoutRevision = 1
      workspaceRevision = 1
      listGets = 0
      getCallsCount = 0
      layoutBlocks.length = 0
      layoutBlocks.push(...clone(initialBlocks))
      currentWorkspaceID = workspaceID
      currentModel = model
      currentCoderModel = null
      currentOperatingAgent = null
      failure = { mode: "none" }
      workspacePatches.length = 0
      ;(workspacePatches as WorkspacePatch[]).length = 0
      ;(savedLayouts as BlockLayout[][]).length = 0
    },
  }

  return createFakeWorkspaceState
}
