export interface CtxPackComposerTarget {
  instanceID: string
  functionalityID: string
}

export function resolveCtxPackComposerTarget(
  sessionID: string | undefined,
  override: CtxPackComposerTarget | undefined,
): CtxPackComposerTarget | undefined {
  const session = sessionID?.trim()
  if (!session) return
  if (override === undefined) {
    return { instanceID: `chat-instance:${session}`, functionalityID: "builtin:chat" }
  }
  if (!override || typeof override.instanceID !== "string" || typeof override.functionalityID !== "string") return
  const instanceID = override.instanceID.trim()
  const functionalityID = override.functionalityID.trim()
  if (!instanceID || !functionalityID) return
  return { instanceID, functionalityID }
}
