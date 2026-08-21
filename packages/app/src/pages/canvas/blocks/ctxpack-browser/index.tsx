/** @jsxImportSource solid-js */
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { CtxPackCard } from "./ctxpack-card"
import { CtxPackDetail } from "./ctxpack-detail"
import { CtxPackFilters } from "./filters"
import type { CtxPackBrowserProps } from "./view-model"
import type { CtxPackListQuery, CtxPackSort } from "./types"
import "./ctxpack-browser.css"

const SEARCH_DEBOUNCE_MS = 200

const SORT_OPTIONS: { value: CtxPackSort; label: string }[] = [
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
  { value: "updated-desc", label: "Recently updated" },
  { value: "title-asc", label: "Title A–Z" },
  { value: "tokens-desc", label: "Largest first" },
  { value: "most-attached", label: "Most attached" },
  { value: "recently-attached", label: "Recently attached" },
]

export function CtxPackBrowser(props: CtxPackBrowserProps) {
  const view = props.view
  const [searchText, setSearchText] = createSignal(view().query.query)
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchDirty = false

  function setQuery(patch: Partial<CtxPackListQuery>): void {
    // Never mutate view.query directly — always dispatch, always reset the cursor.
    void props.dispatch({ type: "set-query", patch: { ...patch, cursor: null } })
  }

  // Keep the search box in sync when the query changes from outside (e.g. resets).
  createEffect(() => {
    const query = view().query.query
    if (!searchDirty && query !== searchText()) setSearchText(query)
  })

  function onSearchInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value
    searchDirty = true
    setSearchText(value)
    if (searchTimer !== undefined) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchDirty = false
      void props.dispatch({ type: "set-query", patch: { query: value, cursor: null } })
    }, SEARCH_DEBOUNCE_MS)
  }

  onCleanup(() => {
    if (searchTimer !== undefined) clearTimeout(searchTimer)
  })

  const visibleItems = () =>
    view().items.filter((item) => view().query.includeDeleted || item.deletedAt == null)

  const hasActiveQuery = () =>
    view().query.query.trim() !== "" ||
    view().query.keyword != null ||
    view().query.sourceBlockID != null ||
    view().query.sourceFunctionalityID != null ||
    view().query.sourceKind != null ||
    view().query.sensitivity != null ||
    view().query.createdAfter != null ||
    view().query.createdBefore != null ||
    view().query.includeDeleted

  return (
    <div class="ctxpack-browser" data-component="ctxpack-browser" data-status={view().status}>
      <Switch>
        <Match when={view().status === "loading"}>
          <div class="ctxpack-browser-skeleton" role="status" aria-busy="true">
            <div class="ctxpack-browser-skeleton-line" />
            <div class="ctxpack-browser-skeleton-line" />
            <div class="ctxpack-browser-skeleton-line" />
            <div class="ctxpack-browser-skeleton-line" />
          </div>
        </Match>

        <Match when={view().status === "permission-denied"}>
          <div class="ctxpack-browser-message" role="alert">
            <p class="ctxpack-browser-message-title">Permission denied</p>
            <p>You do not have permission to view context packs in this workspace.</p>
            <Show when={view().errorCode != null}>
              <code class="ctxpack-browser-error-code">{view().errorCode}</code>
            </Show>
          </div>
        </Match>

        <Match when={view().status === "unavailable"}>
          <div class="ctxpack-browser-message">
            <p class="ctxpack-browser-message-title">Context packs unavailable</p>
            <p>Context packs are not available in this workspace.</p>
          </div>
        </Match>

        <Match when={view().status === "error"}>
          <div class="ctxpack-browser-message" role="alert">
            <p class="ctxpack-browser-message-title">Something went wrong</p>
            <p>Context packs could not be loaded.</p>
            <Show when={view().errorCode != null}>
              <code class="ctxpack-browser-error-code">{view().errorCode}</code>
            </Show>
          </div>
        </Match>

        <Match when={view().status === "ready" || view().status === "stale"}>
          <Show
            when={view().selected == null}
            fallback={
              view().selected != null ? (
                <CtxPackDetail
                  info={view().selected!}
                  dispatch={props.dispatch}
                  createDragPayload={props.createDragPayload}
                  attachToFocusedInput={props.attachToFocusedInput}
                />
              ) : null
            }
          >
            <div class="ctxpack-browser-main">
              <Show when={view().status === "stale"}>
                <div class="ctxpack-browser-stale" role="status" aria-label="stale data">
                  Stale — results may be out of date
                </div>
              </Show>

              <div class="ctxpack-browser-toolbar">
                <input
                  class="ctxpack-browser-search"
                  type="search"
                  placeholder="Search context packs…"
                  aria-label="Search context packs"
                  value={searchText()}
                  onInput={onSearchInput}
                />
                <label class="ctxpack-browser-filter ctxpack-browser-sort">
                  <span>Sort</span>
                  <select
                    aria-label="Sort"
                    value={view().query.sort}
                    onChange={(event) => setQuery({ sort: event.currentTarget.value as CtxPackSort })}
                  >
                    <For each={SORT_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                  </select>
                </label>
              </div>

              <CtxPackFilters query={view().query} dispatch={props.dispatch} />

              <Show
                when={visibleItems().length > 0}
                fallback={
                  <div class="ctxpack-browser-empty" role="status">
                    <Show when={hasActiveQuery()} fallback={<p>No context packs yet.</p>}>
                      <p>No context packs match your filters.</p>
                    </Show>
                  </div>
                }
              >
                <div class="ctxpack-browser-grid">
                  <For each={visibleItems()}>
                    {(item) => <CtxPackCard summary={item} view={props.view} dispatch={props.dispatch} />}
                  </For>
                </div>
              </Show>

              <Show when={view().nextCursor != null}>
                <button
                  type="button"
                  class="ctxpack-browser-btn ctxpack-browser-load-more"
                  disabled={view().loadingMore}
                  aria-busy={view().loadingMore}
                  onClick={() => void props.dispatch({ type: "load-more" })}
                >
                  <Show when={view().loadingMore} fallback="Load more">
                    <span class="ctxpack-browser-spinner" role="status" aria-label="Loading more" />
                  </Show>
                </button>
              </Show>
            </div>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

export default CtxPackBrowser
