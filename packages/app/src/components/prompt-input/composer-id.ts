export function contextTarget(
  sessionID: string | undefined,
  override?: { instanceID: string; functionalityID: string },
) {
  if (!sessionID) return
  return (
    override ?? {
      instanceID: `chat-instance:${sessionID}`,
      functionalityID: "builtin:chat",
    }
  )
}
