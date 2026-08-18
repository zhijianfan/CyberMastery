/** @jsxImportSource solid-js */
// Track B3 — MasterAgent block composition. Composes the manager API
// (spec 02 §12), the B1 shell, B2 Coder selector, Q1 queue options, and the
// U3 canvas session surface into the single `builtin:master-agent` block
// renderer consumed by I2.
//
// Authority: the host functionality instance owns the authoritative Session
// binding; this component only reads it through `manager.masterAgent` and
// renders it. No session is created, deleted, or cancelled here, and no
// prompt is submitted from this file — the embedded surface reuses the
// existing Session composer, whose queue action admits queued inputs to the
// host through the existing admission path. Nothing session-identifying
// reaches layout serialization or local persistence.

import { onCleanup, onMount, Show } from "solid-js"
import type { BindingState, ModelSelection } from "./types"
import type { MasterAgentManagerApi as CanvasManagerApi } from "../manager"
import type { CoderController } from "./coder-controller"
import { MasterAgentBlockShell } from "./block-shell"
import { CoderSelector, type CoderTaskPermission } from "./coder-selector"
import { createMasterAgentSessionOptions } from "./session-options"
import { CanvasSessionSurface } from "../session-surface"

// The block consumes a narrow view of the manager's published `masterAgent`
// API (M6, spec 02 §12): per-block binding state/actions plus the Coder
// view-model. These aliases derive from the real types, so the contract is
// enforced at the type level — if the manager API drifts, this file stops
// compiling. The block never imports the manager module at runtime; the
// canvas host passes the surface in through props.

export type MasterAgentCoderViewModel = Pick<
  CoderController<ModelSelection>,
  "model" | "pending" | "error" | "set" | "clear" | "retry"
>

export type MasterAgentManagerApi = Pick<
  CanvasManagerApi,
  "state" | "ensure" | "retry" | "reset" | "removeLocalProjection"
> & { coder: MasterAgentCoderViewModel }

export interface MasterAgentBlockProps {
  /** Canvas block identity; also derives the per-surface scope id. */
  blockID: string
  focused: boolean
  manager: MasterAgentManagerApi
  onFocus(): void
  onRequestOpenFullPage?(): void
  /** Workspace-wide Coder chrome inputs (I2 wires these from the canvas). */
  primaryModel?: ModelSelection | null
  taskPermission?: CoderTaskPermission
  models?: readonly ModelSelection[]
  toolCompatible?: boolean
  onOpenCoderPicker?(): void
  /** Host session working state; gates the Q1 queue action and reset. */
  sessionBusy?: () => boolean
}

const RESET_DISABLED_REASON: Record<Exclude<BindingState["status"], "ready">, string> = {
  uninitialized: "Session not initialized",
  loading: "Session is connecting",
  "permission-denied": "Permission denied",
  unavailable: "Session unavailable",
  error: "Something went wrong",
}

export function MasterAgentBlock(props: MasterAgentBlockProps) {
  const state = props.manager.state(props.blockID)
  // Stable per-block surface identity so two blocks never share DOM ids,
  // portals, terminal mounts, or composer/tab state.
  const busy = props.sessionBusy ?? (() => false)

  onMount(() => {
    void props.manager.ensure(props.blockID)
  })

  onCleanup(() => {
    // Removal/unmount must not delete or cancel the host session: only the
    // local projection is dropped; the host keeps the Session and its queue.
    props.manager.removeLocalProjection(props.blockID)
  })

  const binding = () => {
    const current = state()
    if (current.status !== "ready") return undefined
    return current.binding
  }

  const sessionOptions = () => {
    const current = binding()
    if (!current) return undefined
    return createMasterAgentSessionOptions({
      sessionID: current.sessionID,
      directory: current.directory,
      workspaceID: current.workspaceID,
    })
  }

  // Q1: the embedded composer owns prompt admission. The options only enable
  // its existing queue action while the host session is busy; no prompt is
  // submitted from the block and no client-side queue exists.
  const queueEnabled = () => {
    const options = sessionOptions()
    if (!options) return false
    return options.queueEnabled && options.queue(busy())
  }

  const canReset = () => {
    const current = state()
    if (current.status !== "ready") return false
    return !busy()
  }

  const resetDisabledReason = () => {
    const current = state()
    if (current.status === "ready") {
      if (!busy()) return undefined
      return "Session is busy — reset when idle"
    }
    return RESET_DISABLED_REASON[current.status]
  }

  return (
    <MasterAgentBlockShell
      status={state().status}
      focused={props.focused}
      canReset={canReset()}
      resetDisabledReason={resetDisabledReason()}
      onFocus={props.onFocus}
      onRetry={() => void props.manager.retry(props.blockID)}
      onReset={() => void props.manager.reset(props.blockID)}
      onOpenFullPage={props.onRequestOpenFullPage}
      sessionSlot={
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurface
              target={options().target}
              surfaceID={`master-agent-${props.blockID}`}
              focused={props.focused}
              queueEnabled={queueEnabled()}
              onFocus={props.onFocus}
              onRequestOpenFullPage={props.onRequestOpenFullPage}
            />
          )}
        </Show>
      }
      coderSlot={
        <CoderSelector
          model={props.manager.coder.model()}
          primaryModel={props.primaryModel ?? null}
          pending={props.manager.coder.pending()}
          error={props.manager.coder.error()}
          permission={props.taskPermission ?? "allow"}
          toolCompatible={props.toolCompatible ?? true}
          models={props.models}
          onSet={(model) => void props.manager.coder.set(model)}
          onClear={() => void props.manager.coder.clear()}
          onRetry={() => void props.manager.coder.retry()}
          onOpenPicker={props.onOpenCoderPicker ?? (() => {})}
        />
      }
    />
  )
}
