export function getCurrentServerUrl(
  location: Pick<Location, "hostname" | "origin">,
  env: {
    DEV: boolean
    VITE_OPENCODE_SERVER_HOST?: string
    VITE_OPENCODE_SERVER_PORT?: string
  },
) {
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (env.DEV && isLoopback(location.hostname))
    return `http://${env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${env.VITE_OPENCODE_SERVER_PORT ?? "3001"}`
  return location.origin
}

export function getStoredServerUrl(current: string, stored: string | null) {
  if (!stored || !URL.canParse(current) || !URL.canParse(stored)) return stored
  if (!isLoopback(new URL(current).hostname) && isLoopback(new URL(stored).hostname)) return null
  return stored
}

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  )
}
