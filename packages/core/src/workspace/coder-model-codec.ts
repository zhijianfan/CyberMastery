export * as CoderModelCodec from "./coder-model-codec"

// Row/domain conversion for workspace.coderModel. The coder_model column
// stores the model selection string or null; the domain surface exposes the
// selection string or undefined, mirroring Workspace.Info.model. Patch values
// distinguish omission (undefined), clearing (null or ""), and persistence
// (any other string), matching the workspace service conventions.

export type CoderModel = string

export function decode(value: unknown): CoderModel | undefined {
  return typeof value === "string" ? value : undefined
}

export function encode(value: CoderModel | null | undefined): string | null {
  return value ?? null
}

export function encodePatch(value: CoderModel | null | undefined): { coder_model: string | null } | undefined {
  if (value === undefined) return undefined
  return { coder_model: value || null }
}
