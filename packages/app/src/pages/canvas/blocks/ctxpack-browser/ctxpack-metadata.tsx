import { Show } from "solid-js"
import type { Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { CtxPackBrowserCommand, CtxPackBrowserView } from "./view-model"
import type { CtxPackSensitivity, CtxPackSummary } from "./types"

type PendingAction = "patch" | "remove" | "restore" | null

export interface CtxPackMetadataProps {
  summary: CtxPackSummary
  view: Accessor<CtxPackBrowserView>
  dispatch(command: CtxPackBrowserCommand): Promise<void>
}

export function CtxPackMetadata(props: CtxPackMetadataProps) {
  const language = useLanguage()
  const [state, setState] = createStore({
    pending: null as PendingAction,
    editing: false,
    title: "",
    keywords: "",
    parallelPlan: false,
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
      patch: {
        title,
        keywords,
        sensitivity: state.sensitivity,
        ...(state.parallelPlan !== (props.summary.tags?.includes("ParallelPlan") ?? false)
          ? { tags: state.parallelPlan ? ["ParallelPlan"] : [] }
          : {}),
      },
    })
  }

  return (
    <div class="ctxpack-browser-metadata-actions">
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
                  parallelPlan: props.summary.tags?.includes("ParallelPlan") ?? false,
                  sensitivity: props.summary.sensitivity,
                  revision: props.summary.revision,
                  error: null,
                })
              }}
            >
              {language.t(state.pending === "patch" ? "canvas.ctxpack.edit.patching" : "canvas.ctxpack.edit.patch")}
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
                  {language.t(
                    state.pending === "restore" ? "canvas.ctxpack.edit.restoring" : "canvas.ctxpack.edit.restore",
                  )}
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
                {language.t(state.pending === "remove" ? "canvas.ctxpack.edit.removing" : "canvas.ctxpack.edit.delete")}
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
          <label class="ctxpack-browser-filter ctxpack-browser-filter-toggle">
            <input
              name="parallelPlan"
              type="checkbox"
              checked={state.parallelPlan}
              disabled={state.pending !== null}
              onChange={(event) => setState("parallelPlan", event.currentTarget.checked)}
            />
            <span>{language.t("canvas.ctxpack.edit.parallelPlan")}</span>
          </label>
          <p class="ctxpack-browser-plan-hint">{language.t("canvas.ctxpack.edit.parallelPlanHint")}</p>
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
    </div>
  )
}
