/** @jsxImportSource solid-js */
import { For, Show } from "solid-js"
import type { CtxPackBrowserCommand } from "./view-model"
import { CTXPACK_DRAG_MIME } from "./types"
import type { CtxPackFragment, CtxPackInfo, CtxPackSource, CtxPackSummary } from "./types"

export interface CtxPackDetailProps {
  info: CtxPackInfo
  dispatch(command: CtxPackBrowserCommand): Promise<void>
  createDragPayload(summary: CtxPackSummary): string
  attachToFocusedInput(summary: CtxPackSummary): Promise<void>
}

function toSummary(info: CtxPackInfo): CtxPackSummary {
  const blockIDs = [...new Set(info.fragments.map((fragment) => fragment.source.blockID))]
  const functionalityIDs = [...new Set(info.fragments.map((fragment) => fragment.source.functionalityID))]
  const kinds = [...new Set(info.fragments.map((fragment) => fragment.source.kind))]
  return {
    id: info.id,
    workspaceID: info.workspaceID,
    title: info.title,
    keywords: info.keywords,
    sensitivity: info.sensitivity,
    revision: info.revision,
    contentHash: info.contentHash,
    byteLength: info.byteLength,
    estimatedTokens: info.estimatedTokens,
    fragmentCount: info.fragments.length,
    sourceBlockIDs: blockIDs,
    sourceFunctionalityIDs: functionalityIDs,
    sourceKinds: kinds,
    usage: info.usage,
    createdAt: info.createdAt,
    updatedAt: info.updatedAt,
    deletedAt: info.deletedAt,
  }
}

function formatTimestamp(timestamp: number | null): string {
  return timestamp == null ? "no timestamp" : new Date(timestamp).toLocaleString()
}

function sourceLine(source: CtxPackSource): string {
  const parts: string[] = []
  if (source.workspaceID !== "") parts.push(`workspace ${source.workspaceID}`)
  if (source.blockID !== "") parts.push(`block ${source.blockID}`)
  if (source.functionalityID !== "") parts.push(source.functionalityID)
  const origin = parts.length > 0 ? parts.join(" · ") : "unknown source"
  const direction = source.direction === "unknown" ? "" : ` · ${source.direction}`
  const time = source.sourceTimestamp ?? source.capturedAt
  return `${source.kind}${direction} · ${origin} · ${formatTimestamp(time)}`
}

export function CtxPackDetail(props: CtxPackDetailProps) {
  const fragments = () => [...props.info.fragments].sort((a, b) => a.ordinal - b.ordinal)

  function onDragStart(event: DragEvent): void {
    if (event.dataTransfer == null) return
    event.dataTransfer.setData(CTXPACK_DRAG_MIME, props.createDragPayload(toSummary(props.info)))
    event.dataTransfer.setData("text/plain", props.info.title)
    event.dataTransfer.effectAllowed = "copy"
  }

  return (
    <section class="ctxpack-browser-detail" data-ctxpack-id={props.info.id}>
      <header class="ctxpack-browser-detail-header">
        <div
          class="ctxpack-drag-icon"
          draggable={true}
          role="button"
          tabIndex={0}
          aria-label="Drag pack to attach"
          title="Drag pack to attach"
          onDragStart={onDragStart}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
            <path d="M3 8l9 5 9-5" />
            <path d="M12 13v8" />
          </svg>
        </div>
        <div class="ctxpack-browser-detail-titles">
          <h2 class="ctxpack-browser-detail-title">{props.info.title}</h2>
          <p class="ctxpack-browser-detail-sub">
            {props.info.fragments.length} fragments · {props.info.estimatedTokens.toLocaleString()} tokens · rev{" "}
            {props.info.revision} · {props.info.sensitivity}
          </p>
        </div>
        <button type="button" class="ctxpack-browser-btn" onClick={() => void props.dispatch({ type: "close-detail" })}>
          Close
        </button>
      </header>

      <div class="ctxpack-browser-detail-actions">
        <button
          type="button"
          class="ctxpack-browser-btn ctxpack-browser-btn-attach"
          onClick={() => void props.attachToFocusedInput(toSummary(props.info))}
        >
          Attach to focused input
        </button>
      </div>

      <Show when={props.info.keywords.length > 0}>
        <div class="ctxpack-browser-chips">
          <For each={props.info.keywords}>
            {(keyword) => <span class="ctxpack-browser-chip">{keyword}</span>}
          </For>
        </div>
      </Show>

      <p class="ctxpack-browser-detail-meta">
        created {new Date(props.info.createdAt).toLocaleString()} · updated{" "}
        {new Date(props.info.updatedAt).toLocaleString()}
      </p>

      <ol class="ctxpack-browser-fragments">
        <For each={fragments()}>
          {(fragment: CtxPackFragment) => (
            <li class="ctxpack-browser-fragment" data-ordinal={fragment.ordinal}>
              <div
                class="ctxpack-browser-fragment-source"
                data-source-workspace={fragment.source.workspaceID}
                data-source-block={fragment.source.blockID}
                data-source-functionality={fragment.source.functionalityID}
                data-source-timestamp={fragment.source.sourceTimestamp ?? fragment.source.capturedAt}
              >
                {sourceLine(fragment.source)}
              </div>
              {/* Fragment text is rendered as inert text only — no markup injection. */}
              <pre class="ctxpack-browser-fragment-text">{fragment.text}</pre>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}
