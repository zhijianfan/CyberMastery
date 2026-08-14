import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkspace } from "@/context/workspace"
import { DialogWorkspaceV2 } from "./dialog-workspace-v2"

export function WorkspaceSwitcher() {
  const workspace = useWorkspace()
  const dialog = useDialog()
  const language = useLanguage()

  const openNew = () => dialog.show(() => <DialogWorkspaceV2 />)
  const openEdit = () => {
    const active = workspace.active()
    if (!active) return
    dialog.show(() => <DialogWorkspaceV2 workspaceId={active.id} />)
  }
  const removeActive = () => {
    const active = workspace.active()
    if (active) workspace.remove(active.id)
  }

  return (
    <MenuV2 gutter={4} modal={false} placement="bottom-start">
      <MenuV2.Trigger
        class="flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-14-medium text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed"
        aria-label={language.t("workspace.environment.title")}
      >
        <span class="min-w-0 truncate">
          {workspace.active()?.name ?? language.t("workspace.environment.none")}
        </span>
        <Show when={workspace.active()}>
          {(active) => (
            <span class="shrink-0 rounded-[4px] border border-v2-border-border-base px-1 py-px text-11-regular text-v2-text-text-muted">
              {workspace.layoutName(active().layout)}
            </span>
          )}
        </Show>
        <span class="shrink-0 text-v2-text-text-muted">▾</span>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("workspace.environment.title")}</MenuV2.GroupLabel>
            <MenuV2.RadioGroup
              value={workspace.active()?.id ?? ""}
              onChange={(value) => {
                if (value) workspace.select(value)
              }}
            >
              <For each={workspace.list()}>
                {(item) => (
                  <MenuV2.RadioItem value={item.id} badge={workspace.layoutName(item.layout)}>
                    {item.name}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
            <Show when={!workspace.list().length}>
              <div class="px-3 py-2 text-12-regular text-v2-text-text-faint">
                {language.t("workspace.environment.none.description")}
              </div>
            </Show>
          </MenuV2.Group>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={openNew}>{language.t("workspace.environment.new")}</MenuV2.Item>
          <MenuV2.Item onSelect={openEdit} disabled={!workspace.active()}>
            {language.t("workspace.environment.edit")}
          </MenuV2.Item>
          <MenuV2.Item onSelect={removeActive} disabled={!workspace.active()}>
            {language.t("workspace.environment.delete")}
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
