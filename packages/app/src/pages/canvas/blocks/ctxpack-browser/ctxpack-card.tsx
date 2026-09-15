import { createSignal, For, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import { CTXPACK_DRAG_MIME, type CtxPackSummary } from "./types"

export function CtxPackCard(props: {
  summary: CtxPackSummary
  view: Accessor<CtxPackBrowserView>
  dispatch(command: CtxPackBrowserCommand): Promise<void>
  createDragPayload(summary: CtxPackSummary): string
}) {
  const language = useLanguage()
  const draggable = () => props.summary.deletedAt == null && props.view().canMaterialize
  const pinned = () => props.summary.pinnedAt != null
  const pinDisabled = () => props.summary.deletedAt != null && !pinned()
  const [pinPending, setPinPending] = createSignal(false)
  const [pinFailed, setPinFailed] = createSignal(false)
  const open = () => void props.dispatch({ type: "open", ctxPackID: props.summary.id })
  const savedTimestamp = () => props.summary.createdAt
  const savedDate = () => new Date(savedTimestamp()).toLocaleDateString(undefined, { dateStyle: "medium" })

  function togglePinned(event: MouseEvent): void {
    event.stopPropagation()
    if (pinPending() || pinDisabled()) return
    setPinPending(true)
    setPinFailed(false)
    void props.dispatch({ type: "set-pinned", ctxPackID: props.summary.id, pinned: !pinned() }).then(
      () => setPinPending(false),
      () => {
        setPinPending(false)
        setPinFailed(true)
      },
    )
  }

  return (
    <article
      class="ctxpack-browser-card ctxpack-browser-row"
      draggable={draggable()}
      data-deleted={props.summary.deletedAt != null}
      data-ctxpack-id={props.summary.id}
      onDragStart={(event) => {
        if (!draggable() || !event.dataTransfer) return
        event.stopPropagation()
        event.dataTransfer.setData(CTXPACK_DRAG_MIME, props.createDragPayload(props.summary))
        event.dataTransfer.setData("text/plain", props.summary.title)
        event.dataTransfer.effectAllowed = "copy"
      }}
    >
      <div
        class="ctxpack-browser-row-content"
        role="button"
        tabIndex={0}
        aria-label={language.t("canvas.ctxpack.open", { title: props.summary.title })}
        onPointerDown={(event) => {
          if (event.button === 0) event.stopPropagation()
        }}
        onClick={open}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
          event.preventDefault()
          open()
        }}
      >
        <h3 class="ctxpack-browser-card-title">{props.summary.title}</h3>
        <Show when={props.summary.keywords.length > 0}>
          <div class="ctxpack-browser-chips">
            <For each={props.summary.keywords.slice(0, 3)}>
              {(keyword) => <span class="ctxpack-browser-chip">{keyword}</span>}
            </For>
          </div>
        </Show>
        <p class="ctxpack-browser-card-meta">
          <span>{language.t("canvas.ctxpack.browser.saved")}</span>{" "}
          <time dateTime={new Date(savedTimestamp()).toISOString()}>{savedDate()}</time>
        </p>
      </div>
      <div class="ctxpack-browser-pin-area">
        <button
          type="button"
          class="ctxpack-browser-btn ctxpack-browser-pin"
          data-action="pin"
          disabled={pinDisabled() || pinPending()}
          aria-busy={pinPending()}
          aria-label={language.t(pinned() ? "canvas.ctxpack.browser.unpinAria" : "canvas.ctxpack.browser.pinAria", {
            title: props.summary.title,
          })}
          onPointerDown={(event) => {
            if (event.button === 0) event.stopPropagation()
          }}
          onClick={togglePinned}
        >
          {language.t(pinned() ? "canvas.ctxpack.browser.unpin" : "canvas.ctxpack.browser.pin")}
        </button>
        <Show when={pinFailed()}>
          <span class="ctxpack-browser-pin-error" role="alert">
            {language.t("canvas.ctxpack.browser.pinError")}
          </span>
        </Show>
      </div>
    </article>
  )
}
