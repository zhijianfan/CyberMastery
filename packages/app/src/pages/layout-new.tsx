import { createEffect } from "solid-js"
import { CanvasWorkspace } from "@/pages/canvas/workspace"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { useSettingsCommand } from "@/components/settings-dialog"

export default function NewLayout() {
  useSettingsCommand()
  createEffect(() => setV2Toast(true))

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <main class="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col contain-strict">
        <CanvasWorkspace />
      </main>
      <ToastRegion v2 />
    </div>
  )
}
