export interface HostBindingRecord {
  workspaceID: string
  blockID: string
  functionalityInstanceID: string
  sessionID: string
  generation: number
  revision: number
  directory: string
}

export interface HostBindingCall {
  workspaceID: string
  blockID: string
}

export interface HostBindingResetCall extends HostBindingCall {
  expectedSessionID: string
  expectedRevision: number
}

type PortResponse =
  | { status: "bound"; binding: HostBindingRecord }
  | { status: "busy"; reason: string }
  | { status: "stale" }

type ResetResponse =
  | { status: "reset"; binding: HostBindingRecord }
  | { status: "busy"; reason: string }
  | { status: "stale" }

export interface FakeHostBindingPort {
  get: (parameters: { workspaceID: string; blockID: string }) => Promise<{ data: { status: "bound"; binding: HostBindingRecord } | { status: "busy"; reason: string } }>
  ensure: (parameters: { workspaceID: string; blockID: string }) => Promise<{ data: PortResponse }>
  reset: (parameters: {
    workspaceID: string
    blockID: string
    masterAgentResetPayload: { expectedSessionID: string; expectedRevision: number }
  }) => Promise<{ data: ResetResponse }>
  release: (parameters: { blockID: string }) => void
  getBinding: (blockID: string) => HostBindingRecord | undefined
  setBusy: (value: boolean, reason?: string) => void
  setDisconnected: (value: boolean) => void
  setRevision: (parameters: { blockID: string; revision: number }) => void
  ensureCalls: string[]
  getCalls: string[]
  resetCalls: HostBindingResetCall[]
  busyReason: () => string | undefined
  isDisconnected: () => boolean
  clear: () => void
}

export function createFakeHostBindingPort(parameters: { workspaceID: string; directory: string }) {
  const { workspaceID } = parameters
  const directory = parameters.directory

  const bindings = new Map<string, HostBindingRecord>()
  const ensureCalls: string[] = []
  const getCalls: string[] = []
  const resetCalls: HostBindingResetCall[] = []

  const busy: { active: boolean; reason?: string } = { active: false }
  const disconnected = { active: false }

  function bindingFor(blockID: string) {
    const existing = bindings.get(blockID)
    if (existing) return existing
    const record: HostBindingRecord = {
      workspaceID,
      blockID,
      functionalityInstanceID: `fi-${blockID}`,
      sessionID: `sess-${blockID}-1`,
      generation: 1,
      revision: 1,
      directory,
    }
    bindings.set(blockID, record)
    return record
  }

  function maybeNotAvailable() {
    if (disconnected.active) return { status: "busy" as const, reason: "disconnected" } as const
    if (busy.active) return { status: "busy" as const, reason: busy.reason ?? "busy" }
    return undefined
  }

  const port: FakeHostBindingPort = {
    async get(params) {
      const unavailable = maybeNotAvailable()
      getCalls.push(params.blockID)
      if (unavailable) {
        return { data: unavailable }
      }
      return { data: { status: "bound" as const, binding: bindingFor(params.blockID) } }
    },

    async ensure(params) {
      const unavailable = maybeNotAvailable()
      ensureCalls.push(params.blockID)
      if (unavailable) {
        return { data: unavailable }
      }
      return { data: { status: "bound" as const, binding: bindingFor(params.blockID) } }
    },

    async reset(params) {
      const unavailable = maybeNotAvailable()
      resetCalls.push({
        workspaceID: params.workspaceID,
        blockID: params.blockID,
        expectedSessionID: params.masterAgentResetPayload.expectedSessionID,
        expectedRevision: params.masterAgentResetPayload.expectedRevision,
      })

      if (unavailable) {
        return { data: { status: "busy", reason: unavailable.reason } }
      }

      const current = bindings.get(params.blockID)
      if (!current || current.sessionID !== params.masterAgentResetPayload.expectedSessionID) {
        return { data: { status: "stale" as const } }
      }
      if (current.revision !== params.masterAgentResetPayload.expectedRevision) {
        return { data: { status: "stale" as const } }
      }
      const next = {
        ...current,
        generation: current.generation + 1,
        revision: current.revision + 1,
        sessionID: `sess-${params.blockID}-${current.generation + 1}`,
      }
      bindings.set(params.blockID, next)
      return { data: { status: "reset" as const, binding: next } }
    },

    release(params) {
      bindings.delete(params.blockID)
    },

    getBinding(blockID) {
      return bindings.get(blockID)
    },

    setBusy(value, reason) {
      busy.active = value
      busy.reason = reason
    },

    setDisconnected(value) {
      disconnected.active = value
    },

    setRevision(params) {
      const existing = bindingFor(params.blockID)
      bindings.set(params.blockID, { ...existing, revision: params.revision })
    },

    busyReason() {
      return busy.reason
    },

    isDisconnected() {
      return disconnected.active
    },

    ensureCalls,
    getCalls,
    resetCalls,

    clear() {
      bindings.clear()
      ensureCalls.length = 0
      getCalls.length = 0
      resetCalls.length = 0
      busy.active = false
      busy.reason = undefined
      disconnected.active = false
      for (const blockID of [] as string[]) {
      }
    },
  }

  return port
}
