import { Dialog } from "@kobalte/core/dialog"
import { DialogV2, DialogHeader, DialogTitleGroup, DialogBody, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createComponent, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"

export function ArchiveWorkspaceDialog(props: { name: string; confirm: () => Promise<void>; close: () => void }) {
  const language = useLanguage()
  const [state, setState] = createStore({ pending: false, failed: false })

  async function confirm() {
    if (state.pending) return
    setState({ pending: true, failed: false })
    try {
      await props.confirm()
      props.close()
    } catch {
      setState("failed", true)
    } finally {
      setState("pending", false)
    }
  }

  return createComponent(Dialog, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open && !state.pending) props.close()
    },
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
                  title={language.t("canvas.workspace.archive.title")}
                  description={language.t("canvas.workspace.archive.confirm", { name: props.name })}
                />
              </DialogHeader>
              <DialogBody>
                <p>{language.t("canvas.workspace.archive.description")}</p>
                <Show when={state.failed}>
                  <p role="alert">{language.t("canvas.workspace.archive.error")}</p>
                </Show>
              </DialogBody>
              <DialogFooter>
                <ButtonV2 variant="ghost" disabled={state.pending} onClick={props.close}>
                  {language.t("common.cancel")}
                </ButtonV2>
                <ButtonV2 variant="danger" disabled={state.pending} onClick={() => void confirm()}>
                  {language.t("canvas.workspace.archive.action")}
                </ButtonV2>
              </DialogFooter>
            </DialogV2>
          </div>
        </Dialog.Portal>
      )
    },
  })
}
