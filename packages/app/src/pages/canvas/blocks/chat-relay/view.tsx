import { useLanguage } from "@/context/language"
import { createContextAttachmentStore, toSessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"
import { CtxPackAttachmentPreview } from "@/context/ctxpack/attachment-preview"
import { CtxPackDropTarget, useMessageContextTargetRegistry } from "@/context/ctxpack/drop-target"
import type { CtxPackDragPayloadV1 } from "@/context/ctxpack/drag"
import { useCtxPackDraft } from "@/context/ctxpack/draft"
import { suggestCtxPackKeywords } from "@/context/ctxpack/keyword-suggest"
import { captureCtxPackResponse } from "@/context/ctxpack/selection"
import { attachmentStoreMaterializeFacade, createCtxPackSdkFacade } from "@/context/ctxpack/sdk-facade"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useServerSDK } from "@/context/server-sdk"
import { ResponseSaveActions } from "@/pages/session/timeline/response-save-actions"
import { showToast } from "@/utils/toast"
import { uuid } from "@/utils/uuid"
import { createEffect, createMemo, createUniqueId, For, Index, type JSX, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useBlockRuntimeHandle } from "../../runtime/block-runtime-host"
import type { ChatRelayCommand, ChatRelayMessage, ChatRelayView } from "./runtime"
import { chatRelayError, type ChatRelayBodyProps } from "./types"

export const iconRelay = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
    <path d="M13 7h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-4" />
  </svg>
)

export const iconClose = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
)

export const iconSpin = (): JSX.Element => (
  <svg viewBox="0 0 24 24">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v6h-6" />
  </svg>
)

export function ChatRelayBody(props: ChatRelayBodyProps): JSX.Element {
  const language = useLanguage()
  const draft = useCtxPackDraft()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const targets = useMessageContextTargetRegistry()
  const targetID = createUniqueId()
  const handle = useBlockRuntimeHandle()
  const status = () => handle?.status() ?? "unavailable"
  const denied = () => status() === "permission-denied"
  const view = (): ChatRelayView | undefined => handle?.view() as ChatRelayView | undefined
  const workspaceID = createMemo(() => view()?.relay.workspaceID)
  const attachments = createContextAttachmentStore(workspaceID, attachmentStoreMaterializeFacade(serverSDK), () =>
    JSON.stringify([serverSDK().scope, props.block.id, view()?.relay.tabID]),
  )
  const runtimeError = () => {
    const error = handle?.error()
    if (status() === "error" && error) return chatRelayError(error)
  }
  let root: HTMLDivElement | undefined
  const saving = new Set<string>()
  const [state, setState] = createStore<{
    draft: string
    draftOwner?: string
    optionsOwner?: string
    messageID?: string
    action?: "prompt" | "reset" | "open" | "options" | "configure"
    error?: string
    optionsError?: string
  }>({
    draft: view()?.draft ?? "",
  })

  let poll: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const current = view()
    const draftOwner = current && JSON.stringify([current.relay.workspaceID, current.relay.blockID])
    if (draftOwner && draftOwner !== state.draftOwner) setState({ draft: current.draft, draftOwner })
    const optionsOwner =
      current &&
      JSON.stringify([serverSDK().scope, current.relay.workspaceID, current.relay.blockID, current.relay.tabID])
    if (optionsOwner !== state.optionsOwner)
      setState({ optionsOwner, optionsError: undefined, messageID: undefined, error: undefined })
    clearTimeout(poll)
    poll = undefined
    if (
      current?.relay.status !== "disconnected" &&
      current?.relay.status !== "opening" &&
      current?.relay.status !== "login-required" &&
      current?.relay.status !== "thinking"
    )
      return
    poll = setTimeout(() => void handle?.refresh("chat-relay-poll"), 1000)
  })
  onCleanup(() => clearTimeout(poll))

  const updateDraft = (value: string) => {
    setState({ draft: value, messageID: undefined, error: undefined })
    void handle?.dispatch({ type: "set-draft", draft: value } satisfies ChatRelayCommand)
  }

  const addCtxPack = async (payload: CtxPackDragPayloadV1) => {
    const before = attachments.attachments()
    const owner = state.optionsOwner
    const scope = serverSDK().scope
    const current = () => owner === state.optionsOwner && scope === serverSDK().scope
    await attachments
      .addCtxPack(payload, { instanceID: props.block.id, functionalityID: "builtin:chat-relay" })
      .then(() => {
        if (
          current() &&
          attachments
            .attachments()
            .some(
              (item) =>
                !before.includes(item) &&
                item.source.ctxPackID === payload.ctxPackID &&
                item.source.contentHash === payload.contentHash,
            )
        )
          setState({ messageID: undefined, error: undefined })
      })
      .catch((error: unknown) => {
        if (!current()) return
        showToast({
          variant: "error",
          title: language.t("prompt.ctxpack.failed"),
          description: chatRelayError(error),
        })
      })
  }

  const dispatch = async (command: ChatRelayCommand, action: NonNullable<typeof state.action>) => {
    if (state.action) return
    const errorField = action === "options" || action === "configure" ? "optionsError" : "error"
    const optionsOwner = state.optionsOwner
    const scope = serverSDK().scope
    const admitted = command.type === "prompt" ? attachments.attachments() : []
    setState("action", action)
    setState(errorField, undefined)
    await handle
      ?.dispatch(command)
      .then(() => {
        if (optionsOwner !== state.optionsOwner || scope !== serverSDK().scope) return
        if (command.type === "prompt") attachments.clearAfterAdmission(admitted)
        if (action === "prompt" && command.type === "prompt" && state.draft.trim() === command.text)
          setState({ draft: "", messageID: undefined })
      })
      .catch((error: unknown) => {
        if (optionsOwner !== state.optionsOwner || scope !== serverSDK().scope) return
        const message = chatRelayError(error)
        setState(
          errorField,
          message === "chat-relay-tab-unavailable" ? language.t("canvas.chat.relay.tabUnavailable") : message,
        )
      })
    setState("action", undefined)
  }

  const send = () => {
    const text = state.draft.trim()
    const contextAttachments = attachments.attachments().map(toSessionContextAttachmentInput)
    if (
      (!text && !contextAttachments.length) ||
      attachments.pendingCount() ||
      state.action ||
      view()?.relay.status !== "idle"
    )
      return
    const messageID = state.messageID ?? uuid()
    setState("messageID", messageID)
    void dispatch(
      { type: "prompt", messageID, text, ...(contextAttachments.length ? { contextAttachments } : {}) },
      "prompt",
    )
  }

  const saveResponse = async (message: ChatRelayMessage, options: { details: boolean }) => {
    const relay = view()?.relay
    if (!root || !relay?.tabID || message.role !== "assistant" || typeof message.createdAt !== "number") return
    const captured = captureCtxPackResponse({
      element: root,
      text: message.text,
      messageID: message.id,
      timestamp: message.createdAt,
      tabID: relay.tabID,
      now: Date.now(),
    })
    if (
      !captured ||
      captured.source.workspaceID !== relay.workspaceID ||
      captured.source.blockID !== relay.blockID ||
      relay.blockID !== props.block.id ||
      draft.workspaceID() !== relay.workspaceID
    ) {
      showToast(language.t("canvas.ctxpack.captureFailed"))
      return
    }
    if (options.details) {
      draft.add(captured)
      draft.openCreate()
      return
    }
    if (Math.ceil(new TextEncoder().encode(captured.text).byteLength / 4) > 6000) {
      showToast(language.t("canvas.ctxpack.captureFailed"))
      return
    }
    const key = JSON.stringify([relay.tabID, message.id])
    if (saving.has(key)) return
    saving.add(key)
    const title = Array.from(captured.text.split("\n")[0]).slice(0, 80).join("")
    const scope = serverSDK().scope
    const current = () =>
      root?.isConnected &&
      serverSDK().scope === scope &&
      view()?.relay.tabID === relay.tabID &&
      view()?.relay.workspaceID === relay.workspaceID &&
      props.block.id === relay.blockID &&
      draft.workspaceID() === relay.workspaceID
    await createCtxPackSdkFacade(serverSDK)
      .create({
        workspaceID: relay.workspaceID,
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
      .finally(() => saving.delete(key))
  }

  return (
    <div
      ref={(element) => (root = element)}
      class="canvas-relay-layout"
      data-runtime-status={status()}
      data-runtime-has-view={view() ? "true" : "false"}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        props.onFocus()
      }}
    >
      <Show when={denied()}>
        <div class="canvas-relay-state denied">
          <div class="canvas-relay-state-icon">{iconClose()}</div>
          <div class="canvas-relay-state-title">{language.t("canvas.chat.relay.handoff.denied.title")}</div>
          <div class="canvas-relay-state-note">{language.t("canvas.chat.relay.handoff.denied.description")}</div>
        </div>
      </Show>
      <Show when={!denied() && (status() === "resolving" || status() === "stale") && !view()}>
        <div class="canvas-relay-state">
          <div class="canvas-relay-spinner" aria-hidden="true">
            {iconSpin()}
          </div>
          <div class="canvas-relay-state-title">{language.t("canvas.chat.relay.loading.title")}</div>
          <div class="canvas-relay-state-note">{language.t("canvas.chat.relay.loading.description")}</div>
        </div>
      </Show>
      <Show when={!denied() && status() === "unavailable"}>
        <div class="canvas-relay-state">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconRelay()}
          </div>
          <div class="canvas-relay-state-title">{language.t("canvas.chat.relay.unavailable.title")}</div>
          <div class="canvas-relay-state-note">{language.t("canvas.chat.relay.unavailable.description")}</div>
        </div>
      </Show>
      <Show when={!denied() && status() === "error" && !view()}>
        <div class="canvas-relay-state error">
          <div class="canvas-relay-state-icon" aria-hidden="true">
            {iconClose()}
          </div>
          <div class="canvas-relay-state-title">{language.t("canvas.chat.relay.error.title")}</div>
          <div class="canvas-relay-state-note">
            {runtimeError() ?? language.t("canvas.chat.relay.error.description")}
          </div>
          <button type="button" onClick={() => void handle?.refresh("chat-relay-error")}>
            {language.t("canvas.chat.relay.retry")}
          </button>
        </div>
      </Show>
      <Show when={!denied() && (status() === "ready" || status() === "stale" || status() === "error") && view()}>
        {(current) => (
          <div class="canvas-relay-session" data-component="chat-relay">
            <div class={`canvas-relay-auth-status ${current().relay.status}`}>
              <span>{language.t(`canvas.chat.relay.status.${current().relay.status}`)}</span>
              <div class="canvas-relay-auth-actions">
                <button
                  type="button"
                  class="canvas-relay-status-button"
                  data-action="chat-relay-open"
                  disabled={!current().relay.tabID || !!state.action}
                  onClick={() => void dispatch({ type: "open-relay" }, "open")}
                >
                  {language.t("canvas.chat.relay.open")}
                </button>
                <button
                  type="button"
                  class="canvas-relay-status-button"
                  data-action="chat-relay-reset"
                  disabled={!current().relay.tabID || !!state.action || current().relay.status === "thinking"}
                  onClick={() => void dispatch({ type: "reset" }, "reset")}
                >
                  {language.t("canvas.chat.relay.reset")}
                </button>
              </div>
            </div>

            <Show
              when={current().relay.status !== "disconnected"}
              fallback={
                <div class="canvas-relay-state needs-login">
                  <div class="canvas-relay-state-icon" aria-hidden="true">
                    {iconRelay()}
                  </div>
                  <div class="canvas-relay-state-title">{language.t("canvas.chat.relay.disconnected.title")}</div>
                  <div class="canvas-relay-state-note">{language.t("canvas.chat.relay.disconnected.description")}</div>
                </div>
              }
            >
              <Show
                when={current().relay.status !== "login-required" && current().relay.status !== "opening"}
                fallback={
                  <div class="canvas-relay-state needs-login">
                    <div class="canvas-relay-state-icon" aria-hidden="true">
                      {current().relay.status === "opening" ? iconSpin() : iconRelay()}
                    </div>
                    <div class="canvas-relay-state-title">
                      {language.t(
                        current().relay.status === "opening"
                          ? "canvas.chat.relay.opening.title"
                          : "canvas.chat.relay.loginRequired.title",
                      )}
                    </div>
                    <div class="canvas-relay-state-note">
                      {language.t(
                        current().relay.status === "opening"
                          ? "canvas.chat.relay.opening.description"
                          : "canvas.chat.relay.loginRequired.description",
                      )}
                    </div>
                  </div>
                }
              >
                <div class="canvas-relay-transcript" data-component="chat-relay-transcript">
                  <Show
                    when={current().relay.messages.length > 0}
                    fallback={<div class="canvas-relay-empty">{language.t("canvas.chat.relay.empty")}</div>}
                  >
                    <Index each={current().relay.messages}>
                      {(message) => (
                        <article class={`canvas-relay-message ${message().role}`} data-message-id={message().id}>
                          <div class="canvas-relay-message-role">
                            {language.t(`canvas.chat.relay.role.${message().role}`)}
                          </div>
                          <div class="canvas-relay-message-text">{message().text}</div>
                          <Show
                            when={
                              message().role === "assistant" &&
                              message().text.trim() &&
                              (current().relay.status !== "thinking" ||
                                current().relay.messages.at(-1)?.id !== message().id)
                            }
                          >
                            <div
                              class="canvas-relay-message-actions"
                              onPointerDown={(event) => {
                                if (event.button === 0) event.stopPropagation()
                              }}
                            >
                              <ResponseSaveActions onSave={(options) => saveResponse(message(), options)} />
                            </div>
                          </Show>
                        </article>
                      )}
                    </Index>
                  </Show>
                  <Show when={current().relay.status === "thinking"}>
                    <div class="canvas-relay-thinking" role="status">
                      {iconSpin()}
                      <span>{language.t("canvas.chat.relay.thinking")}</span>
                    </div>
                  </Show>
                </div>

                <Show when={state.error ?? current().relay.error ?? runtimeError()}>
                  {(error) => (
                    <div class="canvas-relay-delivery-error" role="alert">
                      {error()}
                      <button
                        type="button"
                        data-action="chat-relay-refresh"
                        aria-label={language.t("canvas.chat.relay.retry")}
                        onClick={() => void handle?.refresh("chat-relay-error")}
                      >
                        {language.t("canvas.chat.relay.retry")}
                      </button>
                    </div>
                  )}
                </Show>

                <Show when={current().relay.tabID && current().relay.status !== "closed"}>
                  <div
                    class="canvas-relay-controls"
                    onPointerDown={(event) => {
                      if (event.button === 0) event.stopPropagation()
                    }}
                  >
                    <For each={["model", "effort"] as const}>
                      {(kind) => (
                        <Show when={current().relay.controls?.[kind]}>
                          {(selection) => (
                            <Show when={selection().options.length > 0}>
                              <label class="canvas-relay-control">
                                <span>{language.t(`canvas.chat.relay.${kind}`)}</span>
                                <select
                                  aria-label={language.t(`canvas.chat.relay.${kind}`)}
                                  value={selection().value ?? ""}
                                  disabled={!!state.action || current().relay.status !== "idle"}
                                  onChange={(event) => {
                                    const select = event.currentTarget
                                    const value = select.value
                                    if (!value || value === selection().value) return
                                    void dispatch({ type: "configure", [kind]: value }, "configure").then(() => {
                                      select.value = current().relay.controls?.[kind]?.value ?? ""
                                    })
                                  }}
                                >
                                  <Show when={!selection().value}>
                                    <option value="" disabled>
                                      {selection().label ?? language.t(`canvas.chat.relay.${kind}`)}
                                    </option>
                                  </Show>
                                  <For each={selection().options}>
                                    {(option) => (
                                      <option value={option.id} disabled={option.disabled}>
                                        {option.label}
                                      </option>
                                    )}
                                  </For>
                                </select>
                                <Show
                                  when={
                                    selection().value &&
                                    selection().label !==
                                      selection().options.find((option) => option.id === selection().value)?.label
                                  }
                                >
                                  <span>{selection().label}</span>
                                </Show>
                              </label>
                            </Show>
                          )}
                        </Show>
                      )}
                    </For>
                    <button
                      type="button"
                      class="canvas-relay-status-button"
                      data-action="chat-relay-refresh-options"
                      disabled={!!state.action || current().relay.status !== "idle"}
                      onClick={() => void dispatch({ type: "refresh-options" }, "options")}
                    >
                      {language.t("canvas.chat.relay.refreshOptions")}
                    </button>
                    <Show
                      when={
                        state.action === "options"
                          ? language.t("canvas.chat.relay.readingOptions")
                          : (state.optionsError ??
                            current().relay.controls?.error ??
                            (!current().relay.controls?.model?.options.length &&
                              !current().relay.controls?.effort?.options.length &&
                              language.t("canvas.chat.relay.optionsPending")))
                      }
                    >
                      {(message) => (
                        <div class="canvas-relay-options-note" role="status">
                          {message()}
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>

                <CtxPackDropTarget
                  targetID={targetID}
                  workspaceID={workspaceID() ?? ""}
                  instanceID={props.block.id}
                  functionalityID="builtin:chat-relay"
                  addCtxPack={addCtxPack}
                  disabled={() =>
                    !view()?.relay.tabID || view()?.relay.status === "closed" || state.action === "prompt"
                  }
                  class="canvas-relay-context-composer"
                >
                  <div onFocusIn={() => targets.markFocused(targetID)}>
                    <Show when={attachments.attachments().length > 0}>
                      <div
                        class="canvas-relay-attachments"
                        data-component="context-attachment-chips"
                        onPointerDown={(event) => {
                          if (event.button === 0) event.stopPropagation()
                        }}
                      >
                        <For each={attachments.attachments()}>
                          {(attachment) => (
                            <div class="canvas-relay-attachment" data-attachment-id={attachment.clientAttachmentID}>
                              <button
                                type="button"
                                data-action="ctxpack-attachment-preview"
                                onClick={() =>
                                  dialog.show(() => (
                                    <CtxPackAttachmentPreview
                                      workspaceID={current().relay.workspaceID}
                                      ctxPackID={attachment.source.ctxPackID}
                                    />
                                  ))
                                }
                              >
                                {attachment.label}
                              </button>
                              <button
                                type="button"
                                data-action="ctxpack-attachment-remove"
                                aria-label={language.t("prompt.attachment.remove")}
                                disabled={state.action === "prompt"}
                                onClick={() => {
                                  attachments.remove(attachment.clientAttachmentID)
                                  setState({ messageID: undefined, error: undefined })
                                }}
                              >
                                {iconClose()}
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={attachments.pendingCount() > 0}>
                      <div class="canvas-relay-attachment-note" role="status">
                        {language.t("canvas.chat.relay.attachingCtxPack")}
                      </div>
                    </Show>
                    <div class="canvas-relay-composer">
                      <textarea
                        class="canvas-notes-area"
                        data-input="chat-relay-message"
                        value={state.draft}
                        placeholder={language.t("canvas.chat.relay.placeholder")}
                        aria-label={language.t("canvas.chat.relay.placeholder")}
                        autofocus={props.focused}
                        disabled={current().relay.status === "closed"}
                        onInput={(event) => updateDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                          event.preventDefault()
                          send()
                        }}
                      />
                      <button
                        type="button"
                        class="canvas-relay-init-button"
                        data-action="chat-relay-send"
                        disabled={
                          (!state.draft.trim() && !attachments.attachments().length) ||
                          attachments.pendingCount() > 0 ||
                          !!state.action ||
                          current().relay.status !== "idle"
                        }
                        onClick={send}
                      >
                        {language.t(state.action === "prompt" ? "canvas.chat.relay.sending" : "canvas.chat.relay.send")}
                      </button>
                    </div>
                    <Show when={!attachments.attachments().length && !attachments.pendingCount()}>
                      <div class="canvas-relay-attachment-note">{language.t("canvas.chat.relay.ctxpackHint")}</div>
                    </Show>
                  </div>
                </CtxPackDropTarget>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
