import { type Accessor, createSignal, type JSX, Show } from "solid-js"

export function createModelRefreshState(onRefresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal(false)
  const refresh = () => {
    if (refreshing()) return Promise.resolve()
    setRefreshError(false)
    setRefreshing(true)
    return onRefresh()
      .then(
        () => undefined,
        () => setRefreshError(true),
      )
      .finally(() => setRefreshing(false))
  }
  return { refreshing, refreshError, refresh }
}

export function ModelRefreshAction(props: {
  refreshing: Accessor<boolean>
  refreshError: Accessor<boolean>
  onRefresh: () => void
  t: (key: "canvas.model.refresh" | "canvas.model.refreshing" | "canvas.model.refresh.error") => string
}) {
  return (() => (
    <div>
      <button
        type="button"
        class="canvas-model-picker-refresh"
        disabled={props.refreshing()}
        onClick={props.onRefresh}
      >
        {props.t(props.refreshing() ? "canvas.model.refreshing" : "canvas.model.refresh")}
      </button>
      <Show when={props.refreshError()}>
        <div class="canvas-model-picker-refresh-error" role="alert">
          {props.t("canvas.model.refresh.error")}
        </div>
      </Show>
    </div>
  )) as unknown as JSX.Element
}
