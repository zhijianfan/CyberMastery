import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createServerSession } from "./server-session"

test("canvas sessions hydrate and stream canonical responses on a legacy-capable server", async () => {
  const paths: string[] = []
  const client = createOpencodeClient({
    baseUrl: "http://canvas.test",
    fetch: Object.assign(
      async (request: RequestInfo | URL) => {
        const path = new URL(request instanceof Request ? request.url : String(request)).pathname
        paths.push(path)
        const data = path.endsWith("/active")
          ? { data: { ses_operating: { type: "running" } } }
          : path.endsWith("/message")
            ? { data: [{ id: "msg_user", type: "user", text: "Show the workspace", time: { created: 1 } }], cursor: {} }
            : {
                data: {
                  id: "ses_operating",
                  title: "Operating",
                  location: { directory: "/repo" },
                  agent: "build",
                  model: { providerID: "test", id: "test" },
                  time: { created: 1, updated: 1 },
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  cost: 0,
                },
              }
        return Response.json(data)
      },
      { preconnect: () => {} },
    ),
  })
  const store = createServerSession(client, { protocol: Promise.resolve("v1") })
  store.bindV2("ses_operating")
  await store.sync("ses_operating")
  expect(paths).toEqual(["/api/session/ses_operating", "/api/session/ses_operating/message", "/api/session/active"])
  expect(store.data.session_working("ses_operating")).toBe(true)
  const event = (type: string, data: Record<string, unknown>) => ({
    id: `evt_${type}`,
    type,
    properties: { sessionID: "ses_operating", timestamp: 2, ...data },
  })
  store.apply(
    event("session.next.step.started", {
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
    }),
  )
  store.apply(event("session.next.text.started", { assistantMessageID: "msg_assistant", textID: "text_1" }))
  store.apply(
    event("session.next.text.delta", {
      assistantMessageID: "msg_assistant",
      textID: "text_1",
      delta: "Workspace response",
    }),
  )
  expect(store.data.part.msg_assistant).toMatchObject([{ type: "text", text: "Workspace response" }])
  expect(store.data.message.ses_operating.map((item) => item.id)).toEqual(["msg_user", "msg_assistant"])
  expect(store.data.message.ses_master).toBeUndefined()
  store.apply({ type: "session.status", properties: { sessionID: "ses_operating", status: { type: "idle" } } })
  expect(store.data.session_working("ses_operating")).toBe(false)
})

test("canonical status snapshots recover completion without replacing newer status events", async () => {
  const requests = [
    Promise.withResolvers<(response: Response) => void>(),
    Promise.withResolvers<(response: Response) => void>(),
  ]
  const remaining = [...requests]
  const client = createOpencodeClient({
    baseUrl: "http://canvas.test",
    fetch: Object.assign(
      (request: RequestInfo | URL) => {
        const path = new URL(request instanceof Request ? request.url : String(request)).pathname
        if (path !== "/api/session/active") return Promise.resolve(Response.json({}, { status: 404 }))
        return new Promise<Response>((resolve) => remaining.shift()!.resolve(resolve))
      },
      { preconnect: () => {} },
    ),
  })
  const store = createServerSession(client, { protocol: Promise.resolve("v1") })
  store.bindV2("ses_operating")
  const status = (type: "busy" | "idle") =>
    store.apply({ type: "session.status", properties: { sessionID: "ses_operating", status: { type } } })
  status("busy")
  const completed = store.refreshV2Status()
  const complete = await requests[0].promise
  complete(Response.json({ data: {} }))
  await completed
  expect(store.data.session_working("ses_operating")).toBe(false)

  const stale = store.refreshV2Status()
  const finish = await requests[1].promise
  status("busy")
  finish(Response.json({ data: {} }))
  await stale
  expect(store.data.session_working("ses_operating")).toBe(true)
})

test("a reconnect status snapshot supersedes an older hydration snapshot", async () => {
  const requests = [
    Promise.withResolvers<(response: Response) => void>(),
    Promise.withResolvers<(response: Response) => void>(),
  ]
  const remaining = [...requests]
  const client = createOpencodeClient({
    baseUrl: "http://canvas.test",
    fetch: Object.assign(() => new Promise<Response>((resolve) => remaining.shift()!.resolve(resolve)), {
      preconnect: () => {},
    }),
  })
  const store = createServerSession(client, { protocol: Promise.resolve("v1") })
  store.bindV2("ses_operating")
  const older = store.refreshV2Status()
  const first = await requests[0].promise
  const newer = store.refreshV2Status()
  const second = await requests[1].promise
  second(Response.json({ data: { ses_operating: { type: "running" } } }))
  await newer
  first(Response.json({ data: {} }))
  await older
  expect(store.data.session_working("ses_operating")).toBe(true)
})
