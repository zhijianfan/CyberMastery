import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { createComponent, createEffect, createMemo, ErrorBoundary, For, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { ContextAttachmentStoreProvider } from "@/context/ctxpack/attachment-store"
import { useCtxPackDraft } from "@/context/ctxpack/draft"
import { suggestCtxPackKeywords } from "@/context/ctxpack/keyword-suggest"
import { captureCtxPackResponse } from "@/context/ctxpack/selection"
import { attachmentStoreMaterializeFacade, createCtxPackSdkFacade } from "@/context/ctxpack/sdk-facade"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { createPromptInputController, createSessionComposerController } from "@/pages/session/composer"
import { createPromptModelSelection } from "@/pages/session/composer/prompt-model-selection"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { MessageTimeline } from "@/pages/session/timeline/message-timeline"
import { createTimelineModel } from "@/pages/session/timeline/model"
import { formatServerError } from "@/utils/server-errors"
import { showToast } from "@/utils/toast"
import { BlockChatComposer } from "./block-chat-composer"
import type { CanvasSessionSurfaceProps } from "./session-target"
import "./block-chat.css"

// The binding owns the conversation. This view deliberately has no routed
// session shell, terminal, review panel, or page-level command registration.
export function BlockChat(props: CanvasSessionSurfaceProps) {
  const serverSDK = useServerSDK()
  const language = useLanguage()
  return (
    <Show when={JSON.stringify([serverSDK().scope, props.target.directory, props.target.sessionID])} keyed>
      {(_key) => (
        <ErrorBoundary
          fallback={(error, retry) => (
            <div class="block-chat-error" role="alert">
              <span>{formatServerError(error, language.t)}</span>
              <button type="button" onClick={retry}>
                {language.t("common.retry")}
              </button>
            </div>
          )}
        >
          <Suspense
            fallback={
              <div class="block-chat-empty" role="status">
                {language.t("prompt.loading")}
              </div>
            }
          >
            {createComponent(ContextAttachmentStoreProvider, {
              workspaceID: () => props.target.workspaceID,
              scopeKey: () => JSON.stringify([serverSDK().scope, props.target.sessionID, props.target.contextTarget]),
              materialize: attachmentStoreMaterializeFacade(serverSDK),
              get children() {
                return <BlockChatContent {...props} />
              },
            })}
          </Suspense>
        </ErrorBoundary>
      )}
    </Show>
  )
}

function BlockChatContent(props: CanvasSessionSurfaceProps) {
  const language = useLanguage()
  const draft = useCtxPackDraft()
  const sync = useSync()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const prompt = usePrompt()
  const role = () => props.role ?? "relay"
  const sessionID = () => props.target.sessionID
  const sessionKey = () => JSON.stringify([serverSDK().scope, props.target.directory, sessionID(), props.surfaceID])
  const info = createMemo(() => sync().session.get(sessionID()))
  const working = () => sync().data.session_working(sessionID())
  const requests = createSessionComposerController({ sessionID })
  const timeline = createTimelineModel({ sessionID, revertMessageID: () => info()?.revert?.messageID })
  const agent = () => info()?.agent ?? timeline.lastUserMessage()?.agent ?? sync().data.config.default_agent ?? "build"
  const model = createPromptModelSelection({ agent: () => sync().data.agent.find((item) => item.name === agent()) })
  const input = createPromptInputController({ sessionKey, sessionID, queryOptions: serverSync().queryOptions, model })
  const controls = createMemo(() => ({
    ...input(),
    agents: { ...input().agents, current: agent(), visible: false },
  }))
  const [state, setState] = createStore({
    scroll: { overflow: false, bottom: true, jump: false },
    gesture: 0,
    historyError: undefined as string | undefined,
  })
  const autoScroll = createAutoScroll({ working: () => true, overflowAnchor: "none" })
  let root: HTMLElement | undefined
  let scroller: HTMLDivElement | undefined
  let scrollToEnd = () => {}
  let captureHistory = () => {}
  let restoreHistory = (_done: boolean) => {}

  createEffect(() => {
    if (role() !== "relay" || !prompt.ready() || prompt.model.current()) return
    const selected = info()?.model
    const previous = timeline.lastUserMessage()?.model
    const fallback = model.current()
    if (selected) prompt.model.set({ providerID: selected.providerID, modelID: selected.id, variant: selected.variant })
    if (!selected && previous) prompt.model.set(previous)
    if (!selected && !previous && fallback) prompt.model.set({ providerID: fallback.provider.id, modelID: fallback.id })
  })

  const updateScroll = (element: HTMLDivElement) => {
    const distance = element.scrollHeight - element.clientHeight - element.scrollTop
    setState("scroll", {
      overflow: element.scrollHeight > element.clientHeight + 1,
      bottom: distance <= 2,
      jump: distance > Math.max(160, element.clientHeight / 2),
    })
  }
  const resume = () => {
    autoScroll.resume()
    scrollToEnd()
    if (scroller) updateScroll(scroller)
  }
  const loadOlder = () => {
    setState("historyError", undefined)
    void timeline.history.loadOlder({ before: captureHistory, after: restoreHistory }).catch((error) => {
      setState("historyError", formatServerError(error, language.t))
    })
  }
  const status = () => (requests.blocked() ? "attention" : working() ? "working" : "ready")
  const beforeSubmit = async () => {
    await props.beforeSubmit?.()
    if (role() !== "relay") return
    const selected = model.current()
    if (!selected) return
    const next = { providerID: selected.provider.id, id: selected.id, variant: model.variant.current() }
    const current = info()?.model
    if (current?.providerID === next.providerID && current.id === next.id && current.variant === next.variant) return
    await serverSDK().client.v2.session.switchModel({ sessionID: sessionID(), model: next }, { throwOnError: true })
    await serverSync().session.resolve(sessionID(), { force: true })
  }

  return (
    <section
      ref={(element) => {
        root = element
      }}
      class="block-chat"
      data-command-scope="local"
      data-chat-role={role()}
      data-chat-session={sessionID()}
    >
      {timeline.resource() ?? ""}
      <div class="block-chat-status">
        <span>{language.t(`canvas.chat.${role()}.purpose`)}</span>
        <span class="block-chat-state" data-state={status()} role="status">
          <i aria-hidden="true" />
          {language.t(`canvas.chat.${status()}`)}
        </span>
      </div>
      <Show when={timeline.history.more()}>
        <button class="block-chat-history" type="button" disabled={timeline.history.loading()} onClick={loadOlder}>
          {language.t("canvas.chat.history")}
        </button>
      </Show>
      <Show when={state.historyError}>
        {(error) => (
          <div class="block-chat-error" role="alert">
            {error()}
          </div>
        )}
      </Show>
      <div class="block-chat-messages">
        <Show
          when={timeline.ready() && timeline.visibleUserMessages().length > 0}
          fallback={
            <div class="block-chat-empty">
              <strong>{language.t(`canvas.chat.${role()}.title`)}</strong>
              <p>{language.t(`canvas.chat.${role()}.empty`)}</p>
            </div>
          }
        >
          <MessageTimeline
            sessionID={sessionID}
            sessionKey={sessionKey}
            header={false}
            onSaveResponse={async (response, options) => {
              if (!root) return
              const workspaceID = props.target.workspaceID
              const captured = captureCtxPackResponse({
                ...response,
                element: root,
                sessionID: sessionID(),
                now: Date.now(),
              })
              if (
                !captured ||
                !workspaceID ||
                captured.source.workspaceID !== workspaceID ||
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
              if (Math.ceil(new TextEncoder().encode(captured.text).byteLength / 4) > 6000) {
                showToast(language.t("canvas.ctxpack.captureFailed"))
                return
              }
              const title = Array.from(captured.text.split("\n")[0]).slice(0, 80).join("")
              const owner = sessionKey()
              const current = () =>
                root?.isConnected &&
                sessionKey() === owner &&
                props.target.workspaceID === workspaceID &&
                draft.workspaceID() === workspaceID
              await createCtxPackSdkFacade(serverSDK)
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
            }}
            userMessages={timeline.visibleUserMessages()}
            anchor={(id) => `block-chat-${props.surfaceID}-${id}`}
            centered={false}
            scroll={state.scroll}
            onResumeScroll={resume}
            setScrollRef={(element) => {
              scroller = element
              autoScroll.scrollRef(element)
              if (element) updateScroll(element)
            }}
            setContentRef={autoScroll.contentRef}
            onScheduleScrollState={updateScroll}
            onAutoScrollHandleScroll={autoScroll.handleScroll}
            onAutoScrollInteraction={autoScroll.handleInteraction}
            onMarkScrollGesture={() => setState("gesture", Date.now())}
            hasScrollGesture={() => Date.now() - state.gesture < 1500}
            onUserScroll={() => {}}
            onHistoryScroll={() => {
              if (scroller && scroller.scrollTop < 100 && autoScroll.userScrolled() && !timeline.history.loading())
                loadOlder()
            }}
            shouldAnchorBottom={() => !autoScroll.userScrolled()}
            setScrollToEnd={(scroll) => {
              scrollToEnd = scroll
            }}
            setHistoryAnchor={(anchor) => {
              captureHistory = anchor.capture
              restoreHistory = anchor.restore
            }}
          />
        </Show>
      </div>
      <Show when={role() === "master" && requests.todos().length > 0}>
        <details class="block-chat-tasks">
          <summary>{language.t("canvas.chat.tasks")}</summary>
          <ul>
            <For each={requests.todos()}>{(todo) => <li data-status={todo.status}>{todo.content}</li>}</For>
          </ul>
        </details>
      </Show>
      <div class="block-chat-composer">
        <Show when={requests.questionRequest()} keyed>
          {(request) => (
            <SessionQuestionDock request={request} onSubmit={resume} autofocus={props.focused} container={() => root} />
          )}
        </Show>
        <Show when={requests.permissionRequest()} keyed>
          {(request) => (
            <SessionPermissionDock
              request={request}
              responding={requests.permissionResponding()}
              onDecide={requests.decide}
            />
          )}
        </Show>
        <Show when={timeline.ready() && prompt.ready() && info() && !requests.blocked()}>
          <BlockChatComposer
            role={role()}
            controls={controls()}
            beforeSubmit={beforeSubmit}
            contextTarget={props.target.contextTarget}
            workspaceID={props.target.workspaceID}
            queue={() => props.queueEnabled && working()}
            onSubmit={resume}
          />
        </Show>
      </div>
    </section>
  )
}
