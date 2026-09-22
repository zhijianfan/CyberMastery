import { createEffect, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import { Schema } from "effect"
import { useServerSDK } from "@/context/server-sdk"
import type { createCanvasTabClient } from "@/utils/canvas-tab-client"

export type CanvasTabClient = Pick<
  ReturnType<typeof createCanvasTabClient>,
  "listOwned" | "listArchived" | "create" | "select" | "restore"
>
export type CanvasTabController = ReturnType<typeof createCanvasTabController>

export function useCanvasTabController(input: {
  workspaceID: Accessor<string | undefined>
  kind: CanvasTab.Kind
  blockID: Accessor<string>
}) {
  const sdk = useServerSDK()
  const tabs = createCanvasTabController(input.workspaceID, input.kind, input.blockID, () => sdk().canvasTabClient)
  createEffect(() => {
    const workspaceID = input.workspaceID()
    if (!workspaceID) return
    onCleanup(
      sdk().event.listen((entry) => {
        const event = entry.details as { type: string; properties?: { workspaceID?: string; kind?: string } }
        if (
          event.type === "server.connected" ||
          (event.type === "workspace.canvas-tab.changed" &&
            event.properties?.workspaceID === workspaceID &&
            event.properties.kind === input.kind)
        )
          void tabs.retry()
      }),
    )
  })
  return tabs
}

export function createCanvasTabController(
  workspaceID: Accessor<string | undefined>,
  kind: CanvasTab.Kind,
  blockID: Accessor<string>,
  client: Accessor<CanvasTabClient>,
) {
  const [state, setState] = createStore({
    owned: [] as CanvasTab.Entry[],
    archived: [] as CanvasTab.Entry[],
    selectedID: undefined as string | undefined,
    revision: 0,
    bindingRevision: undefined as number | undefined,
    ownedNext: null as CanvasTab.Cursor | null,
    archivedNext: null as CanvasTab.Cursor | null,
    search: "",
    error: undefined as unknown,
    loading: false,
    pending: false,
  })
  let generation = 0
  let requestID: string | undefined
  let disposed = false
  const params = () => ({ workspaceID: workspaceID()!, kind, blockID: blockID() })
  const decode = Schema.decodeUnknownSync(CanvasTab.Entry)
  const merge = (old: readonly CanvasTab.Entry[], next: readonly CanvasTab.Entry[]) => [
    ...new Map([...old, ...next].map((item) => [item.id, item])).values(),
  ]
  const read = async (more = false) => {
    if (!workspaceID()) return
    const current = ++generation
    setState({ loading: true })
    const result = await Promise.all([
      more && !state.ownedNext
        ? undefined
        : client().listOwned({
            ...params(),
            cursor: more && state.ownedNext ? JSON.stringify(state.ownedNext) : undefined,
            limit: 50,
          }),
      more && !state.archivedNext
        ? undefined
        : client().listArchived({
            ...params(),
            search: state.search || undefined,
            cursor: more && state.archivedNext ? JSON.stringify(state.archivedNext) : undefined,
            limit: 50,
          }),
    ])
      .then(async ([owned, archived]) => {
        if (disposed || current !== generation) return
        if (owned && owned.revision >= state.revision)
          setState({
            owned: merge(
              more ? state.owned : state.owned.filter((item) => item.id === owned.selectedTabID),
              owned.items.map((item) => decode(item)),
            ),
            ownedNext: owned.next,
            selectedID: owned.selectedTabID ?? undefined,
            revision: owned.revision,
            bindingRevision: owned.bindingRevision,
          })
        if (archived)
          setState({
            archived: merge(
              more ? state.archived : [],
              archived.items.map((item) => decode(item)),
            ),
            archivedNext: archived.next,
          })
        setState({ error: undefined, loading: false })
        // A selected conversation can be older than the first history page.
        // Resolve only its metadata without advancing the menu's paging cursor.
        if (!owned?.selectedTabID || state.owned.some((item) => item.id === owned.selectedTabID)) return
        let cursor = owned.next
        const seen = new Set<string>()
        while (cursor && !disposed && current === generation) {
          const key = JSON.stringify(cursor)
          if (seen.has(key)) return
          seen.add(key)
          const page = await client().listOwned({ ...params(), cursor: key, limit: 50 })
          if (disposed || current !== generation || page.revision !== state.revision) return
          const selected = page.items.find((item) => item.id === owned.selectedTabID)
          if (selected) {
            setState({ owned: merge(state.owned, [decode(selected)]) })
            return
          }
          cursor = page.next
        }
      })
      .catch((error: unknown) => {
        if (!disposed && current === generation) setState({ error })
      })
    if (!disposed && current === generation) setState({ loading: false })
    return result
  }
  const mutate = async (action: "create" | "select" | "restore", entry?: CanvasTab.Entry) => {
    if (!workspaceID() || state.pending || state.loading) return
    setState({ pending: true, error: undefined })
    const owner = JSON.stringify(params())
    const input = { ...params(), expectedRevision: state.revision, expectedBindingRevision: state.bindingRevision }
    if (action === "create") requestID ??= crypto.randomUUID()
    const expectedID = action === "create" ? requestID! : entry!.id
    await (
      action === "create"
        ? client().create({ ...input, requestID: expectedID })
        : client()[action]({ ...input, tabID: expectedID })
    ).then(
      async (result) => {
        if (disposed || owner !== JSON.stringify(params())) return
        generation++
        const selected = decode(result.selected)
        if (result.revision >= state.revision)
          setState({
            owned: merge(state.owned, [selected]),
            archived: state.archived.filter((item) => item.id !== selected.id),
            selectedID: selected.id,
            revision: result.revision,
            bindingRevision: result.bindingRevision,
          })
        if (action === "create") requestID = undefined
        await read()
      },
      async (error: unknown) => {
        if (disposed || owner !== JSON.stringify(params())) return
        await read()
        if (action === "create" && state.owned.some((item) => item.id === expectedID)) {
          requestID = undefined
          setState({ error: undefined })
          return
        }
        setState({ error })
      },
    )
    if (!disposed && owner === JSON.stringify(params())) setState({ pending: false })
  }
  createEffect(() => {
    workspaceID()
    blockID()
    client()
    generation++
    requestID = undefined
    setState({
      owned: [],
      archived: [],
      selectedID: undefined,
      revision: 0,
      bindingRevision: undefined,
      pending: false,
    })
    untrack(() => void read())
  })
  onCleanup(() => {
    disposed = true
    generation++
  })
  return {
    owned: () => state.owned,
    archived: () => state.archived,
    selectedID: () => state.selectedID,
    selected: () => state.owned.find((item) => item.id === state.selectedID),
    search: () => state.search,
    error: () => state.error,
    loading: () => state.loading,
    pending: () => state.pending,
    create: () => mutate("create"),
    select: (entry: CanvasTab.Entry) => mutate("select", entry),
    restore: (entry: CanvasTab.Entry) => mutate("restore", entry),
    loadMore: () => read(true),
    retry: () => read(),
    setSearch: (search: string) => {
      setState({ search })
      void read()
    },
  }
}
