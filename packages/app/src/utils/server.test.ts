import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

test("current prompt transport sends capsule references and the canonical prompt exactly once", async () => {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({
        data: {
          admittedSeq: 1,
          id: "message-1",
          sessionID: "session-1",
          timeCreated: 1,
          delivery: "queue",
          prompt: { text: "Use @notes" },
        },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const attachments = [
    {
      contextCapsuleID: "capsule-1",
      label: "Notes",
      contentHash: "hash",
      source: { kind: "ctxpack" as const, ctxPackID: "pack-1" },
    },
  ]
  const input = {
    sessionID: "session-1",
    id: "message-1",
    text: "Use @notes",
    delivery: "queue" as const,
    resume: false,
    files: [{ uri: "file:///notes.txt", name: "notes.txt", mention: { start: 4, end: 10, text: "@notes" } }],
    agents: [{ name: "build", mention: { start: 0, end: 3, text: "Use" } }],
    contextAttachments: attachments,
  }
  await createApiForServer({
    server: { url: "http://example.test", username: "review", password: "secret" },
    fetch: fetcher,
  }).session.prompt(input)
  expect(requests).toHaveLength(1)
  expect(new URL(requests[0].url).pathname).toBe("/api/session/session-1/prompt")
  expect(requests[0].headers.get("authorization")).toBe(`Basic ${btoa("review:secret")}`)
  expect(await requests[0].json()).toEqual({
    id: input.id,
    prompt: {
      text: input.text,
      files: [{ uri: "file:///notes.txt", name: "notes.txt", source: input.files[0].mention }],
      agents: [{ name: "build", source: input.agents[0].mention }],
    },
    delivery: "queue",
    resume: false,
    contextAttachments: attachments,
  })
})
