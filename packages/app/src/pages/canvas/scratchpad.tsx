import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, For, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DEFAULT_CTXPACK_TITLE_CODEPOINTS,
  MAX_CTXPACK_AGGREGATE_TOKENS,
  type CtxPackCreateRequestLocal,
  type CtxPackInfoLocal,
} from "@/context/ctxpack/create-dialog"
import { useCtxPackDraft } from "@/context/ctxpack/draft"
import { suggestCtxPackKeywords } from "@/context/ctxpack/keyword-suggest"
import { captureCtxPackResponse } from "@/context/ctxpack/selection"
import { useLanguage } from "@/context/language"
import { ResponseSaveActions } from "@/pages/session/timeline/response-save-actions"
import { showToast } from "@/utils/toast"
import { useBlockRuntimeHandle } from "./runtime/block-runtime-host"
import type { RuntimeBlockHandle } from "./runtime/contracts"
import type { NotesCommand, NotesMessage, NotesView } from "./runtime/registrations/static-blocks"

export function ScratchpadBody(props: {
  blockID: string
  workspaceID: Accessor<string | undefined>
  workspaceEpoch: Accessor<number>
  create(request: CtxPackCreateRequestLocal): Promise<CtxPackInfoLocal>
}) {
  const language = useLanguage()
  const draft = useCtxPackDraft()
  const handle = useBlockRuntimeHandle() as RuntimeBlockHandle<NotesView, NotesCommand> | undefined
  const identity = () => JSON.stringify([props.workspaceID(), props.workspaceEpoch(), props.blockID])
  const view = () => {
    const current = handle?.view()
    if (
      !current ||
      current.workspaceID !== props.workspaceID() ||
      current.workspaceEpoch !== props.workspaceEpoch() ||
      current.blockID !== props.blockID
    )
      return
    return current
  }
  const initial = view()
  const [state, setState] = createStore({
    draft: initial?.draft ?? "",
    loaded: initial !== undefined,
    submitting: false,
  })
  const messages = () => view()?.messages ?? []
  let owner = identity()
  let pendingDraft: string | undefined
  let root: HTMLDivElement | undefined
  let transcript: HTMLDivElement | undefined
  let composer: HTMLTextAreaElement | undefined
  let submitButton: HTMLButtonElement | undefined

  createEffect(() => {
    const next = identity()
    if (next === owner) return
    owner = next
    pendingDraft = undefined
    setState({ draft: "", loaded: false, submitting: false })
  })

  createEffect(() => {
    const value = view()?.draft
    if (value === undefined || state.loaded) return
    setState({ draft: value, loaded: true })
  })

  createEffect(() => {
    if (handle?.status() !== "ready" || pendingDraft === undefined) return
    const text = pendingDraft
    const current = identity()
    pendingDraft = undefined
    void handle.dispatch({ type: "set-draft", text }).catch(() => {
      if (identity() === current && state.draft === text) pendingDraft = text
    })
  })

  createEffect(() => {
    if (messages().length === 0) return
    queueMicrotask(() => {
      if (transcript) transcript.scrollTop = transcript.scrollHeight
    })
  })

  const setDraft = (value: string) => {
    setState({ draft: value, loaded: true })
    if (!handle) return
    if (handle.status() !== "ready") {
      pendingDraft = value
      return
    }
    const current = identity()
    pendingDraft = undefined
    void handle.dispatch({ type: "set-draft", text: value }).catch(() => {
      if (identity() === current && state.draft === value) pendingDraft = value
    })
  }

  const submit = async () => {
    const text = state.draft
    if (!text.trim() || state.submitting || !handle || !view()) return
    const current = identity()
    const restoreFocus = document.activeElement === composer || document.activeElement === submitButton
    pendingDraft = undefined
    setState("submitting", true)
    await (handle.status() === "ready" ? Promise.resolve() : handle.refresh("scratchpad-submit"))
      .then(() => handle.dispatch({ type: "set-draft", text }))
      .then(() => handle.dispatch({ type: "submit", id: crypto.randomUUID(), createdAt: Date.now() }))
      .then(
        () => {
          if (identity() !== current) return
          if (state.draft === text) setState("draft", "")
        },
        () => {
          if (identity() === current) showToast(language.t("canvas.scratchpad.submitFailed"))
        },
      )
      .finally(() => {
        if (identity() !== current) return
        setState("submitting", false)
        if (!restoreFocus) return
        queueMicrotask(() => {
          if (identity() !== current || !composer?.isConnected) return
          const active = document.activeElement
          if (active !== document.body && active !== composer && active !== submitButton) return
          composer.focus()
        })
      })
  }

  const copy = (message: NotesMessage) => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(message.text))
      .then(
        () => showToast(language.t("canvas.scratchpad.copied")),
        () => showToast(language.t("canvas.scratchpad.copyFailed")),
      )
  }

  const save = async (message: NotesMessage, options: { details: boolean }) => {
    const workspaceID = props.workspaceID()
    const currentView = view()
    if (!root || !workspaceID || !currentView?.messages.some((item) => item.id === message.id)) return
    const captured = captureCtxPackResponse({
      element: root,
      text: message.text,
      direction: "sent",
      messageID: message.id,
      timestamp: message.createdAt,
      now: Date.now(),
    })
    if (
      !captured ||
      captured.source.workspaceID !== workspaceID ||
      captured.source.blockID !== props.blockID ||
      captured.source.functionalityID !== "builtin:notes" ||
      draft.workspaceID() !== workspaceID
    ) {
      showToast(language.t("canvas.ctxpack.captureFailed"))
      return
    }
    if (options.details) {
      draft.add(captured)
      draft.openCreate()
      return
    }
    if (Math.ceil(new TextEncoder().encode(captured.text).byteLength / 4) > MAX_CTXPACK_AGGREGATE_TOKENS) {
      showToast(language.t("canvas.ctxpack.captureFailed"))
      return
    }
    const epoch = props.workspaceEpoch()
    const currentIdentity = identity()
    const title = Array.from(captured.text.split("\n")[0]).slice(0, DEFAULT_CTXPACK_TITLE_CODEPOINTS).join("")
    const current = () =>
      root?.isConnected &&
      identity() === currentIdentity &&
      props.workspaceID() === workspaceID &&
      props.workspaceEpoch() === epoch &&
      draft.workspaceID() === workspaceID
    await props
      .create({
        workspaceID,
        title,
        keywords: suggestCtxPackKeywords({ title, fragments: [captured] }).filter(
          (keyword) => Array.from(keyword.normalize("NFKC")).length <= 48,
        ),
        sensitivity: captured.source.sensitivity,
        fragments: [captured],
        idempotencyKey: crypto.randomUUID(),
      })
      .then(
        () => {
          if (current()) showToast(language.t("canvas.ctxpack.saved"))
        },
        () => {
          if (current()) showToast(language.t("canvas.ctxpack.saveFailed"))
        },
      )
  }

  return (
    <div ref={(element) => (root = element)} class="canvas-relay-layout canvas-scratchpad">
      <div
        ref={(element) => (transcript = element)}
        class="canvas-relay-transcript"
        role="log"
        aria-label={language.t("canvas.scratchpad.messages")}
        onPointerDown={(event) => {
          if (event.button === 0) event.stopPropagation()
        }}
      >
        <Show
          when={messages().length > 0}
          fallback={<div class="canvas-relay-empty">{language.t("canvas.scratchpad.empty")}</div>}
        >
          <For each={messages()}>
            {(message) => (
              <article class="canvas-relay-message user" data-scratchpad-message={message.id}>
                <div class="canvas-relay-message-text" data-scratchpad-message-text>
                  {message.text}
                </div>
                <div class="canvas-relay-message-actions">
                  <TooltipV2 value={language.t("canvas.scratchpad.copy")} placement="top" gutter={4}>
                    <IconButtonV2
                      icon={<Icon name="outline-copy" size="small" />}
                      size="normal"
                      variant="ghost-muted"
                      aria-label={language.t("canvas.scratchpad.copy")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => copy(message)}
                    />
                  </TooltipV2>
                  <ResponseSaveActions onSave={(options) => save(message, options)} />
                </div>
              </article>
            )}
          </For>
        </Show>
      </div>
      <form
        class="canvas-relay-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          ref={(element) => (composer = element)}
          class="canvas-notes-area"
          aria-label={language.t("canvas.scratchpad.input")}
          placeholder={language.t("canvas.scratchpad.placeholder")}
          value={state.draft}
          disabled={state.submitting || view() === undefined}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
            event.preventDefault()
            void submit()
          }}
        />
        <button
          ref={(element) => (submitButton = element)}
          class="canvas-relay-init-button"
          type="submit"
          data-action="scratchpad-submit"
          disabled={state.submitting || !state.draft.trim() || view() === undefined}
        >
          {language.t("canvas.scratchpad.add")}
        </button>
      </form>
    </div>
  )
}
