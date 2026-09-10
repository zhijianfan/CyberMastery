import type { PermissionConfig } from "@opencode-ai/sdk/v2/client"

export interface ChatRelayBodyProps {
  block: { id: string }
  permissions?: PermissionConfig
  focused: boolean
  onFocus(): void
}

export function chatRelayError(value: unknown) {
  if (value instanceof Error) return value.message
  if (typeof value === "object" && value !== null) {
    const data = "data" in value && typeof value.data === "object" && value.data !== null ? value.data : undefined
    if (data && "message" in data && typeof data.message === "string" && data.message) return data.message
    if ("message" in value && typeof value.message === "string" && value.message) return value.message
  }
  return String(value)
}
