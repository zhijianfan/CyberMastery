import { Dialog } from "@kobalte/core/dialog"
import { DialogV2, DialogHeader, DialogTitleGroup, DialogBody, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Show, createComponent, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { CanvasTab } from "@opencode-ai/schema/canvas-tab"
import type { createCanvasTabClient } from "@/utils/canvas-tab-client"

export function ArchiveBlockDialog(props: {
  workspaceID: string
  blockID: string
  kind: CanvasTab.Kind
  client: Pick<ReturnType<typeof createCanvasTabClient>, "listOwned">
  confirm: (revision: number) => Promise<void>
  close: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    pending: false,
    failed: false,
    count: 0,
    revision: undefined as number | undefined,
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const kind = () =>
    language.t(
      props.kind === "master-agent"
        ? "canvas.tabs.kind.master"
        : props.kind === "operating-chat"
          ? "canvas.tabs.kind.operating"
          : "canvas.tabs.kind.relay",
    )
  async function load() {
    setState({ loading: true, revision: undefined })
    const ids = new Set<string>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    let revision: number | undefined
    try {
      do {
        const page = await props.client.listOwned({
          workspaceID: props.workspaceID,
          kind: props.kind,
          blockID: props.blockID,
          limit: 50,
          cursor,
        })
        if (disposed) return
        if (revision !== undefined && revision !== page.revision)
          throw new Error("Session registry changed while counting")
        revision = page.revision
        page.items.forEach((tab) => ids.add(tab.id))
        cursor = page.next ? JSON.stringify(page.next) : undefined
        if (cursor && cursors.has(cursor)) throw new Error("Repeated session cursor")
        if (cursor) cursors.add(cursor)
      } while (cursor)
      setState({ count: ids.size, revision })
    } catch {
      if (!disposed) setState("failed", true)
    } finally {
      if (!disposed) setState("loading", false)
    }
  }
  onMount(() => void load())
  async function confirm() {
    if (state.pending || state.loading || state.revision === undefined) return
    setState({ pending: true, failed: false })
    try {
      await props.confirm(state.revision)
      if (!disposed) props.close()
    } catch {
      if (disposed) return
      setState("failed", true)
      await load()
    } finally {
      if (!disposed) setState("pending", false)
    }
  }
  return createComponent(Dialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open && !state.pending) props.close()
    },
    // Lazy child: the portal and overlay consume the dialog root's context, so
    // a getter defers creating them until the provider resolves its children.
    get children() {
      return (
        <Dialog.Portal>
          <Dialog.Overlay data-component="dialog-overlay" style={{ "z-index": "100" }} />
          <div
            style={{
              position: "fixed",
              inset: "0",
              "z-index": "100",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "pointer-events": "none",
            }}
          >
            <DialogV2 fit>
              <DialogHeader hideClose>
                <DialogTitleGroup
                  title={language.t("canvas.tabs.remove.title")}
                  description={language.t("canvas.tabs.remove.description", { kind: kind() })}
                />
              </DialogHeader>
              <DialogBody>
                <p aria-live="polite">
                  {state.loading
                    ? language.t("canvas.tabs.loading")
                    : language.t("canvas.tabs.remove.count", { count: state.count })}
                </p>
                <Show when={state.failed}>
                  <p role="alert">{language.t("canvas.tabs.remove.error")}</p>
                </Show>
                <Show when={state.failed && state.revision === undefined}>
                  <ButtonV2 variant="ghost" disabled={state.loading || state.pending} onClick={() => void load()}>
                    {language.t("canvas.tabs.retry")}
                  </ButtonV2>
                </Show>
              </DialogBody>
              <DialogFooter>
                <ButtonV2 variant="ghost" disabled={state.pending} onClick={props.close}>
                  {language.t("common.cancel")}
                </ButtonV2>
                <ButtonV2
                  variant="danger"
                  disabled={state.loading || state.pending || state.revision === undefined}
                  onClick={() => void confirm()}
                >
                  {language.t("canvas.tabs.remove.confirm")}
                </ButtonV2>
              </DialogFooter>
            </DialogV2>
          </div>
        </Dialog.Portal>
      )
    },
  })
}
