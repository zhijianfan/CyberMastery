/** @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js"
import type { Accessor } from "solid-js"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import type { CtxPackSummary } from "./types"

type PendingAction = "patch" | "remove" | "restore" | null

export interface CtxPackCardProps {
  summary: CtxPackSummary
  view: Accessor<CtxPackBrowserView>
  dispatch(command: CtxPackBrowserCommand): Promise<void>
}

export function CtxPackCard(props: CtxPackCardProps) {
  const [pending, setPending] = createSignal<PendingAction>(null)

  const isDeleted = () => props.summary.deletedAt != null

  async function run(action: Exclude<PendingAction, null>, command: CtxPackBrowserCommand): Promise<void> {
    // Local pending visual state; the refreshed projection drives everything else.
    setPending(action)
    try {
      await props.dispatch(command)
    } finally {
      setPending(null)
    }
  }

  function open(): void {
    void props.dispatch({ type: "open", ctxPackID: props.summary.id })
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      open()
    }
  }

  const sourceSummary = () => {
    const parts: string[] = []
    const blockCount = props.summary.sourceBlockIDs.length
    if (blockCount > 0) parts.push(`${blockCount} block${blockCount === 1 ? "" : "s"}`)
    const functionalityIDs = props.summary.sourceFunctionalityIDs
    if (functionalityIDs.length > 0) {
      const shown = functionalityIDs.slice(0, 2)
      parts.push(shown.join(", ") + (functionalityIDs.length > shown.length ? ` +${functionalityIDs.length - shown.length}` : ""))
    }
    return parts.join(" · ") || "no sources"
  }

  const keywordChips = () => props.summary.keywords.slice(0, 4)
  const extraKeywords = () => Math.max(0, props.summary.keywords.length - keywordChips().length)

  const lastAttached = () =>
    props.summary.usage.lastAttachedAt == null
      ? null
      : new Date(props.summary.usage.lastAttachedAt).toLocaleDateString()

  return (
    <article
      class="ctxpack-browser-card"
      role="button"
      tabIndex={0}
      aria-label={`Open context pack ${props.summary.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
      data-ctxpack-id={props.summary.id}
    >
      <div class="ctxpack-browser-card-head">
        <h3 class="ctxpack-browser-card-title">{props.summary.title}</h3>
        <Show when={isDeleted() && props.view().query.includeDeleted}>
          <span class="ctxpack-browser-badge ctxpack-browser-badge-deleted">deleted</span>
        </Show>
      </div>

      <Show when={keywordChips().length > 0}>
        <div class="ctxpack-browser-chips">
          <For each={keywordChips()}>
            {(keyword) => <span class="ctxpack-browser-chip">{keyword}</span>}
          </For>
          <Show when={extraKeywords() > 0}>
            <span class="ctxpack-browser-chip ctxpack-browser-chip-more">+{extraKeywords()}</span>
          </Show>
        </div>
      </Show>

      <div class="ctxpack-browser-card-meta">
        <span>
          {props.summary.fragmentCount} fragment{props.summary.fragmentCount === 1 ? "" : "s"}
        </span>
        <span>{sourceSummary()}</span>
        <span>{new Date(props.summary.createdAt).toLocaleDateString()}</span>
        <span>{props.summary.estimatedTokens.toLocaleString()} tok</span>
        <Show when={props.summary.usage.attachedCount > 0}>
          <span>attached {props.summary.usage.attachedCount}×</span>
        </Show>
        <Show when={lastAttached() != null}>
          <span>last attached {lastAttached()}</span>
        </Show>
      </div>

      <Show when={props.view().canPatch || props.view().canDelete}>
        <div class="ctxpack-browser-card-actions">
          <Show when={props.view().canPatch}>
            <button
              type="button"
              class="ctxpack-browser-btn"
              disabled={pending() !== null}
              onClick={(event) => {
                event.stopPropagation()
                void run("patch", {
                  type: "patch-metadata",
                  ctxPackID: props.summary.id,
                  expectedRevision: props.summary.revision,
                  patch: {},
                })
              }}
            >
              {pending() === "patch" ? "Patching…" : "Patch"}
            </button>
          </Show>
          <Show when={props.view().canDelete}>
            <Show
              when={!isDeleted()}
              fallback={
                <button
                  type="button"
                  class="ctxpack-browser-btn"
                  disabled={pending() !== null}
                  onClick={(event) => {
                    event.stopPropagation()
                    void run("restore", {
                      type: "restore",
                      ctxPackID: props.summary.id,
                      expectedRevision: props.summary.revision,
                    })
                  }}
                >
                  {pending() === "restore" ? "Restoring…" : "Restore"}
                </button>
              }
            >
              <button
                type="button"
                class="ctxpack-browser-btn ctxpack-browser-btn-danger"
                disabled={pending() !== null}
                onClick={(event) => {
                  event.stopPropagation()
                  void run("remove", {
                    type: "remove",
                    ctxPackID: props.summary.id,
                    expectedRevision: props.summary.revision,
                  })
                }}
              >
                {pending() === "remove" ? "Removing…" : "Delete"}
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="ctxpack-browser-live" aria-live="polite" role="status">
        {props.view().errorCode ?? ""}
      </div>
    </article>
  )
}
