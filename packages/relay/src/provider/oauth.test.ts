import { describe, expect, test } from "bun:test"
import {
  extractAccountId,
  parseJwtClaims,
  refreshAccessToken,
  startDeviceLogin,
  type ChatCredentials,
  type FetchLike,
} from "./oauth.js"

const ISSUER = "https://auth.example.com"
const CLIENT_ID = "test-client"
const NOW = 1_700_000_000_000

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: string) => Buffer.from(value).toString("base64url")
  return `${encode("{}")}.${encode(JSON.stringify(payload))}.sig`
}

function tokens(overrides: Partial<{ access_token: string; refresh_token: string; expires_in: number; id_token: string }> = {}) {
  return {
    access_token: overrides.access_token ?? "access-token",
    refresh_token: overrides.refresh_token ?? "refresh-token",
    expires_in: overrides.expires_in ?? 3600,
    id_token: overrides.id_token ?? jwt({ chatgpt_account_id: "acc-123" }),
  }
}

describe("parseJwtClaims / extractAccountId", () => {
  test("reads the chatgpt account id from the id token claims", () => {
    expect(extractAccountId(tokens())).toBe("acc-123")
  })

  test("falls back to the organizations claim and the access token", () => {
    expect(extractAccountId(tokens({ id_token: jwt({ organizations: [{ id: "org-9" }] }) }))).toBe("org-9")
    expect(extractAccountId(tokens({ id_token: "", access_token: jwt({ chatgpt_account_id: "acc-access" }) }))).toBe("acc-access")
  })

  test("returns undefined for a token without account claims", () => {
    expect(parseJwtClaims("not-a-jwt")).toBeUndefined()
    expect(extractAccountId(tokens({ id_token: "", access_token: "plain" }))).toBeUndefined()
  })
})

describe("startDeviceLogin", () => {
  test("requests a user code and polls pending then success with the exchanged tokens", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    let pollCount = 0
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input)
      calls.push({ url, init: init as RequestInit })
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse(200, { device_auth_id: "device-1", user_code: "ABCD-1234", interval: "5" })
      }
      if (url.endsWith("/deviceauth/token")) {
        pollCount++
        if (pollCount === 1) return jsonResponse(403, {})
        return jsonResponse(200, { authorization_code: "auth-code", code_verifier: "verifier" })
      }
      if (url.endsWith("/oauth/token")) return jsonResponse(200, tokens())
      throw new Error(`unexpected url: ${url}`)
    }

    const flow = await startDeviceLogin({ issuer: ISSUER, clientId: CLIENT_ID, fetchFn, now: () => NOW })
    expect(flow.verificationUrl).toBe(`${ISSUER}/codex/device`)
    expect(flow.userCode).toBe("ABCD-1234")
    expect(flow.pollIntervalMs).toBe(5000)

    const first = await flow.poll()
    expect(first.type).toBe("pending")

    const second = await flow.poll()
    expect(second.type).toBe("success")
    const credentials = (second as Extract<typeof second, { type: "success" }>).credentials
    expect(credentials.accessToken).toBe("access-token")
    expect(credentials.refreshToken).toBe("refresh-token")
    expect(credentials.expiresAt).toBe(NOW + 3600 * 1000)
    expect(credentials.accountId).toBe("acc-123")

    const usercode = calls[0]!
    expect(usercode.url).toBe(`${ISSUER}/api/accounts/deviceauth/usercode`)
    expect(JSON.parse(String(usercode.init.body))).toEqual({ client_id: CLIENT_ID })

    const exchange = calls.at(-1)!
    expect(exchange.url).toBe(`${ISSUER}/oauth/token`)
    const body = new URLSearchParams(String(exchange.init.body))
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("auth-code")
    expect(body.get("code_verifier")).toBe("verifier")
    expect(body.get("redirect_uri")).toBe(`${ISSUER}/deviceauth/callback`)
  })

  test("reports denied for a non-pending poll failure", async () => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input)
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse(200, { device_auth_id: "device-1", user_code: "ABCD-1234", interval: "5" })
      }
      if (url.endsWith("/deviceauth/token")) return jsonResponse(500, {})
      throw new Error(`unexpected url: ${url}`)
    }
    const flow = await startDeviceLogin({ issuer: ISSUER, clientId: CLIENT_ID, fetchFn, now: () => NOW })
    expect(await flow.poll()).toEqual({ type: "denied" })
  })

  test("throws when the device authorization cannot start", async () => {
    const fetchFn: FetchLike = async () => jsonResponse(500, {})
    await expect(startDeviceLogin({ issuer: ISSUER, clientId: CLIENT_ID, fetchFn })).rejects.toThrow("device authorization failed")
  })
})

describe("refreshAccessToken", () => {
  test("exchanges the refresh token and computes the expiry", async () => {
    let body: URLSearchParams | undefined
    const fetchFn: FetchLike = async (input, init) => {
      expect(String(input)).toBe(`${ISSUER}/oauth/token`)
      body = new URLSearchParams(String(init?.body))
      return jsonResponse(200, tokens({ refresh_token: "fresh-refresh" }))
    }
    const refreshed: ChatCredentials = await refreshAccessToken(
      { issuer: ISSUER, clientId: CLIENT_ID, fetchFn, now: () => NOW },
      "stale-refresh",
      NOW,
    )
    expect(body?.get("grant_type")).toBe("refresh_token")
    expect(body?.get("refresh_token")).toBe("stale-refresh")
    expect(body?.get("client_id")).toBe(CLIENT_ID)
    expect(refreshed.accessToken).toBe("access-token")
    expect(refreshed.refreshToken).toBe("fresh-refresh")
    expect(refreshed.expiresAt).toBe(NOW + 3600 * 1000)
  })

  test("throws when the refresh is rejected", async () => {
    const fetchFn: FetchLike = async () => jsonResponse(401, {})
    await expect(
      refreshAccessToken({ issuer: ISSUER, clientId: CLIENT_ID, fetchFn }, "stale-refresh", NOW),
    ).rejects.toThrow("token refresh failed")
  })
})
