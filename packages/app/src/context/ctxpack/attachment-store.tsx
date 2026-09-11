import {
  createComponent,
  createComputed,
  createContext,
  createMemo,
  createSignal,
  getOwner,
  on,
  onCleanup,
  useContext,
} from "solid-js"
import type { Accessor, JSX } from "solid-js"
import type { CtxPackDragPayloadV1 } from "./drag"

export interface ContextAttachmentDraft {
  clientAttachmentID: string
  kind: "context-capsule"
  contextCapsuleID: string
  source: {
    kind: "ctxpack"
    ctxPackID: string
    contentHash: string
  }
  label: string
  tags?: readonly "ParallelPlan"[]
  contentHash: string
  estimatedTokens: number
  status: "ready" | "error"
  errorCode: string | null
}

export interface SessionContextAttachmentInput {
  contextCapsuleID: string
  label: string
  contentHash: string
  source: { kind: "ctxpack"; ctxPackID: string }
}

export function toSessionContextAttachmentInput(attachment: ContextAttachmentDraft): SessionContextAttachmentInput {
  return {
    contextCapsuleID: attachment.contextCapsuleID,
    label: attachment.label,
    contentHash: attachment.contentHash,
    source: { kind: "ctxpack", ctxPackID: attachment.source.ctxPackID },
  }
}

export interface ContextAttachmentStore {
  attachments(): readonly ContextAttachmentDraft[]
  addCtxPack(payload: CtxPackDragPayloadV1, target: { instanceID: string; functionalityID: string }): Promise<void>
  remove(clientAttachmentID: string): void
  clearAfterAdmission(snapshot?: readonly ContextAttachmentDraft[]): void
  restoreAfterFailure(snapshot: readonly ContextAttachmentDraft[]): void
  totalEstimatedTokens(): number
  pendingCount(): number
}

export const MAX_CONTEXT_ATTACHMENTS = 8
export const MAX_CONTEXT_ATTACHMENT_TOKENS = 6_000

export interface ContextCapsuleMaterializeInput {
  workspaceID: string
  ctxPackID: string
  expectedContentHash: string
  targetInstanceID: string
  targetFunctionalityID: string
}

export interface ContextCapsuleMaterializeResult {
  contextCapsuleID: string
  sourceCtxPackID: string
  label: string
  tags?: readonly "ParallelPlan"[]
  contentHash: string
  estimatedTokens: number
}

export type ContextCapsuleMaterialize = (
  input: ContextCapsuleMaterializeInput,
) => Promise<ContextCapsuleMaterializeResult>

const STABLE_ERROR_CODES = new Set([
  "cross-workspace",
  "attachment-limit",
  "token-limit",
  "materialize-failed",
  "offline",
])

function stableError(code: string): Error {
  const error = new Error(code)
  ;(error as Error & { code?: string }).code = code
  return error
}

interface PendingCtxPackAttachment {
  clientAttachmentID: string
  payload: CtxPackDragPayloadV1
  target: { instanceID: string; functionalityID: string }
}

function randomClientAttachmentID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `client-attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function pendingPayloadKey(payload: CtxPackDragPayloadV1): string {
  return `${payload.ctxPackID}::${payload.contentHash}`
}

export function createContextAttachmentStore(
  workspaceID: Accessor<string | undefined>,
  materialize: ContextCapsuleMaterialize,
  scopeKey?: Accessor<string>,
): ContextAttachmentStore {
  const [items, setItems] = createSignal<ContextAttachmentDraft[]>([])
  const [pending, setPending] = createSignal<PendingCtxPackAttachment[]>([])
  const inFlight = new Map<string, Promise<void>>()
  let epoch = 0
  const issued = new WeakMap<ContextAttachmentDraft, number>()
  const removed = new WeakSet<ContextAttachmentDraft>()

  const reset = () => {
    epoch += 1
    setItems([])
    setPending([])
    inFlight.clear()
  }
  const identity = createMemo(() => JSON.stringify([workspaceID(), scopeKey?.()]))
  createComputed(on(identity, reset))
  if (getOwner()) onCleanup(reset)

  const committedCount = () => items().length + pending().length
  const committedEstimatedTokens = () =>
    items().reduce((sum, item) => sum + item.estimatedTokens, 0) +
    pending().reduce((sum, entry) => sum + entry.payload.estimatedTokens, 0)

  async function addCtxPack(
    payload: CtxPackDragPayloadV1,
    target: { instanceID: string; functionalityID: string },
  ): Promise<void> {
    const workspace = workspaceID()
    if (workspace === undefined || payload.workspaceID !== workspace) {
      throw stableError("cross-workspace")
    }
    const duplicate = items().find(
      (item) =>
        item.source.kind === "ctxpack" &&
        item.source.ctxPackID === payload.ctxPackID &&
        item.source.contentHash === payload.contentHash,
    )
    if (duplicate !== undefined) return

    const key = pendingPayloadKey(payload)
    const existing = inFlight.get(key)
    if (existing !== undefined) return existing

    if (committedCount() >= MAX_CONTEXT_ATTACHMENTS) {
      throw stableError("attachment-limit")
    }
    if (committedEstimatedTokens() + payload.estimatedTokens > MAX_CONTEXT_ATTACHMENT_TOKENS) {
      throw stableError("token-limit")
    }

    const clientAttachmentID = randomClientAttachmentID()
    const capturedEpoch = epoch
    setPending((current) => [...current, { clientAttachmentID, payload, target }])

    const operation = (async () => {
      try {
        const result = await materialize({
          workspaceID: workspace,
          ctxPackID: payload.ctxPackID,
          expectedContentHash: payload.contentHash,
          targetInstanceID: target.instanceID,
          targetFunctionalityID: target.functionalityID,
        })
        if (capturedEpoch !== epoch) return
        const draft: ContextAttachmentDraft = {
          clientAttachmentID,
          kind: "context-capsule",
          contextCapsuleID: result.contextCapsuleID,
          source: {
            kind: "ctxpack",
            ctxPackID: payload.ctxPackID,
            contentHash: payload.contentHash,
          },
          label: result.label,
          ...(result.tags?.length ? { tags: result.tags } : {}),
          contentHash: result.contentHash,
          estimatedTokens: result.estimatedTokens,
          status: "ready",
          errorCode: null,
        }
        issued.set(draft, epoch)
        setItems((current) => [...current, draft])
      } catch (error) {
        const code =
          error instanceof Error && STABLE_ERROR_CODES.has(error.message) ? error.message : "materialize-failed"
        throw stableError(code)
      } finally {
        setPending((current) => current.filter((entry) => entry.clientAttachmentID !== clientAttachmentID))
        if (capturedEpoch === epoch) inFlight.delete(key)
      }
    })()

    inFlight.set(key, operation)
    await operation
  }

  const store: ContextAttachmentStore = {
    attachments: items,
    addCtxPack,
    remove(clientAttachmentID) {
      const item = items().find((item) => item.clientAttachmentID === clientAttachmentID)
      if (item) removed.add(item)
      setItems((current) => current.filter((item) => item.clientAttachmentID !== clientAttachmentID))
    },
    clearAfterAdmission(snapshot = items()) {
      const admitted = new Set(snapshot.map((item) => item.clientAttachmentID))
      setItems((current) => current.filter((item) => !admitted.has(item.clientAttachmentID)))
    },
    restoreAfterFailure(snapshot) {
      const current = new Set(items().map((item) => item.clientAttachmentID))
      setItems((items) => [
        ...items,
        ...snapshot.filter(
          (item) => issued.get(item) === epoch && !removed.has(item) && !current.has(item.clientAttachmentID),
        ),
      ])
    },
    totalEstimatedTokens() {
      return items().reduce((sum, item) => sum + item.estimatedTokens, 0)
    },
    pendingCount() {
      return pending().length
    },
  }
  return store
}

const unavailableContextAttachmentStore: ContextAttachmentStore = {
  attachments: () => [],
  addCtxPack: async () => undefined,
  remove: () => undefined,
  clearAfterAdmission: () => undefined,
  restoreAfterFailure: () => undefined,
  totalEstimatedTokens: () => 0,
  pendingCount: () => 0,
}

export const ContextAttachmentStoreContext = createContext<ContextAttachmentStore | undefined>(undefined)

export function useContextAttachmentStoreOrNull(): ContextAttachmentStore | undefined {
  return useContext(ContextAttachmentStoreContext)
}

export function useContextAttachmentStore(): ContextAttachmentStore {
  const store = useContextAttachmentStoreOrNull()
  if (store === undefined) {
    throw new Error("useContextAttachmentStore: missing ContextAttachmentStoreProvider in the tree")
  }
  return store
}

export function useOptionalContextAttachmentStore(): ContextAttachmentStore {
  return useContextAttachmentStoreOrNull() ?? unavailableContextAttachmentStore
}

export interface ContextAttachmentStoreProviderProps {
  workspaceID: Accessor<string | undefined>
  materialize: ContextCapsuleMaterialize
  scopeKey?: Accessor<string>
  children: JSX.Element
}

/**
 * Provider component (no JSX syntax — see HANDOFF-U3.md; equivalent to
 * rendering `<ContextAttachmentStoreContext.Provider value={store}>`).
 */
export function ContextAttachmentStoreProvider(props: ContextAttachmentStoreProviderProps): JSX.Element {
  const store = createContextAttachmentStore(props.workspaceID, props.materialize, props.scopeKey)
  const provided = createComponent(ContextAttachmentStoreContext.Provider, {
    value: store,
    get children() {
      return props.children
    },
  })
  return (typeof provided === "function" ? (provided as () => unknown)() : provided) as JSX.Element
}
