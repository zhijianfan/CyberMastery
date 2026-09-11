import { afterEach, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("the local prompt API admits a materialized CtxPack and keeps its target checks", async () => {
  await using tmp = await tmpdir({ git: true })
  const post = (route: string, payload: unknown) =>
    HttpApiApp.webHandler().handler(
      new Request(`http://localhost${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
        body: JSON.stringify(payload),
      }),
      Context.empty() as Context.Context<unknown>,
    )

  const workspaceResponse = await post("/api/workspace", { name: "CtxPack prompt regression" })
  expect(workspaceResponse.status).toBe(200)
  const workspace = (await workspaceResponse.json()) as { id: string }
  const sessionResponse = await post("/api/session", {
    location: { directory: tmp.path, workspaceID: workspace.id },
  })
  expect(sessionResponse.status).toBe(200)
  const session = (await sessionResponse.json()) as { data: { id: string } }
  const packResponse = await post(`/api/workspace/${workspace.id}/ctxpack`, {
    title: "Attached reference",
    keywords: [],
    sensitivity: "workspace",
    idempotencyKey: "prompt-regression",
    fragments: [
      {
        clientFragmentID: "fragment-1",
        text: "Context supplied through the real materialization API.",
        source: {
          workspaceID: workspace.id,
          blockID: "source-block",
          functionalityID: "builtin:chat",
          kind: "message",
          direction: "received",
          sourceTimestamp: 1,
          capturedAt: 1,
          entityRef: null,
          label: "Reference",
          metadata: {},
          sensitivity: "workspace",
        },
      },
    ],
  })
  expect(packResponse.status).toBe(200)
  const pack = (await packResponse.json()) as { id: string; contentHash: string }
  const materialized = await post(`/api/workspace/${workspace.id}/ctxpack/${pack.id}/materialize`, {
    expectedContentHash: pack.contentHash,
    targetInstanceID: `chat-instance:${session.data.id}`,
    targetFunctionalityID: "builtin:chat",
  })
  expect(materialized.status).toBe(200)
  const capsule = (await materialized.json()) as { contextCapsuleID: string; label: string; contentHash: string }
  const prompt = {
    prompt: { text: "Use the attached reference." },
    resume: false,
    contextAttachments: [
      {
        contextCapsuleID: capsule.contextCapsuleID,
        label: capsule.label,
        contentHash: capsule.contentHash,
        source: { kind: "ctxpack", ctxPackID: pack.id },
      },
    ],
  }
  const admitted = await post(`/api/session/${session.data.id}/prompt`, prompt)
  const result: unknown = await admitted.json()
  expect(result).toMatchObject({ data: { sessionID: session.data.id, prompt: prompt.prompt } })
  expect(admitted.status).toBe(200)

  const otherResponse = await post("/api/session", {
    location: { directory: tmp.path, workspaceID: workspace.id },
  })
  expect(otherResponse.status).toBe(200)
  const other = (await otherResponse.json()) as { data: { id: string } }
  const rejected = await post(`/api/session/${other.data.id}/prompt`, prompt)
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toMatchObject({ code: "CtxPackCapsuleTargetMismatch" })
})
