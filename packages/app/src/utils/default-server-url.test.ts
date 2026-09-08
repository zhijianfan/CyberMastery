import { describe, expect, test } from "bun:test"
import { getCurrentServerUrl, getStoredServerUrl } from "./default-server-url"

describe("getCurrentServerUrl", () => {
  test.each([
    ["https://cm.cybermaster.dev", "https://cm.cybermaster.dev"],
    ["https://cm.cybermaster.dev:8443/workspace", "https://cm.cybermaster.dev:8443"],
    ["http://192.168.1.20:3154", "http://192.168.1.20:3154"],
    ["https://frontend.cybermaster.dev", "https://frontend.cybermaster.dev"],
    ["http://localhost:3155", "http://localhost:3154"],
    ["http://127.0.0.1:3155", "http://localhost:3154"],
    ["http://127.0.0.2:3155", "http://localhost:3154"],
    ["http://[::1]:3155", "http://localhost:3154"],
    ["https://app.opencode.ai", "http://localhost:4096"],
  ])("connects from %s to %s in development", (page, expected) => {
    expect(
      getCurrentServerUrl(new URL(page), {
        DEV: true,
        VITE_OPENCODE_SERVER_HOST: "localhost",
        VITE_OPENCODE_SERVER_PORT: "3154",
      }),
    ).toBe(expected)
  })

  test.each(["http://localhost:4444", "http://127.0.0.1:4444", "http://[::1]:4444"])(
    "preserves the explicitly configured backend for standalone frontend %s",
    (page) => {
      expect(
        getCurrentServerUrl(new URL(page), {
          DEV: true,
          VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
          VITE_OPENCODE_SERVER_PORT: "4096",
        }),
      ).toBe("http://127.0.0.1:4096")
    },
  )

  test("uses the remote page origin without a public hostname setting", () => {
    expect(
      getCurrentServerUrl(new URL("https://cm.cybermaster.dev"), {
        DEV: true,
        VITE_OPENCODE_SERVER_HOST: "backend.cybermaster.dev",
        VITE_OPENCODE_SERVER_PORT: "4096",
      }),
    ).toBe("https://cm.cybermaster.dev")
  })

  test("keeps the standalone development fallback", () => {
    expect(getCurrentServerUrl(new URL("http://localhost:3000"), { DEV: true })).toBe("http://localhost:3001")
  })

  test("uses its own origin for a production frontend", () => {
    expect(getCurrentServerUrl(new URL("http://localhost:3154"), { DEV: false })).toBe("http://localhost:3154")
  })
})

describe("getStoredServerUrl", () => {
  test.each([
    "http://localhost:3154",
    "http://127.0.0.1:3154",
    "http://127.1:4096",
    "http://127.0.0.2:4096",
    "http://[::1]:3154",
  ])("ignores stale loopback default %s on a remote page", (stored) => {
    expect(getStoredServerUrl("https://cm.cybermaster.dev:8443", stored)).toBeNull()
  })

  test("preserves an intentional remote default", () => {
    expect(getStoredServerUrl("https://cm.cybermaster.dev", "https://other.example:8443")).toBe(
      "https://other.example:8443",
    )
  })

  test("preserves local defaults for the local client and official hosted client", () => {
    expect(getStoredServerUrl("http://localhost:4096", "http://127.0.0.1:3154")).toBe("http://127.0.0.1:3154")
  })

  test("keeps an unset default unset", () => {
    expect(getStoredServerUrl("https://cm.cybermaster.dev", null)).toBeNull()
  })

  test("leaves malformed saved values to existing server validation", () => {
    expect(getStoredServerUrl("https://cm.cybermaster.dev", "invalid server")).toBe("invalid server")
  })
})
