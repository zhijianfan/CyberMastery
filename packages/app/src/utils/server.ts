import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import type { SessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"

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
  const client = OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
  const current = createSdkForServer({ server: input.server, fetch: input.fetch, throwOnError: true })
  return {
    ...client,
    session: {
      ...client.session,
      async prompt(
        value: Parameters<OpenCodeClient["session"]["prompt"]>[0] & {
          contextAttachments?: SessionContextAttachmentInput[]
        },
      ) {
        // The app's compatibility client predates the current prompt contract.
        // Reuse the generated SDK transport so attachments cannot be discarded.
        const result = await current.v2.session.prompt(
          {
            sessionID: value.sessionID,
            id: value.id ?? undefined,
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
            delivery: value.delivery ?? undefined,
            resume: value.resume ?? undefined,
            contextAttachments: value.contextAttachments,
          },
          { throwOnError: true },
        )
        const admitted = result.data.data
        return {
          admittedSeq: admitted.admittedSeq,
          id: admitted.id,
          sessionID: admitted.sessionID,
          timeCreated: admitted.timeCreated,
          delivery: admitted.delivery,
          type: "user" as const,
          data: { text: value.text },
        }
      },
    },
  }
}

export type ServerApi = OpenCodeClient
