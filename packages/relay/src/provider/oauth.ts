// Account OAuth for chat providers via opencode's built-in ChatGPT/Codex OAuth
// app. The flow mirrors packages/opencode/src/plugin/openai/codex.ts — same
// client id, issuer, and device-authorization endpoints — so a relay login is
// the same account authorization the opencode CLI performs. Keep the endpoint
// and payload shapes in sync with that plugin.
//
// Device flow (headless-friendly, no local callback server):
//   1. POST {issuer}/api/accounts/deviceauth/usercode { client_id }
//      -> { device_auth_id, user_code, interval }
//   2. The user opens {issuer}/codex/device and enters the user code.
//   3. Poll POST {issuer}/api/accounts/deviceauth/token
//      { device_auth_id, user_code } -> 403/404 while pending, 200 with
//      { authorization_code, code_verifier } once approved.
//   4. Exchange at {issuer}/oauth/token with grant_type=authorization_code and
//      redirect_uri={issuer}/deviceauth/callback -> access + refresh tokens.

export interface ChatCredentials {
  accessToken: string
  refreshToken: string
  /** Epoch ms when the access token expires. */
  expiresAt: number
  accountId: string | undefined
}

/** The fetch surface the OAuth client needs (avoids bundling Bun's fetch type). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type LoginPollResult =
  | { type: "pending" }
  | { type: "success"; credentials: ChatCredentials }
  | { type: "denied" }

export interface DeviceLogin {
  verificationUrl: string
  userCode: string
  /** Minimum ms between deviceauth/token attempts. */
  pollIntervalMs: number
  /** Perform one deviceauth/token attempt. */
  poll(): Promise<LoginPollResult>
}

export interface OAuthClientOptions {
  issuer: string
  clientId: string
  userAgent?: string
  fetchFn?: FetchLike
  now?: () => number
}

interface DeviceTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
}

interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

function extractAccountIdFromClaims(claims: IdTokenClaims | undefined): string | undefined {
  if (!claims) return undefined
  return claims.chatgpt_account_id || claims["https://api.openai.com/auth"]?.chatgpt_account_id || claims.organizations?.[0]?.id
}

export function extractAccountId(tokens: DeviceTokenResponse): string | undefined {
  const idClaims = parseJwtClaims(tokens.id_token ?? "")
  const accountId = extractAccountIdFromClaims(idClaims)
  if (accountId) return accountId
  return extractAccountIdFromClaims(parseJwtClaims(tokens.access_token))
}

function toCredentials(tokens: DeviceTokenResponse, now: number): ChatCredentials {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(tokens),
  }
}

async function exchangeCode(options: OAuthClientOptions, code: string, verifier: string, now: number): Promise<ChatCredentials> {
  const response = await (options.fetchFn ?? fetch)(`${options.issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${options.issuer}/deviceauth/callback`,
      client_id: options.clientId,
      code_verifier: verifier,
    }).toString(),
  })
  if (!response.ok) throw new Error(`ChatGPT token exchange failed: ${response.status}`)
  return toCredentials((await response.json()) as DeviceTokenResponse, now)
}

export async function refreshAccessToken(
  options: OAuthClientOptions,
  refreshToken: string,
  now: number,
): Promise<ChatCredentials> {
  const fetchFn: FetchLike = options.fetchFn ?? fetch
  const response = await fetchFn(`${options.issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: options.clientId,
    }).toString(),
  })
  if (!response.ok) throw new Error(`ChatGPT token refresh failed: ${response.status}`)
  return toCredentials((await response.json()) as DeviceTokenResponse, now)
}

export async function startDeviceLogin(options: OAuthClientOptions): Promise<DeviceLogin> {
  const fetchFn: FetchLike = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": options.userAgent ?? "opencode",
  }
  const response = await fetchFn(`${options.issuer}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ client_id: options.clientId }),
  })
  if (!response.ok) throw new Error(`ChatGPT device authorization failed: ${response.status}`)
  const data = (await response.json()) as { device_auth_id: string; user_code: string; interval: string }

  return {
    verificationUrl: `${options.issuer}/codex/device`,
    userCode: data.user_code,
    pollIntervalMs: Math.max(parseInt(data.interval) || 5, 1) * 1000,
    poll: async (): Promise<LoginPollResult> => {
      const pollResponse = await fetchFn(`${options.issuer}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers,
        body: JSON.stringify({ device_auth_id: data.device_auth_id, user_code: data.user_code }),
      })
      if (pollResponse.ok) {
        const tokens = (await pollResponse.json()) as { authorization_code: string; code_verifier: string }
        const credentials = await exchangeCode(options, tokens.authorization_code, tokens.code_verifier, now())
        return { type: "success", credentials }
      }
      // 403/404 mean the user has not completed authorization yet; any other
      // status means the flow failed (mirrors opencode's codex device flow).
      if (pollResponse.status === 403 || pollResponse.status === 404) return { type: "pending" }
      return { type: "denied" }
    },
  }
}
