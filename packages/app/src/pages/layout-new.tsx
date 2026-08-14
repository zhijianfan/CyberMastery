import { createEffect, Suspense, type ParentProps } from "solid-js"
import { CanvasWorkspace } from "@/pages/canvas/workspace"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
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
        <CanvasWorkspace>
          <Suspense>{props.children}</Suspense>
        </CanvasWorkspace>
      </main>
      <ToastRegion v2 />
    </div>
  )
}
