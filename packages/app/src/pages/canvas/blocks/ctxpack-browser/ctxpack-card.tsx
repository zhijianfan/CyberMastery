import { For, Show } from "solid-js"
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
  const open = () => void props.dispatch({ type: "open", ctxPackID: props.summary.id })

  return (
    <article
      class="ctxpack-browser-card"
      role="button"
      tabIndex={0}
      aria-label={language.t("canvas.ctxpack.open", { title: props.summary.title })}
      draggable={draggable()}
      data-deleted={props.summary.deletedAt != null}
      data-ctxpack-id={props.summary.id}
      onPointerDown={(event) => {
        if (event.button === 0) event.stopPropagation()
      }}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        open()
      }}
      onDragStart={(event) => {
        if (!draggable() || !event.dataTransfer) return
        event.stopPropagation()
        event.dataTransfer.setData(CTXPACK_DRAG_MIME, props.createDragPayload(props.summary))
        event.dataTransfer.setData("text/plain", props.summary.title)
        event.dataTransfer.effectAllowed = "copy"
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
    </article>
  )
}
