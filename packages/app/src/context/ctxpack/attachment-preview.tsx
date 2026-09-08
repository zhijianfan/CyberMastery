import { createResource, For, onCleanup, Show } from "solid-js"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"

export function CtxPackAttachmentPreview(props: { workspaceID: string; ctxPackID: string }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const [pack] = createResource(
    () => ({ client: serverSDK().client, workspaceID: props.workspaceID, ctxPackID: props.ctxPackID }),
    (input) =>
      input.client.v2.workspace.ctxpack
        .get(
          { workspaceID: input.workspaceID, ctxPackID: input.ctxPackID },
          { signal: controller.signal, throwOnError: true },
        )
        .then((result) => result.data)
        .catch(() => null),
  )

  return (
    <Dialog size="large">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>
          {pack.loading
            ? language.t("prompt.ctxpack.preview.title")
            : (pack()?.title ?? language.t("prompt.ctxpack.preview.title"))}
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-4 overflow-auto">
        <Show when={!pack.loading} fallback={<p role="status">{language.t("prompt.ctxpack.preview.loading")}</p>}>
          <Show when={pack()} fallback={<p role="alert">{language.t("prompt.ctxpack.preview.failed")}</p>}>
            {(info) => (
              <For each={[...info().fragments].sort((a, b) => a.ordinal - b.ordinal)}>
                {(fragment) => <pre class="whitespace-pre-wrap break-words font-inherit">{fragment.text}</pre>}
              </For>
            )}
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
