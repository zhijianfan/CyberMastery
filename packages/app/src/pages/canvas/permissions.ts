import type { PermissionAction, PermissionConfig } from "@opencode-ai/sdk/v2/client"

// Mirrors the server's config normalization: a string permission ("deny")
// applies to every permission key, and "*" acts as a wildcard key.
export function resolvePermission(config: PermissionConfig | undefined, key: string): PermissionAction {
  if (!config) return "ask"
  if (typeof config === "string") return config
  const value = config[key] ?? config["*"]
  if (value === undefined) return "ask"
  if (typeof value === "string") return value
  return resolvePermission(value, key)
}

export function permissionDenied(config: PermissionConfig | undefined, key: string) {
  return resolvePermission(config, key) === "deny"
}
