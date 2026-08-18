import { optional } from "@opencode-ai/schema/schema"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Schema } from "effect"

/**
 * Workspace Coder patch fragment.
 *
 * `coderModel` uses the same model-selection representation as `Workspace.Info.model`.
 * Omitted key: unchanged. Explicit `null`: clear. Concrete value: persist exactly.
 */
export const WorkspaceCoderPatch = Schema.Struct({
  coderModel: optional(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "WorkspaceCoder.Patch" })

export namespace WorkspaceCoder {
  export type Model = NonNullable<Workspace.Info["model"]>
  export type Patch = Schema.Schema.Type<typeof WorkspaceCoderPatch>
  export type PatchEncoded = Schema.Codec.Encoded<typeof WorkspaceCoderPatch>

  /** Struct fields for composition into the Workspace update payload. */
  export const patchFields = WorkspaceCoderPatch.fields

  /** Normalizes a workspace info's coderModel (undefined when absent) to the wire null. */
  export const readModel = (info: Workspace.Info): Model | null => info.coderModel ?? null

  export const encodePatch = Schema.encodeSync(WorkspaceCoderPatch)
  export const decodePatch = Schema.decodeUnknownOption(WorkspaceCoderPatch)
}
