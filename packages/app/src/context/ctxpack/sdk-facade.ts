// M1 integration: typed facades over the generated SDK's
// `client.v2.workspace.ctxpack` surface. Consumed by the canvas host to wire
// the attachment-store materialize provider and the selection-overlay create
// action. Shapes mirror the frozen wire contracts (P1 group + U3/U4 local
// types); M1 verified them against the hand-mirrored SDK.

import type { Accessor } from "solid-js"
import type { ServerSDK } from "@/context/server-sdk"
import type { CtxPackCreateRequestLocal, CtxPackInfoLocal } from "./create-dialog"

export interface CtxPackSdkMaterializeInput {
  workspaceID: string
  ctxPackID: string
  expectedContentHash: string
  targetInstanceID: string
  targetFunctionalityID: string
}

export interface CtxPackSdkMaterializeOutput {
  contextCapsuleID: string
  sourceCtxPackID: string
  label: string
  tags?: readonly "ParallelPlan"[]
  contentHash: string
  estimatedTokens: number
}

export function createCtxPackSdkFacade(serverSDK: Accessor<ServerSDK>) {
  return {
    materialize: async (input: CtxPackSdkMaterializeInput): Promise<CtxPackSdkMaterializeOutput> => {
      const result = await serverSDK().client.v2.workspace.ctxpack.materialize(
        {
          workspaceID: input.workspaceID,
          ctxPackID: input.ctxPackID,
          ctxPackMaterializeRequest: {
            expectedContentHash: input.expectedContentHash,
            targetInstanceID: input.targetInstanceID,
            targetFunctionalityID: input.targetFunctionalityID,
          },
        },
        { throwOnError: true },
      )
      return result.data as CtxPackSdkMaterializeOutput
    },
    create: async (input: CtxPackCreateRequestLocal): Promise<CtxPackInfoLocal> => {
      const result = await serverSDK().client.v2.workspace.ctxpack.create(
        {
          workspaceID: input.workspaceID,
          ctxPackCreatePayload: {
            title: input.title,
            keywords: input.keywords,
            sensitivity: input.sensitivity,
            fragments: input.fragments,
            idempotencyKey: input.idempotencyKey,
          },
        },
        { throwOnError: true },
      )
      return result.data as CtxPackInfoLocal
    },
  }
}

// Materialize facade shaped for the attachment-store provider (U3).
export type CtxPackStoreMaterialize = (input: {
  workspaceID: string
  ctxPackID: string
  expectedContentHash: string
  targetInstanceID: string
  targetFunctionalityID: string
}) => Promise<{
  contextCapsuleID: string
  sourceCtxPackID: string
  label: string
  tags?: readonly "ParallelPlan"[]
  contentHash: string
  estimatedTokens: number
}>

export function attachmentStoreMaterializeFacade(serverSDK: Accessor<ServerSDK>): CtxPackStoreMaterialize {
  const sdk = createCtxPackSdkFacade(serverSDK)
  return (input) => sdk.materialize(input)
}
