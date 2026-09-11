import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useWorkspace } from "@/context/workspace"
import { useDirectoryPicker } from "./directory-picker"
import { getFilename } from "@opencode-ai/core/util/path"

export function DialogWorkspaceV2(props: { workspaceId?: string }) {
  const workspace = useWorkspace()
  const language = useLanguage()
  const dialog = useDialog()
  const server = useServer()
  const pickDirectory = useDirectoryPicker()

  const existing = () => workspace.list().find((item) => item.id === props.workspaceId)
  const [name, setName] = createSignal(existing()?.name ?? "")
  const [directories, setDirectories] = createSignal<string[]>(existing()?.directories ?? [])
  const [plugins, setPlugins] = createSignal<string[]>(existing()?.plugins ?? [])
  const [layout, setLayout] = createSignal(existing()?.layout ?? workspace.layout().id)
  const [pluginInput, setPluginInput] = createSignal("")

  function addDirectory() {
    const conn = server.current
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("workspace.environment.directories.add"),
      onSelect: (result) => {
        const picked = Array.isArray(result) ? result : result ? [result] : []
        setDirectories((current) => [...new Set([...current, ...picked])])
      },
    })
  }

  function removeDirectory(directory: string) {
    setDirectories((current) => current.filter((item) => item !== directory))
  }

  function addPlugin() {
    const value = pluginInput().trim()
    if (!value) return
    setPlugins((current) => [...new Set([...current, value])])
    setPluginInput("")
  }

  function removePlugin(plugin: string) {
    setPlugins((current) => current.filter((item) => item !== plugin))
  }

  function save() {
    const value = name().trim()
    if (!value) return
    const patch = {
      name: value,
      directories: directories(),
      plugins: plugins(),
      layout: layout(),
    }
    if (props.workspaceId) workspace.update(props.workspaceId, patch)
    else workspace.create(patch)
    dialog.close()
  }

  return (
    <Dialog class="dialog-workspace-v2">
      <DialogHeader>
        <DialogTitle>
          {props.workspaceId ? language.t("workspace.environment.edit") : language.t("workspace.environment.new")}
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="dialog-workspace-v2-body flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-v2-text-text-muted">{language.t("workspace.environment.name.label")}</div>
          <TextInputV2 value={name()} class="!w-full" onInput={(event) => setName(event.currentTarget.value)} />
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-v2-text-text-muted">
            {language.t("workspace.environment.environment.label")}
          </div>
          <SelectV2
            class="!w-full"
            options={workspace.options()}
            current={workspace.options().find((item) => item.id === layout())}
            value={(item) => item.id}
            label={(item) => item.name}
            onSelect={(item) => item && setLayout(item.id)}
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-v2-text-text-muted">
            {language.t("workspace.environment.directories.label")}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <For each={directories()}>
              {(directory) => (
                <button
                  type="button"
                  class="flex max-w-full items-center gap-1 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-12-regular text-v2-text-text-muted"
                  onClick={() => removeDirectory(directory)}
                  title={directory}
                >
                  <span class="min-w-0 truncate">{getFilename(directory)}</span>
                  <span>×</span>
                </button>
              )}
            </For>
            <button
              type="button"
              class="flex items-center gap-1 rounded-[4px] border border-dashed border-v2-border-border-base px-2 py-1 text-12-regular text-v2-text-text-faint"
              onClick={addDirectory}
            >
              + {language.t("workspace.environment.directories.add")}
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-v2-text-text-muted">{language.t("workspace.environment.plugins.label")}</div>
          <div class="flex flex-wrap gap-1.5">
            <For each={plugins()}>
              {(plugin) => (
                <button
                  type="button"
                  class="flex max-w-full items-center gap-1 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-12-regular text-v2-text-text-muted"
                  onClick={() => removePlugin(plugin)}
                >
                  <span class="min-w-0 truncate">{plugin}</span>
                  <span>×</span>
                </button>
              )}
            </For>
          </div>
          <TextInputV2
            value={pluginInput()}
            class="!w-full"
            placeholder={language.t("workspace.environment.plugins.placeholder")}
            onInput={(event) => setPluginInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addPlugin()
              }
            }}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!name().trim()} onClick={save}>
          {language.t("workspace.environment.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
