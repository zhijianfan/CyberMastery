// M1 integration: the canvas block body for `builtin:ctxpack-browser`. The
// runtime handle (projected adapter R1) owns resolve/refetch/dispatch; this
// component maps the handle onto U2's pure view contract and supplies the
// drag-payload serializer and focused-input attach action (U3).

import { createMemo, type Accessor } from "solid-js"
import { serializeCtxPackDragPayload, type CtxPackDragPayloadV1 } from "@/context/ctxpack/drag"
import { useMessageContextTargetRegistry } from "@/context/ctxpack/drop-target"
import { useBlockRuntimeHandle } from "../../runtime/block-runtime-host"
import { CtxPackBrowser } from "./index"
import type { CtxPackSummary } from "./types"
import { initialCtxPackBrowserView, type CtxPackBrowserCommand, type CtxPackBrowserView } from "./view-model"

export function CtxPackBrowserBlockBody(_props: { blockID: string }) {
  const handle = useBlockRuntimeHandle()
  const registry = useMessageContextTargetRegistry()

  const payloadOf = (summary: CtxPackSummary): CtxPackDragPayloadV1 => ({
    version: 1,
    workspaceID: summary.workspaceID,
    ctxPackID: summary.id,
    contentHash: summary.contentHash,
    label: summary.title,
    estimatedTokens: summary.estimatedTokens,
  })

  const view: Accessor<CtxPackBrowserView> = createMemo(
    () => (handle?.view() as CtxPackBrowserView | undefined) ?? initialCtxPackBrowserView(),
  )
  const dispatch = (command: CtxPackBrowserCommand) => handle?.dispatch(command) ?? Promise.resolve()

  return (
    <CtxPackBrowser
      view={view}
      dispatch={dispatch}
      createDragPayload={(summary) => serializeCtxPackDragPayload(payloadOf(summary))}
      attachToFocusedInput={(summary) => registry.attachToFocused(payloadOf(summary))}
    />
  )
}
