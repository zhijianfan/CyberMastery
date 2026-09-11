// Track B3 — MasterAgent block composition. Composes the manager API
// (spec 02 §12), the B1 shell, Q1 queue options, and the
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

import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import type { BindingState } from "./types"
import type { MasterAgentManagerApi as CanvasManagerApi } from "../manager"
import { MasterAgentBlockShell } from "./block-shell"
import { createMasterAgentSessionOptions } from "./session-options"
import { CanvasSessionSurface } from "../session-surface"
import { CanvasSessionSurfaceProviders } from "../session-surface-providers"
import { useBlockRuntimeHandle } from "../runtime/block-runtime-host"
import type { MasterAgentCommand, MasterAgentView } from "./runtime-registration"
import type { RuntimeBlockHandle } from "../runtime/contracts"

// The block consumes a narrow view of the manager's published `masterAgent`
// API (M6, spec 02 §12): per-block binding state/actions. The alias derives
// from the real types, so the contract is
// enforced at the type level — if the manager API drifts, this file stops
// compiling. The block never imports the manager module at runtime; the
// canvas host passes the surface in through props.

export type MasterAgentManagerApi = Pick<
  CanvasManagerApi,
  "state" | "ensure" | "retry" | "reset" | "removeLocalProjection"
>

export interface MasterAgentBlockProps {
  /** Canvas block identity; also derives the per-surface scope id. */
  blockID: string
  focused: boolean
  manager: MasterAgentManagerApi
  onFocus(): void
  onRequestOpenFullPage?(): void
  modelVersion?: number
  beforeSubmit?: (runtime: RuntimeBlockHandle | undefined, sessionID: string) => Promise<void>
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
  const runtime = useBlockRuntimeHandle()
  const serverSync = useServerSync()
  const legacyState = runtime ? undefined : props.manager.state(props.blockID)
  // Stable per-block surface identity so two blocks never share DOM ids,
  // portals, terminal mounts, or composer/tab state.
  const busy =
    props.sessionBusy ??
    (() => {
      const target = sessionOptions()?.target
      return !!target && serverSync().session.data.session_working(target.sessionID)
    })
  let modelVersion = props.modelVersion

  createEffect(() => {
    const next = props.modelVersion
    if (next === modelVersion) return
    modelVersion = next
    if (runtime) {
      void runtime.refresh("workspace-model-changed")
      return
    }
    void props.manager.retry(props.blockID)
  })

  onMount(() => {
    if (!runtime) void props.manager.ensure(props.blockID)
  })

  onCleanup(() => {
    // Removal/unmount must not delete or cancel the host session: only the
    // local projection is dropped; the host keeps the Session and its queue.
    if (!runtime) props.manager.removeLocalProjection(props.blockID)
  })

  const runtimeView = () => runtime?.view() as MasterAgentView | undefined

  const status = createMemo(() => {
    if (!runtime) return legacyState!().status
    const current = runtime.status()
    if ((current === "ready" || current === "resolving" || current === "stale" || current === "error") && runtimeView())
      return "ready"
    if (current === "resolving" || current === "stale") return "loading"
    return current
  })

  const sessionOptions = () => {
    const current = runtimeView()
    if (runtime && current) {
      if (!current.sessionID) return
      return createMasterAgentSessionOptions({
        sessionID: current.sessionID,
        directory: current.directory,
        workspaceID: current.workspaceID,
      })
    }
    const legacy = legacyState!()
    if (legacy.status !== "ready") return
    return createMasterAgentSessionOptions({
      sessionID: legacy.binding.sessionID,
      directory: legacy.binding.directory,
      workspaceID: legacy.binding.workspaceID,
    })
  }

  // Q1: the embedded composer owns prompt admission. The options only enable
  // its existing queue action while the host session is busy; no prompt is
  // submitted from the block and no client-side queue exists.
  const queueEnabled = () => {
    const options = sessionOptions()
    if (!options) return false
    return (runtimeView()?.queueEnabled ?? options.queueEnabled) && options.queue(busy())
  }

  const canReset = () => {
    return status() === "ready" && !busy()
  }

  const resetDisabledReason = () => {
    const current = status()
    if (current === "ready") {
      if (!busy()) return undefined
      return "Session is busy — reset when idle"
    }
    return RESET_DISABLED_REASON[current]
  }

  const retry = () => {
    if (runtime) return runtime.refresh("retry")
    return props.manager.retry(props.blockID)
  }

  const reset = () => {
    if (runtime) return runtime.dispatch({ type: "reset" } satisfies MasterAgentCommand)
    return props.manager.reset(props.blockID)
  }

  return (
    <MasterAgentBlockShell
      status={status()}
      focused={props.focused}
      canReset={canReset()}
      resetDisabledReason={resetDisabledReason()}
      onFocus={props.onFocus}
      onRetry={() => void retry()}
      onReset={() => void reset()}
      onOpenFullPage={props.onRequestOpenFullPage}
      sessionSlot={
        <Show when={sessionOptions()}>
          {(options) => (
            <CanvasSessionSurfaceProviders
              directory={options().target.directory}
              sessionID={options().target.sessionID}
            >
              <CanvasSessionSurface
                role="master"
                target={options().target}
                surfaceID={`master-agent-${props.blockID}`}
                focused={props.focused}
                workspaceModels
                beforeSubmit={() => props.beforeSubmit?.(runtime, options().target.sessionID) ?? Promise.resolve()}
                queueEnabled={queueEnabled()}
                onFocus={props.onFocus}
                onRequestOpenFullPage={props.onRequestOpenFullPage}
              />
            </CanvasSessionSurfaceProviders>
          )}
        </Show>
      }
    />
  )
}
