import type { ConnectionInfo } from "@opencode-ai/client/promise"
import type { ServerProtocol } from "@/utils/server-protocol"

export async function disconnectProvider(input: {
  protocol: ServerProtocol
  providerID: string
  connection?: ConnectionInfo
  removeCredential: (credentialID: string) => Promise<unknown>
  removeLegacy: (providerID: string) => Promise<unknown>
  disposeLegacy: () => Promise<unknown>
}) {
  if (input.protocol === "v1") {
    await input.removeLegacy(input.providerID)
    await input.disposeLegacy()
    return true
  }
  if (input.connection?.type !== "credential") return false
  await input.removeCredential(input.connection.id)
  return true
}
