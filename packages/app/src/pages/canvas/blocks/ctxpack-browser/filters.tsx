/** @jsxImportSource solid-js */
import { For } from "solid-js"
import type { CtxPackBrowserCommand } from "./view-model"
import type { CtxPackListQuery, CtxPackSensitivity, CtxPackSourceKind } from "./types"

const SOURCE_KINDS: CtxPackSourceKind[] = [
  "message",
  "tool-output",
  "terminal",
  "file",
  "search",
  "note",
  "block-text",
]

const SENSITIVITIES: CtxPackSensitivity[] = ["public", "workspace", "private"]

export interface CtxPackFiltersProps {
  query: CtxPackListQuery
  dispatch(command: CtxPackBrowserCommand): Promise<void>
}

export function CtxPackFilters(props: CtxPackFiltersProps) {
  function setQuery(patch: Partial<CtxPackListQuery>): void {
    // Never mutate view.query directly — always dispatch, always reset the cursor.
    void props.dispatch({ type: "set-query", patch: { ...patch, cursor: null } })
  }

  function dateToTimestamp(value: string): number | null {
    if (value === "") return null
    const time = new Date(value).getTime()
    return Number.isNaN(time) ? null : time
  }

  function dateValue(timestamp: number | null): string {
    return timestamp == null ? "" : new Date(timestamp).toISOString().slice(0, 10)
  }

  return (
    <div class="ctxpack-browser-filters">
      <label class="ctxpack-browser-filter">
        <span>Source kind</span>
        <select
          aria-label="Source kind"
          value={props.query.sourceKind ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value
            setQuery({ sourceKind: (value === "" ? null : value) as CtxPackSourceKind | null })
          }}
        >
          <option value="">Any source</option>
          <For each={SOURCE_KINDS}>{(kind) => <option value={kind}>{kind}</option>}</For>
        </select>
      </label>

      <label class="ctxpack-browser-filter">
        <span>Sensitivity</span>
        <select
          aria-label="Sensitivity"
          value={props.query.sensitivity ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value
            setQuery({ sensitivity: (value === "" ? null : value) as CtxPackSensitivity | null })
          }}
        >
          <option value="">Any</option>
          <For each={SENSITIVITIES}>{(sensitivity) => <option value={sensitivity}>{sensitivity}</option>}</For>
        </select>
      </label>

      <label class="ctxpack-browser-filter">
        <span>Keyword</span>
        <input
          type="text"
          aria-label="Keyword"
          placeholder="Filter by keyword"
          value={props.query.keyword ?? ""}
          onInput={(event) => {
            const value = event.currentTarget.value
            setQuery({ keyword: value === "" ? null : value })
          }}
        />
      </label>

      <label class="ctxpack-browser-filter">
        <span>Created after</span>
        <input
          type="date"
          aria-label="Created after"
          value={dateValue(props.query.createdAfter)}
          onChange={(event) => setQuery({ createdAfter: dateToTimestamp(event.currentTarget.value) })}
        />
      </label>

      <label class="ctxpack-browser-filter">
        <span>Created before</span>
        <input
          type="date"
          aria-label="Created before"
          value={dateValue(props.query.createdBefore)}
          onChange={(event) => setQuery({ createdBefore: dateToTimestamp(event.currentTarget.value) })}
        />
      </label>

      <label class="ctxpack-browser-filter ctxpack-browser-filter-toggle">
        <input
          type="checkbox"
          aria-label="Include deleted"
          checked={props.query.includeDeleted}
          onChange={(event) => setQuery({ includeDeleted: event.currentTarget.checked })}
        />
        <span>Include deleted</span>
      </label>
    </div>
  )
}
