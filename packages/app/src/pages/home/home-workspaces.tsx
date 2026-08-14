import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkspace } from "@/context/workspace"
import { DialogWorkspaceV2 } from "@/components/dialog-workspace-v2"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { getFilename } from "@opencode-ai/core/util/path"

export function HomeWorkspaces() {
  const workspace = useWorkspace()
  const dialog = useDialog()
  const language = useLanguage()

  const openNew = () => dialog.show(() => <DialogWorkspaceV2 />)
  const openEdit = () => {
    const active = workspace.active()
    if (!active) return
    dialog.show(() => <DialogWorkspaceV2 workspaceId={active.id} />)
  }

  return (
    <section class="flex min-w-0 flex-col gap-3" aria-label={language.t("workspace.environment.title")}>
      <WorkspaceSwitcher />
      <div class="flex flex-col gap-1">
        <For each={workspace.list()}>
          {(item) => {
            const active = () => workspace.active()?.id === item.id
            return (
              <button
                type="button"
                data-active={active() ? "" : undefined}
                class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-14-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover data-[active]:text-v2-text-text-base"
                onClick={() => workspace.select(item.id)}
              >
                <span class="min-w-0 flex-1 truncate">{item.name}</span>
                <span class="shrink-0 rounded-[4px] border border-v2-border-border-base px-1 py-px text-11-regular text-v2-text-text-faint">
                  {workspace.environmentName(item.environment)}
                </span>
                <span class="shrink-0 text-11-regular text-v2-text-text-faint">{item.directories.length}</span>
              </button>
            )
          }}
        </For>
      </div>
      <Show when={!workspace.list().length}>
        <div class="flex flex-col items-start gap-2 rounded-md border border-dashed border-v2-border-border-base p-3">
          <div class="text-12-regular text-v2-text-text-faint">
            {language.t("workspace.environment.none.description")}
          </div>
          <ButtonV2 size="small" onClick={openNew}>
            {language.t("workspace.environment.new")}
          </ButtonV2>
        </div>
      </Show>
      <Show when={workspace.active()}>
        {(active) => (
          <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base p-3">
            <div class="flex items-center justify-between">
              <div class="text-12-regular text-v2-text-text-faint">
                {workspace.environmentName(active().environment)}
              </div>
              <ButtonV2 size="small" variant="ghost-muted" onClick={openEdit}>
                {language.t("workspace.environment.edit")}
              </ButtonV2>
            </div>
            <Show when={active().directories.length}>
              <div class="flex flex-col gap-1">
                <For each={active().directories}>
                  {(directory) => (
                    <div class="flex items-center gap-1.5 text-12-regular text-v2-text-text-muted" title={directory}>
                      <span class="shrink-0 text-v2-text-text-faint">/</span>
                      <span class="min-w-0 truncate">{getFilename(directory)}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={active().plugins.length}>
              <div class="flex flex-wrap gap-1">
                <For each={active().plugins}>
                  {(plugin) => (
                    <span class="rounded-[4px] border border-v2-border-border-base px-1.5 py-px text-11-regular text-v2-text-text-muted">
                      {plugin}
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </section>
  )
}
