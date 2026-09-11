import { Schema } from "effect"

// Shared with session snapshots without loading CtxPack's content-hashing helpers.
export const Tag = Schema.Literals(["ParallelPlan"]).annotate({ identifier: "CtxPack.Tag" })
export type Tag = typeof Tag.Type
