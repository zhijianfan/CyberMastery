// Capability subjects: the nouns a capability check is evaluated against.
// This model is frozen for the CtxPack v1 slice — every subject carries a
// workspaceID because membership is the outer gate (see policy rule 1 in
// service.ts).

export type Right = "read" | "write" | "execute"

export type CapabilitySubject =
  | { type: "Workspace"; workspaceID: string }
  | {
      type: "FunctionalityInstance"
      workspaceID: string
      instanceID: string
      functionalityID: string
    }
  | {
      type: "CtxPack"
      workspaceID: string
      ctxPackID: string
      sensitivity: "public" | "workspace" | "private"
      createdByUserID: string
    }
