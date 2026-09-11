export * as ModelKey from "./model-key"

import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { Workspace } from "@opencode-ai/schema/workspace"

export function decode(value: unknown): ModelV2.Ref | undefined {
  const selection = Workspace.ModelSelection.decode(value)
  if (!selection) return
  return ModelV2.Ref.make({
    providerID: ProviderV2.ID.make(selection.providerID),
    id: ModelV2.ID.make(selection.modelID),
    ...(selection.variant ? { variant: ModelV2.VariantID.make(selection.variant) } : {}),
  })
}
