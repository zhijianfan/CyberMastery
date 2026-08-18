/** @jsxImportSource solid-js */
import "./coder-selector.css"
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { ModelSelection } from "./types"

export type CoderTaskPermission = "allow" | "deny" | "ask" | "default"

// Recognizable error shapes produced by the manager-owned Coder controller.
// The selector duck-types these from the `error` view-model field instead of
// importing the controller so it stays a pure presentational component.
export type CoderSelectorError =
  | { type: "permission-denied" }
  | { type: "model-unavailable"; model: ModelSelection }
  | { type: "no-workspace" }
  | { type: "patch-failed"; cause: unknown }

export interface CoderSelectorProps {
  model: ModelSelection | null
  primaryModel: ModelSelection | null
  pending: boolean
  error: unknown | null
  permission: CoderTaskPermission
  toolCompatible?: boolean
  models?: readonly ModelSelection[]
  pickerOpen?: boolean
  onPickerOpenChange?(open: boolean): void
  onSet(model: ModelSelection): void
  onClear(): void
  onRetry(): void
  onOpenPicker(): void
}

const ERROR_TYPES = ["permission-denied", "model-unavailable", "no-workspace", "patch-failed"] as const

type ParsedError = CoderSelectorError | { type: "unknown" }

export function CoderSelector(props: CoderSelectorProps) {
  const [localOpen, setLocalOpen] = createSignal(false)
  let triggerRef: HTMLButtonElement | undefined
  let panelRef: HTMLDivElement | undefined

  const denied = () => props.permission === "deny"
  const toolCompatible = () => props.toolCompatible ?? true
  const candidates = () => props.models ?? []
  const sameAsPrimary = () => matchesModel(props.model, props.primaryModel)
  const actionsDisabled = () => props.pending || denied()

  const pickerOpen = () => props.pickerOpen ?? localOpen()
  const setPickerOpen = (open: boolean) => {
    if (props.pickerOpen !== undefined) props.onPickerOpenChange?.(open)
    else setLocalOpen(open)
  }

  const error = (): ParsedError | null => {
    if (props.pending || props.error === null) return null
    if (isCoderSelectorError(props.error)) return props.error
    return { type: "unknown" }
  }

  const state = (): "pending" | "denied" | "unavailable" | "error" | "selected" | "disabled" => {
    if (props.pending) return "pending"
    const parsed = error()
    if (parsed?.type === "permission-denied") return "denied"
    if (parsed?.type === "model-unavailable") return "unavailable"
    if (parsed) return "error"
    if (denied()) return "denied"
    if (props.model) return "selected"
    return "disabled"
  }

  const togglePicker = () => {
    if (candidates().length === 0) {
      props.onOpenPicker()
      return
    }
    setPickerOpen(!pickerOpen())
  }

  const choose = (model: ModelSelection) => {
    setPickerOpen(false)
    props.onSet(model)
  }

  const openFullPicker = () => {
    setPickerOpen(false)
    props.onOpenPicker()
  }

  const onPanelKeyDown = (event: KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    if (event.key === "Escape") {
      event.preventDefault()
      setPickerOpen(false)
      triggerRef?.focus()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      moveOptionFocus(target, event.key)
    }
  }

  // Enter/Space activation and arrow-key roving are handled explicitly instead
  // of relying on native button click synthesis so a keystroke activates a
  // candidate exactly once.
  const onOptionKeyDown = (event: KeyboardEvent, model: ModelSelection) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    choose(model)
  }

  function moveOptionFocus(current: HTMLButtonElement, key: string) {
    const panel = panelRef
    if (!panel) return
    const options = [...panel.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    if (options.length === 0) return
    const index = options.indexOf(current)
    if (index < 0) return
    let next = index
    if (key === "ArrowDown") next = (index + 1) % options.length
    if (key === "ArrowUp") next = (index - 1 + options.length) % options.length
    if (key === "Home") next = 0
    if (key === "End") next = options.length - 1
    options[next].focus()
  }

  const panelDismiss = (event: PointerEvent) => {
    if (!pickerOpen()) return
    const target = event.target
    if (target instanceof HTMLElement && target.closest(".master-agent-coder")) return
    setPickerOpen(false)
  }

  const removeDismiss = registerWindowDismiss(panelDismiss)
  onCleanup(removeDismiss)

  return (
    <div
      class="master-agent-coder"
      classList={{ "is-denied": denied() }}
      data-state={state()}
      role="group"
      aria-label="Workspace Coder"
    >
      <div class="master-agent-coder-head">
        <span class="master-agent-coder-label">Workspace Coder</span>
        <span class="master-agent-coder-scope" title="Applies to every MasterAgent block in this workspace">
          Workspace-wide
        </span>
      </div>

      <Show when={error()}>
        {(parsed) => (
          <ErrorBanner error={parsed()} onRetry={props.onRetry} onOpenPicker={openFullPicker} />
        )}
      </Show>
      <Show when={error() === null && denied()}>
        <div class="master-agent-coder-error is-denied" role="alert" data-error="permission-denied">
          {DENIAL_MESSAGE}
        </div>
      </Show>

      <Show when={error() === null && !denied()}>
        <div class="master-agent-coder-controls">
          <Show
            when={props.model}
            fallback={
              <div class="master-agent-coder-status" role="status">
                <span class="master-agent-coder-status-text">
                  Disabled — no Coder model selected. The primary model is not used for Coder tasks.
                </span>
              </div>
            }
          >
            {(model) => (
              <span class="master-agent-coder-current" title={modelLabel(model())}>
                {modelLabel(model())}
              </span>
            )}
          </Show>
          <button
            ref={(element) => (triggerRef = element)}
            type="button"
            class="master-agent-coder-button"
            classList={{ "is-open": pickerOpen() }}
            aria-haspopup={candidates().length > 0 ? "listbox" : undefined}
            aria-expanded={candidates().length > 0 ? pickerOpen() : undefined}
            disabled={actionsDisabled()}
            onClick={togglePicker}
          >
            {props.model ? "Change model" : "Choose model"}
          </button>
          <Show when={props.model !== null}>
            <button
              type="button"
              class="master-agent-coder-button"
              aria-label="Clear Coder model"
              disabled={actionsDisabled()}
              onClick={() => props.onClear()}
            >
              Clear
            </button>
          </Show>
          <Show when={props.pending}>
            <span class="master-agent-coder-pending" role="status">
              Saving Coder model…
            </span>
          </Show>
        </div>

        <Show when={props.model !== null && !props.pending}>
          <Show when={sameAsPrimary()}>
            <div class="master-agent-coder-warning" data-warning="same-as-primary">
              Same model as the workspace primary — Coder tasks will run on the primary model.
            </div>
          </Show>
          <Show when={!toolCompatible()}>
            <div class="master-agent-coder-warning" data-warning="tool-incompatible">
              This model has known tool-call limitations — Coder tasks may not run reliably.
            </div>
          </Show>
        </Show>

        <Show when={candidates().length > 0 && !props.pending && !denied()}>
          <Show when={pickerOpen()}>
            <div
              ref={(element) => (panelRef = element)}
              class="master-agent-coder-picker"
              role="listbox"
              aria-label="Choose a Coder model"
              onKeyDown={onPanelKeyDown}
            >
              <For each={candidates()}>
                {(candidate) => (
                  <button
                    type="button"
                    class="master-agent-coder-option"
                    classList={{ "is-current": matchesModel(candidate, props.model) }}
                    role="option"
                    aria-selected={matchesModel(candidate, props.model)}
                    title={modelLabel(candidate)}
                    onClick={() => choose(candidate)}
                    onKeyDown={(event) => onOptionKeyDown(event, candidate)}
                  >
                    {modelLabel(candidate)}
                  </button>
                )}
              </For>
              <button type="button" class="master-agent-coder-option is-more" onClick={openFullPicker}>
                More models…
              </button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

const DENIAL_MESSAGE =
  "Task permission denied — the project config denies agent execution (task), so the Workspace Coder cannot be changed."

function ErrorBanner(props: { error: ParsedError; onRetry(): void; onOpenPicker(): void }) {
  return (
    <div class="master-agent-coder-error" role="alert" data-error={props.error.type}>
      <span class="master-agent-coder-error-text">{errorMessage(props.error)}</span>
      <Show when={props.error.type !== "permission-denied"}>
        <button type="button" class="master-agent-coder-button" onClick={props.onRetry}>
          Retry
        </button>
      </Show>
      <Show when={props.error.type === "model-unavailable"}>
        <button type="button" class="master-agent-coder-button" onClick={props.onOpenPicker}>
          Choose model
        </button>
      </Show>
    </div>
  )
}

function errorMessage(error: ParsedError): string {
  switch (error.type) {
    case "permission-denied":
      return DENIAL_MESSAGE
    case "model-unavailable":
      return `${modelLabel(error.model)} is not available in this workspace. No model was applied — Coder tasks stay disabled.`
    case "no-workspace":
      return "No workspace is open — open a project to configure the Workspace Coder."
    case "patch-failed":
      if (typeof error.cause === "string" && error.cause.length > 0)
        return `Couldn't save the Workspace Coder model. ${error.cause}`
      return "Couldn't save the Workspace Coder model."
    case "unknown":
      return "Couldn't save the Workspace Coder model."
  }
}

function isCoderSelectorError(error: unknown): error is CoderSelectorError {
  if (typeof error !== "object" || error === null) return false
  if (!("type" in error) || typeof error.type !== "string") return false
  return (ERROR_TYPES as readonly string[]).includes(error.type)
}

function matchesModel(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (a === null || b === null) return false
  return a.providerID === b.providerID && a.modelID === b.modelID
}

function modelLabel(model: ModelSelection): string {
  return `${model.providerID}/${model.modelID}${model.variant ? ` (${model.variant})` : ""}`
}

function registerWindowDismiss(onDismiss: (event: PointerEvent) => void): () => void {
  window.addEventListener("pointerdown", onDismiss)
  return () => window.removeEventListener("pointerdown", onDismiss)
}

export type { ModelSelection }
