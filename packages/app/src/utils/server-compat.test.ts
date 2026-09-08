import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"

function setup(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: {
    vcs?: { branch: string; default_branch: string }
    runtime?: "legacy" | "v2" | "mixed"
    metadata?: () => Response
  },
) {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.method === "GET" && new URL(request.url).pathname === "/api/session/ses_1") {
        if (responses?.metadata) return responses.metadata()
        return Response.json({
          data: {
            id: "ses_1",
            runtime: responses?.runtime ?? "legacy",
            projectID: "project",
            location: { directory: "/repo" },
            agent: "parallel-master",
            model: { providerID: "openai", id: "master-model" },
            title: "Master",
            time: { created: 1, updated: 1 },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        })
      }
      if (
        request.method === "PATCH" ||
        (request.method === "GET" && new URL(request.url).pathname === "/session/ses_1")
      ) {
        return Response.json({
          id: "ses_1",
          slug: "ses_1",
          projectID: "project",
          directory: "/repo",
          title: "Session",
          version: "1",
          time: { created: 1, updated: 1 },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt_async"))
        return new Response(undefined, { status: 204 })
      if (request.method === "POST" && request.url.endsWith("/prompt")) {
        return Response.json({
          data: {
            admittedSeq: 1,
            id: "msg_1",
            sessionID: "ses_1",
            timeCreated: 1,
            prompt: { text: "hello" },
            delivery: "steer",
          },
        })
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/vcs")
        return Response.json(responses?.vcs ?? {})
      if (request.method === "GET") return Response.json([])
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const api = createCompatibleApi({
    protocol: typeof protocol === "string" ? Promise.resolve(protocol) : protocol,
    current: createApiForServer({ server, fetch: fetcher }),
    legacy: (directory) => createSdkForServer({ server, fetch: fetcher, directory, throwOnError: true }),
    directory: "/repo",
  })
  return { api, requests }
}

describe("createCompatibleApi", () => {
  test("routes a bound V2 session on a hybrid host by its stored runtime", async () => {
    const { api, requests } = setup("v1", { runtime: "v2" })
    await api.session.prompt({
      sessionID: "ses_1",
      text: "hello",
      agent: "build",
      model: { providerID: "other", modelID: "other" },
    })
    await api.session.interrupt({ sessionID: "ses_1" })
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_1",
      "/api/session/ses_1/prompt",
      "/api/session/ses_1/interrupt",
    ])
    expect(await requests[1]!.json()).toEqual({ prompt: { text: "hello" } })
  })

  test("does not write a session containing mixed histories", async () => {
    const { api, requests } = setup("v1", { runtime: "mixed" })
    await expect(api.session.prompt({ sessionID: "ses_1", text: "hello" })).rejects.toMatchObject({
      _tag: "SessionRuntime.ConflictError",
      actual: "mixed",
    })
    expect(requests.every((request) => request.method === "GET")).toBe(true)
  })

  test.each([
    { status: 401, body: { _tag: "Unauthorized" } },
    { status: 404, body: { _tag: "SessionNotFoundError", sessionID: "ses_1" } },
    { status: 500, body: { _tag: "InternalServerError" } },
    { status: 503, body: { _tag: "ServiceUnavailable" } },
  ])("does not infer a legacy runtime from metadata status $status", async ({ status, body }) => {
    const responses = { runtime: "v2" as const, metadata: undefined as (() => Response) | undefined }
    responses.metadata = () => Response.json(body, { status })
    const { api, requests } = setup("v1", responses)

    await expect(api.session.prompt({ sessionID: "ses_1", text: "hello" })).rejects.toBeDefined()
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/session/ses_1"])

    responses.metadata = undefined
    await api.session.prompt({ sessionID: "ses_1", text: "hello" })
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_1",
      "/api/session/ses_1",
      "/api/session/ses_1/prompt",
    ])
  })

  test("does not infer a legacy runtime from a metadata transport error", async () => {
    const { api, requests } = setup("v1", {
      metadata: () => {
        throw new TypeError("Failed to fetch")
      },
    })
    await expect(api.session.prompt({ sessionID: "ses_1", text: "hello" })).rejects.toMatchObject({
      reason: "Transport",
    })
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/session/ses_1"])
  })

  test.each([
    { status: 404, body: { _tag: "NotFound" } },
    { status: 405, body: { _tag: "MethodNotAllowed" } },
    { status: 501, body: { _tag: "NotImplemented" } },
  ])("falls back when the metadata endpoint is unsupported with status $status", async ({ status, body }) => {
    const { api, requests } = setup("v1", { metadata: () => Response.json(body, { status }) })
    await api.session.prompt({ sessionID: "ses_1", text: "hello" })
    expect(await api.session.runtime({ sessionID: "ses_1" })).toBe("legacy")
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_1",
      "/session/ses_1",
      "/session/ses_1/prompt_async",
    ])
  })

  test("routes V2 approval replies on a hybrid host to the session's runtime", async () => {
    const { api, requests } = setup("v1", { runtime: "v2" })
    await api.permission.reply({ sessionID: "ses_1", requestID: "permission_1", reply: "once" })
    await api.question.reply({ sessionID: "ses_1", requestID: "question_1", answers: [["Yes"]] })
    await api.question.reject({ sessionID: "ses_1", requestID: "question_2" })
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_1",
      "/api/session/ses_1/permission/permission_1/reply",
      "/api/session/ses_1/question/question_1/reply",
      "/api/session/ses_1/question/question_2/reject",
    ])
    expect(await requests[1]!.json()).toEqual({ reply: "once" })
    expect(await requests[2]!.json()).toEqual({ answers: [["Yes"]] })
  })

  test("keeps legacy question replies on the legacy runtime", async () => {
    const { api, requests } = setup("v1")
    await api.question.reply({ sessionID: "ses_1", requestID: "question_1", answers: [["Yes"]] })
    await api.question.reject({ sessionID: "ses_1", requestID: "question_2" })
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/session/ses_1",
      "/question/question_1/reply",
      "/question/question_2/reject",
    ])
    expect(await requests[1]!.json()).toEqual({ answers: [["Yes"]] })
  })

  test("does not send approval replies for mixed histories", async () => {
    const { api, requests } = setup("v1", { runtime: "mixed" })
    await Promise.all([
      expect(
        api.permission.reply({ sessionID: "ses_1", requestID: "permission_1", reply: "once" }),
      ).rejects.toMatchObject({
        _tag: "SessionRuntime.ConflictError",
        actual: "mixed",
      }),
      expect(
        api.question.reply({ sessionID: "ses_1", requestID: "question_1", answers: [["Yes"]] }),
      ).rejects.toMatchObject({
        _tag: "SessionRuntime.ConflictError",
        actual: "mixed",
      }),
      expect(api.question.reject({ sessionID: "ses_1", requestID: "question_2" })).rejects.toMatchObject({
        _tag: "SessionRuntime.ConflictError",
        actual: "mixed",
      }),
    ])
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/session/ses_1"])
  })

  test("preserves request headers and cancellation for native session calls", async () => {
    const { api, requests } = setup("v1", { runtime: "v2" })
    const controller = new AbortController()
    const options = { signal: controller.signal, headers: { "x-request-test": "preserved" } }
    await api.session.get({ sessionID: "ses_1" }, options)
    await api.session.interrupt({ sessionID: "ses_1" }, options)
    await api.permission.reply({ sessionID: "ses_1", requestID: "permission_1", reply: "once" }, options)
    await api.question.reject({ sessionID: "ses_1", requestID: "question_1" }, options)

    expect(requests.every((request) => request.headers.get("x-request-test") === "preserved")).toBe(true)
    controller.abort()
    expect(requests.every((request) => request.signal.aborted)).toBe(true)
  })
  /*
  test("routes V1 archive through the legacy session update", async () => {
    const { api, requests } = setup("v1")
    await api.session.archive({ sessionID: "ses_1", directory: "/repo" })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/session/ses_1")
    expect(requests[0]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toMatchObject({ time: { archived: expect.any(Number) } })
  })
  */

  test("converts current prompts to the V1 prompt contract", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })

    const sent = requests.find((request) => request.method === "POST")!
    expect(new URL(sent.url).pathname).toBe("/session/ses_1/prompt_async")
    const body = await sent.json()
    expect(body).toMatchObject({
      messageID: "msg_1",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      parts: [
        { type: "text", text: "hello @src/index.ts" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/index.ts",
          filename: "index.ts",
          source: {
            type: "file",
            text: { value: "@src/index.ts", start: 6, end: 19 },
            path: "file:///repo/src/index.ts",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          filename: "notes.txt",
        },
      ],
    })
    expect(body.parts[2]).not.toHaveProperty("source")
  })

  test("preserves original parts for V1 optimistic reconciliation", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png" }],
      legacyParts: [
        { id: "prt_text", type: "text", text: "look" },
        { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
      ],
    })

    expect((await requests.find((request) => request.method === "POST")!.json()).parts).toEqual([
      { id: "prt_text", type: "text", text: "look" },
      { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
    ])
  })

  test("resolves protocol detection once across implementation methods", async () => {
    let detections = 0
    const resolved = Promise.resolve<"v1" | "v2">("v2")
    const protocol = new Proxy(resolved, {
      get(target, property) {
        if (property !== "then") return Reflect.get(target, property, target)
        detections++
        return target.then.bind(target)
      },
    })
    const { api } = setup(protocol)

    await api.session.list()
    await api.session.list()

    expect(detections).toBe(1)
  })

  /*
  test("keeps V2 session actions on the current API", async () => {
    const { api, requests } = setup("v2")
    await api.session.archive({ sessionID: "ses_1" })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/archive")
    expect(requests[0]!.method).toBe("POST")
  })
  */

  test("uses the global V1 session search endpoint", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ parentID: null, search: "session", limit: 50 })

    expect(new URL(requests[0]!.url).pathname).toBe("/experimental/session")
  })

  /*
  test("projects the V1 default branch", async () => {
    const { api } = setup("v1", { vcs: { branch: "feature", default_branch: "dev" } })

    expect(await api.vcs.get({ location: { directory: "/repo" } })).toMatchObject({
      data: { branch: "feature", defaultBranch: "dev" },
    })
  })
  */

  test("translates current file searches to the V1 dirs parameter", async () => {
    const { api, requests } = setup("v1")
    await api.file.find({ location: { directory: "/repo" }, query: "src", type: "file", limit: 20 })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/find/file")
    expect(url.searchParams.get("dirs")).toBe("false")
    expect(url.searchParams.get("limit")).toBe("20")
  })

  test("routes V1 permission replies through the requested directory", async () => {
    const { api, requests } = setup("v1")
    await api.permission.reply({
      sessionID: "ses_1",
      requestID: "permission_1",
      reply: "once",
      location: { directory: "/other" },
    })

    const sent = requests.find((request) => request.method === "POST")!
    expect(new URL(sent.url).pathname).toBe("/session/ses_1/permissions/permission_1")
    expect(new URL(sent.url).searchParams.get("directory")).toBe("/other")
  })

  test("disposes the V1 instance after connecting a provider", async () => {
    const { api, requests } = setup("v1")

    await api.integration.connect.key({
      integrationID: "openrouter",
      key: "secret",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/auth/openrouter",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-opencode-directory")).toBeNull()
  })

  test("disposes the V1 instance after completing provider OAuth", async () => {
    const { api, requests } = setup("v1")

    await api.integration.oauth.complete({
      integrationID: "openrouter",
      attemptID: "openrouter:0",
      code: "code",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/provider/openrouter/oauth/callback",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-opencode-directory")).toBeNull()
  })
})
