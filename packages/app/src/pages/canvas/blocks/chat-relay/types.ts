import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"

export interface ChatRelayBodyProps {
  block: { id: string }
  permissions?: PermissionConfig
  focused: boolean
  onFocus(): void
}
