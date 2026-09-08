/** @jsxImportSource solid-js */
import { For, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import type { CtxPackSensitivity, CtxPackSummary } from "./types"

type PendingAction = "patch" | "remove" | "restore" | null

export interface CtxPackCardProps {
  summary: CtxPackSummary
  view: Accessor<CtxPackBrowserView>
  dispatch(command: CtxPackBrowserCommand): Promise<void>
}

export function CtxPackCard(props: CtxPackCardProps) {
  const language = useLanguage()
  const [state, setState] = createStore({
    pending: null as PendingAction,
    editing: false,
    title: "",
    keywords: "",
    sensitivity: "workspace" as CtxPackSensitivity,
    revision: 0,
    error: null as string | null,
  })

  const isDeleted = () => props.summary.deletedAt != null

  async function run(action: Exclude<PendingAction, null>, command: CtxPackBrowserCommand): Promise<void> {
    // Local pending visual state; the refreshed projection drives everything else.
    setState({ pending: action, error: null })
    try {
      await props.dispatch(command)
      if (action === "patch") setState("editing", false)
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
      setState(
        "error",
        language.t(
          code === "CtxPackRevisionConflict" || code === "CtxPackRevisionConflictError"
            ? "canvas.ctxpack.edit.conflict"
            : "canvas.ctxpack.edit.failed",
        ),
      )
    } finally {
      setState("pending", null)
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault()
    if (state.pending !== null) return
    const title = state.title.trim()
    const keywords = state.keywords
      .split(",")
      .map((keyword) => keyword.normalize("NFKC").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .filter(
        (keyword, index, values) =>
          values.findIndex((value) => value.toLowerCase() === keyword.toLowerCase()) === index,
      )
    if (Array.from(title).length < 1 || Array.from(title).length > 120) {
      setState("error", language.t("canvas.ctxpack.edit.invalidTitle"))
      return
    }
    if (keywords.length > 12 || keywords.some((keyword) => Array.from(keyword).length > 48)) {
      setState("error", language.t("canvas.ctxpack.edit.invalidKeywords"))
      return
    }
    void run("patch", {
      type: "patch-metadata",
      ctxPackID: props.summary.id,
      expectedRevision: state.revision,
      patch: { title, keywords, sensitivity: state.sensitivity },
    })
  }

  function open(): void {
    void props.dispatch({ type: "open", ctxPackID: props.summary.id })
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return
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
      parts.push(
        shown.join(", ") +
          (functionalityIDs.length > shown.length ? ` +${functionalityIDs.length - shown.length}` : ""),
      )
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
          <For each={keywordChips()}>{(keyword) => <span class="ctxpack-browser-chip">{keyword}</span>}</For>
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
              disabled={state.pending !== null}
              onClick={(event) => {
                event.stopPropagation()
                setState({
                  editing: true,
                  title: props.summary.title,
                  keywords: props.summary.keywords.join(", "),
                  sensitivity: props.summary.sensitivity,
                  revision: props.summary.revision,
                  error: null,
                })
              }}
            >
              {state.pending === "patch" ? "Patching…" : "Patch"}
            </button>
          </Show>
          <Show when={props.view().canDelete}>
            <Show
              when={!isDeleted()}
              fallback={
                <button
                  type="button"
                  class="ctxpack-browser-btn"
                  disabled={state.pending !== null}
                  onClick={(event) => {
                    event.stopPropagation()
                    void run("restore", {
                      type: "restore",
                      ctxPackID: props.summary.id,
                      expectedRevision: props.summary.revision,
                    })
                  }}
                >
                  {state.pending === "restore" ? "Restoring…" : "Restore"}
                </button>
              }
            >
              <button
                type="button"
                class="ctxpack-browser-btn ctxpack-browser-btn-danger"
                disabled={state.pending !== null}
                onClick={(event) => {
                  event.stopPropagation()
                  void run("remove", {
                    type: "remove",
                    ctxPackID: props.summary.id,
                    expectedRevision: props.summary.revision,
                  })
                }}
              >
                {state.pending === "remove" ? "Removing…" : "Delete"}
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={state.editing}>
        <form
          class="ctxpack-browser-metadata"
          onSubmit={save}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <label class="ctxpack-browser-filter">
            <span>{language.t("canvas.ctxpack.edit.title")}</span>
            <input
              aria-label={language.t("canvas.ctxpack.edit.title")}
              value={state.title}
              disabled={state.pending !== null}
              onInput={(event) => setState("title", event.currentTarget.value)}
            />
          </label>
          <label class="ctxpack-browser-filter">
            <span>{language.t("canvas.ctxpack.edit.keywords")}</span>
            <input
              aria-label={language.t("canvas.ctxpack.edit.keywords")}
              value={state.keywords}
              disabled={state.pending !== null}
              placeholder={language.t("canvas.ctxpack.edit.keywordsPlaceholder")}
              onInput={(event) => setState("keywords", event.currentTarget.value)}
            />
          </label>
          <label class="ctxpack-browser-filter">
            <span>{language.t("canvas.ctxpack.edit.sensitivity")}</span>
            <select
              aria-label={language.t("canvas.ctxpack.edit.sensitivity")}
              value={state.sensitivity}
              disabled={state.pending !== null}
              onChange={(event) => setState("sensitivity", event.currentTarget.value as CtxPackSensitivity)}
            >
              <option value="public">{language.t("canvas.ctxpack.sensitivity.public")}</option>
              <option value="workspace">{language.t("canvas.ctxpack.sensitivity.workspace")}</option>
              <option value="private">{language.t("canvas.ctxpack.sensitivity.private")}</option>
            </select>
          </label>
          <div class="ctxpack-browser-card-actions">
            <button type="submit" class="ctxpack-browser-btn" disabled={state.pending !== null}>
              {language.t("canvas.ctxpack.edit.save")}
            </button>
            <button
              type="button"
              class="ctxpack-browser-btn"
              disabled={state.pending !== null}
              onClick={() => setState({ editing: false, error: null })}
            >
              {language.t("canvas.ctxpack.edit.cancel")}
            </button>
          </div>
        </form>
      </Show>
      <Show when={state.error}>
        <p class="ctxpack-browser-error-code" role="alert">
          {state.error}
        </p>
      </Show>

      <div class="ctxpack-browser-live" aria-live="polite" role="status">
        {props.view().errorCode ?? ""}
      </div>
    </article>
  )
}
