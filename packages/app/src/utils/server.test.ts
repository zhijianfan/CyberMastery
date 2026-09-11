import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Schema } from "effect"

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

test("current prompts use the host prompt contract and return a pending user", async () => {
  const requests: Request[] = []
  const api = createApiForServer({
    server: { url: "http://localhost:4096", username: "tester", password: "secret" },
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request)
        const body = await request.clone().json()
        Schema.decodeUnknownSync(PromptInput.Prompt)(body.prompt)
        return Response.json({
          data: {
            id: "msg_prompt",
            sessionID: "ses_master",
            admittedSeq: 2,
            promotedSeq: 3,
            delivery: "queue",
            timeCreated: 123,
            prompt: {
              text: "hello",
              files: [{ uri: "file:///repo/a.ts", mime: "text/plain", source: { text: "@a.ts", start: 0, end: 5 } }],
            },
          },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  })
  const controller = new AbortController()
  const result = await api.session.prompt(
    {
      sessionID: "ses_master",
      id: "msg_prompt",
      text: "hello",
      delivery: "queue",
      resume: false,
      files: [{ uri: "file:///repo/a.ts", mention: { text: "@a.ts", start: 0, end: 5 } }],
    },
    { headers: new Headers({ "x-test-request": "forwarded" }), signal: controller.signal },
  )
  expect(requests).toHaveLength(1)
  expect(requests[0]!.headers.get("authorization")).toBe(`Basic ${btoa("tester:secret")}`)
  expect(requests[0]!.headers.get("x-test-request")).toBe("forwarded")
  controller.abort()
  expect(requests[0]!.signal.aborted).toBe(true)
  expect(await requests[0]!.json()).toEqual({
    id: "msg_prompt",
    delivery: "queue",
    resume: false,
    prompt: { text: "hello", files: [{ uri: "file:///repo/a.ts", source: { text: "@a.ts", start: 0, end: 5 } }] },
  })
  expect(result).toMatchObject({
    id: "msg_prompt",
    sessionID: "ses_master",
    type: "user",
    data: {
      text: "hello",
      files: [{ source: { type: "uri", uri: "file:///repo/a.ts" }, mention: { text: "@a.ts", start: 0, end: 5 } }],
    },
    promotedSeq: 3,
    delivery: "queue",
    timeCreated: 123,
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
          id: "msg_attachment",
          sessionID: "ses_attachment",
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
    sessionID: "ses_attachment",
    id: "msg_attachment",
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
  expect(new URL(requests[0].url).pathname).toBe("/api/session/ses_attachment/prompt")
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

test("OAuth attempt operations use current routes and preserve server authentication and location", async () => {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      return request.method === "GET"
        ? Response.json({
            location: { directory: "D:/project" },
            data: { status: "pending", time: { created: 1, expires: 2 } },
          })
        : new Response(null, { status: 204 })
    },
    { preconnect: fetch.preconnect },
  )
  const api = createApiForServer({
    server: { url: "http://example.test", username: "review", password: "secret" },
    fetch: fetcher,
  })
  const attempt = { integrationID: "openai", attemptID: "attempt-1", location: { directory: "D:/project" } }

  expect((await api.integration.oauth.status(attempt)).data.status).toBe("pending")
  await api.integration.oauth.complete({ ...attempt, code: "user-entered-code" })
  await api.integration.oauth.cancel(attempt)

  expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
    ["GET", "/api/integration/attempt/attempt-1"],
    ["POST", "/api/integration/attempt/attempt-1/complete"],
    ["DELETE", "/api/integration/attempt/attempt-1"],
  ])
  expect(requests.every((request) => request.headers.get("authorization") === `Basic ${btoa("review:secret")}`)).toBe(
    true,
  )
  expect(
    requests.every(
      (request) => new URL(request.url).searchParams.get("location[directory]") === attempt.location.directory,
    ),
  ).toBe(true)
  expect(await requests[1].json()).toEqual({ code: "user-entered-code" })
})
