export * as ModelKey from "./model-key"

import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"

export function decode(value: unknown): ModelV2.Ref | undefined {
  if (typeof value !== "string") return undefined
  const parts = value.split(":")
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !part)) return undefined
  return ModelV2.Ref.make({
    providerID: ProviderV2.ID.make(parts[0]),
    id: ModelV2.ID.make(parts[1]),
    ...(parts[2] ? { variant: ModelV2.VariantID.make(parts[2]) } : {}),
  })
}
