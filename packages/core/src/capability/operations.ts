// Operation → required-rights table for the CtxPack v1 capability slice.
// Frozen: the operation names and their required rights are fixed for v1;
// M1 wires real role providers into CapabilityService, it does not change
// this table.

import type { Right } from "./subjects"

export const CtxPackOperations = [
  "ctxpack.read",
  "ctxpack.create",
  "ctxpack.patch",
  "ctxpack.remove",
  "ctxpack.restore",
  "ctxpack.materialize",
  "chat.context.attach",
] as const

export type CtxPackOperation = (typeof CtxPackOperations)[number]

// Required rights per operation:
//   ctxpack.read          -> ["read"]          (on the CtxPack subject)
//   ctxpack.create        -> ["write"]
//   ctxpack.patch         -> ["write"]
//   ctxpack.remove        -> ["write"]
//   ctxpack.restore       -> ["write"]
//   ctxpack.materialize   -> ["read"]          (on the CtxPack subject)
//   chat.context.attach   -> ["write"]         (on the FunctionalityInstance subject)
export const requiredRights: Record<CtxPackOperation, Right[]> = {
  "ctxpack.read": ["read"],
  "ctxpack.create": ["write"],
  "ctxpack.patch": ["write"],
  "ctxpack.remove": ["write"],
  "ctxpack.restore": ["write"],
  "ctxpack.materialize": ["read"],
  "chat.context.attach": ["write"],
}
