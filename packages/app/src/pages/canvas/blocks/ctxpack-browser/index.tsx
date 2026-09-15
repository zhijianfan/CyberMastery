import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"
import { CtxPackCard } from "./ctxpack-card"
import { CtxPackDetail } from "./ctxpack-detail"
import { CtxPackFilters } from "./filters"
import type { CtxPackBrowserProps, CtxPackBrowserView } from "./view-model"
import type { CtxPackListQuery, CtxPackSort } from "./types"
import type { dict } from "@/i18n/en"
import "./ctxpack-browser.css"

const SEARCH_DEBOUNCE_MS = 200

const SORT_OPTIONS: { value: CtxPackSort; label: keyof typeof dict }[] = [
  { value: "created-desc", label: "canvas.ctxpack.browser.sort.createdDesc" },
  { value: "created-asc", label: "canvas.ctxpack.browser.sort.createdAsc" },
  { value: "updated-desc", label: "canvas.ctxpack.browser.sort.updatedDesc" },
  { value: "title-asc", label: "canvas.ctxpack.browser.sort.titleAsc" },
  { value: "tokens-desc", label: "canvas.ctxpack.browser.sort.tokensDesc" },
  { value: "most-attached", label: "canvas.ctxpack.browser.sort.mostAttached" },
  { value: "recently-attached", label: "canvas.ctxpack.browser.sort.recentlyAttached" },
]

type BrowserPanel = "pinned" | "search"

export function CtxPackBrowser(props: CtxPackBrowserProps) {
  const language = useLanguage()
  const view = props.view
  const [panel, setPanel] = createSignal<BrowserPanel>("pinned")
  const [searchText, setSearchText] = createSignal(view().query.query)
  const [searchPaging, setSearchPaging] = createSignal(false)
  const [pinnedPaging, setPinnedPaging] = createSignal(false)
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchDirty = false

  function setQuery(patch: Partial<CtxPackListQuery>): void {
    void props.dispatch({ type: "set-query", patch: { ...patch, cursor: null } })
  }

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

  const visibleItems = () => view().items.filter((item) => view().query.includeDeleted || item.deletedAt == null)
  const pinnedItems = () => [...view().pinnedItems].sort((left, right) => right.createdAt - left.createdAt)
  const loadingMore = () => view().loadingMore || searchPaging()
  const loadingMorePinned = () => view().loadingMorePinned || pinnedPaging()
  function loadMore(): void {
    if (loadingMore()) return
    setSearchPaging(true)
    void props.dispatch({ type: "load-more" }).then(
      () => setSearchPaging(false),
      () => setSearchPaging(false),
    )
  }
  function loadMorePinned(): void {
    if (loadingMorePinned()) return
    setPinnedPaging(true)
    void props.dispatch({ type: "load-more-pinned" }).then(
      () => setPinnedPaging(false),
      () => setPinnedPaging(false),
    )
  }
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
          <Show when={view().status === "stale"}>
            <div class="ctxpack-browser-stale" role="status" aria-label="stale data">
              Stale — results may be out of date
            </div>
          </Show>

          <Tabs
            value={panel()}
            onChange={(value) => setPanel(value as BrowserPanel)}
            class="ctxpack-browser-tabs-root"
            variant="pill"
          >
            <Tabs.List class="ctxpack-browser-tabs" aria-label={language.t("canvas.ctxpack.browser.tabsLabel")}>
              <Tabs.Trigger value="pinned" classes={{ button: "ctxpack-browser-tab" }}>
                {language.t("canvas.ctxpack.browser.tab.pinned")}
              </Tabs.Trigger>
              <Tabs.Trigger value="search" classes={{ button: "ctxpack-browser-tab" }}>
                {language.t("canvas.ctxpack.browser.tab.search")}
              </Tabs.Trigger>
            </Tabs.List>

            <Show
              when={view().selected == null}
              fallback={
                view().selected != null ? (
                  <CtxPackDetail
                    info={view().selected!}
                    view={view}
                    dispatch={props.dispatch}
                    createDragPayload={props.createDragPayload}
                    attachToFocusedInput={props.attachToFocusedInput}
                  />
                ) : null
              }
            >
              <Tabs.Content value="search" class="ctxpack-browser-main ctxpack-browser-panel">
                <div class="ctxpack-browser-search-panel">
                  <div class="ctxpack-browser-toolbar">
                    <input
                      class="ctxpack-browser-search"
                      type="search"
                      placeholder={language.t("canvas.ctxpack.browser.search.placeholder")}
                      aria-label={language.t("canvas.ctxpack.browser.search.label")}
                      value={searchText()}
                      onInput={onSearchInput}
                    />
                    <label class="ctxpack-browser-filter ctxpack-browser-sort">
                      <span>{language.t("canvas.ctxpack.browser.sort")}</span>
                      <select
                        aria-label={language.t("canvas.ctxpack.browser.sort")}
                        value={view().query.sort}
                        onChange={(event) => setQuery({ sort: event.currentTarget.value as CtxPackSort })}
                      >
                        <For each={SORT_OPTIONS}>
                          {(option) => <option value={option.value}>{language.t(option.label)}</option>}
                        </For>
                      </select>
                    </label>
                  </div>

                  <CtxPackFilters query={view().query} dispatch={props.dispatch} />

                  <Show
                    when={visibleItems().length > 0}
                    fallback={
                      <div class="ctxpack-browser-empty" role="status">
                        <p>
                          {language.t(hasActiveQuery() ? "canvas.ctxpack.browser.emptySearch" : "canvas.ctxpack.browser.emptyAll")}
                        </p>
                      </div>
                    }
                  >
                    <div class="ctxpack-browser-grid">
                      <For each={visibleItems()}>
                        {(summary) => (
                          <CtxPackCard
                            summary={summary}
                            view={props.view}
                            dispatch={props.dispatch}
                            createDragPayload={props.createDragPayload}
                          />
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={view().nextCursor != null}>
                    <button
                      type="button"
                      class="ctxpack-browser-btn ctxpack-browser-load-more"
                      disabled={loadingMore()}
                      aria-busy={loadingMore()}
                      onClick={loadMore}
                    >
                      <Show when={loadingMore()} fallback={language.t("canvas.ctxpack.browser.loadMore")}>
                        <span
                          class="ctxpack-browser-spinner"
                          role="status"
                          aria-label={language.t("canvas.ctxpack.browser.loadingMore")}
                        />
                      </Show>
                    </button>
                  </Show>
                </div>
              </Tabs.Content>

              <Tabs.Content value="pinned" class="ctxpack-browser-main ctxpack-browser-panel">
                <div class="ctxpack-browser-pinned-panel">
                  <Show
                    when={pinnedItems().length > 0}
                    fallback={
                      <div class="ctxpack-browser-empty" role="status">
                        <p>{language.t("canvas.ctxpack.browser.emptyPinned")}</p>
                      </div>
                    }
                  >
                    <div class="ctxpack-browser-grid">
                      <For each={pinnedItems()}>
                        {(summary) => (
                          <CtxPackCard
                            summary={summary}
                            view={props.view}
                            dispatch={props.dispatch}
                            createDragPayload={props.createDragPayload}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={view().pinnedNextCursor != null}>
                    <button
                      type="button"
                      class="ctxpack-browser-btn ctxpack-browser-load-more"
                      disabled={loadingMorePinned()}
                      aria-busy={loadingMorePinned()}
                      onClick={loadMorePinned}
                    >
                      <Show when={loadingMorePinned()} fallback={language.t("canvas.ctxpack.browser.loadMorePinned")}>
                        <span
                          class="ctxpack-browser-spinner"
                          role="status"
                          aria-label={language.t("canvas.ctxpack.browser.loadingMore")}
                        />
                      </Show>
                    </button>
                  </Show>
                </div>
              </Tabs.Content>
            </Show>
          </Tabs>
        </Match>
      </Switch>
    </div>
  )
}

export default CtxPackBrowser
