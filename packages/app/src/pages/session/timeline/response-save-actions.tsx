import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"

export function ResponseSaveActions(props: {
  onSave(options: { details: boolean }): Promise<void> | void
  onAddToDraft?(): void
  open?: boolean
  onOpenChange?(open: boolean): void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ pending: false })
  const save = async () => {
    if (state.pending) return
    setState("pending", true)
    try {
      await props.onSave({ details: false })
    } finally {
      setState("pending", false)
    }
  }

  return (
    <>
      <TooltipV2 value={language.t("canvas.ctxpack.saveResponse")} placement="top" gutter={4}>
        <IconButtonV2
          icon={<Icon name="archive" size="small" />}
          size="normal"
          variant="ghost-muted"
          style={{ "flex-shrink": 0 }}
          data-action="save-response-ctxpack"
          aria-label={language.t("canvas.ctxpack.saveResponse")}
          aria-busy={state.pending}
          disabled={state.pending}
          onMouseDown={(event) => event.preventDefault()}
          onClick={save}
        />
      </TooltipV2>
      <MenuV2 placement="bottom-start" gutter={4} open={props.open} onOpenChange={props.onOpenChange}>
        <MenuV2.Trigger
          as={IconButtonV2}
          icon={<Icon name="outline-dots" size="small" style={{ transform: "rotate(90deg)" }} />}
          size="normal"
          variant="ghost-muted"
          style={{ "flex-shrink": 0 }}
          data-action="save-response-options"
          aria-label={language.t("canvas.ctxpack.saveOptions")}
          disabled={state.pending}
        />
        <MenuV2.Portal>
          <MenuV2.Content class="[&[data-closed]]:!animate-none">
            <MenuV2.Item onSelect={() => props.onSave({ details: true })}>
              {language.t("canvas.ctxpack.saveWithDetails")}
            </MenuV2.Item>
            <Show when={props.onAddToDraft}>
              <MenuV2.Item onSelect={() => props.onAddToDraft?.()}>
                {language.t("canvas.ctxpack.addToDraft")}
              </MenuV2.Item>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </>
  )
}
