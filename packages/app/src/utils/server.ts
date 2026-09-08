import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { DateTime, Schema } from "effect"
import {
  normalizeCurrentPrompt,
  normalizeCurrentSessionMessage,
  normalizeCurrentSessionMessages,
} from "@/context/current-session-events"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  const headers = input.server.password
    ? {
        Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
      }
    : undefined
  const client = OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers,
  })
  return {
    ...client,
    session: {
      ...client.session,
      async prompt(value, options) {
        // The bundled presentation client predates the host's nested prompt contract.
        const response = await (input.fetch ?? globalThis.fetch)(
          new URL(`/api/session/${encodeURIComponent(value.sessionID)}/prompt`, input.server.url),
          {
            method: "POST",
            headers: {
              ...headers,
              ...Object.fromEntries(new Headers(options?.headers)),
              "content-type": "application/json",
            },
            signal: options?.signal,
            body: JSON.stringify({
              id: value.id,
              prompt: {
                text: value.text,
                files: value.files?.map((file) => ({
                  uri: file.uri,
                  name: file.name,
                  description: file.description,
                  source: file.mention,
                })),
                agents: value.agents?.map((agent) => ({ name: agent.name, source: agent.mention })),
              },
              delivery: value.delivery,
              resume: value.resume,
              contextAttachments: "contextAttachments" in value ? value.contextAttachments : undefined,
            }),
          },
        )
        if (!response.ok) throw await response.json()
        const result = Schema.decodeUnknownSync(Schema.Struct({ data: SessionInput.Admitted }))(
          await response.json(),
        ).data
        return {
          id: result.id,
          sessionID: result.sessionID,
          admittedSeq: result.admittedSeq,
          promotedSeq: result.promotedSeq,
          delivery: result.delivery,
          timeCreated: DateTime.toEpochMillis(result.timeCreated),
          type: "user",
          data: normalizeCurrentPrompt(result.prompt),
        }
      },
      message: async (value, options) => normalizeCurrentSessionMessage(await client.session.message(value, options)),
    },
    message: {
      ...client.message,
      async list(value, options) {
        const result = await client.message.list(value, options)
        return { ...result, data: normalizeCurrentSessionMessages(result.data) }
      },
    },
  }
}

export type ServerApi = OpenCodeClient
