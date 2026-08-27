import { Schema } from "effect"

export const SessionRuntime = Schema.Literals(["legacy", "v2", "mixed"])
export type SessionRuntime = typeof SessionRuntime.Type

/** Applies the wire compatibility rule for historical Session payloads. */
export function fromWire(runtime: SessionRuntime | undefined): SessionRuntime {
  return runtime ?? "legacy"
}

export const normalize = fromWire
