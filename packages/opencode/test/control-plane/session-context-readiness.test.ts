import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  FetchHttpClient,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import Http from "node:http"
import { SessionContextReadiness } from "../../src/control-plane/session-context-readiness"
import { testEffect } from "../lib/effect"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer, FetchHttpClient.layer))

const listen = (handler: (request: HttpServerRequest.HttpServerRequest) => HttpServerResponse.HttpServerResponse) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(HttpServerRequest.HttpServerRequest.use((request) => Effect.succeed(handler(request))))
    return HttpServer.formatAddress(server.address)
  })

describe("session context readiness transport policy", () => {
  test("allows only HTTPS, literal 127/8 or ::1 HTTP, and adapter-confidential transports", async () => {
    for (const target of [
      { url: "http://127.0.0.1:3000" },
      { url: "http://127.255.1.9:3000" },
      { url: "http://[::1]:3000" },
      { url: "https://workspace.example" },
      { url: "http://workspace.example", confidential: true },
    ]) {
      expect(await Effect.runPromise(SessionContextReadiness.validateTarget(target))).toBeInstanceOf(URL)
    }

    for (const url of [
      "http://localhost:3000",
      "http://workspace.example",
      "http://127.example.com",
      "http://[::ffff:127.0.0.1]:3000",
    ]) {
      const exit = await Effect.runPromiseExit(SessionContextReadiness.validateTarget({ url }))
      expect(String(exit)).toContain("SessionContextReadiness.PrivateTransportError")
    }
  })

  it.live("rejects redirects without forwarding credentials, proof, or prompt body", () =>
    Effect.gen(function* () {
      let redirected: { headers: Record<string, string>; body: string } | undefined
      const destination = yield* listen((request) => {
        redirected = { headers: request.headers, body: "contacted" }
        return HttpServerResponse.text("unexpected")
      })
      const redirector = yield* listen(() =>
        HttpServerResponse.empty({ status: 307, headers: { location: `${destination}/stolen` } }),
      )
      const client = yield* HttpClient.HttpClient
      const exit = yield* SessionContextReadiness.executePrivate(
        client,
        HttpClientRequest.post(`${redirector}/api/session/ses_test/prompt`, {
          headers: {
            authorization: "Basic secret",
            "x-opencode-session-context-topology": "revision",
            "x-opencode-session-context-lease": "token",
          },
          body: HttpBody.jsonUnsafe({ prompt: "PRIVATE_PROMPT" }),
        }),
      ).pipe(Effect.exit)

      expect(String(exit)).toContain("SessionContextReadiness.PrivateRedirectError")
      expect(redirected).toBeUndefined()
    }),
  )
})

describe("session context readiness topology", () => {
  test("drains the unauthenticated self permit before activating the first remote topology", async () => {
    const workspaceID = WorkspaceV2.ID.make("wrk_first_remote")
    const proofs = new Map<string, SessionContextTransferReadiness.RequestProof>()
    const calls: string[] = []
    const coordinator: SessionContextReadiness.CoordinatorInterface = {
      proof: (id) => proofs.get(id ?? "local"),
      activate: (entries) =>
        Effect.sync(() =>
          entries.forEach((entry) =>
            proofs.set(entry.workspaceID ?? "local", SessionContextTransferReadiness.makeRequestProof(entry)),
          ),
        ),
      clear: Effect.sync(() => proofs.clear()),
    }
    const peer = (id?: WorkspaceV2.ID): SessionContextReadiness.Peer => ({
      workspaceID: id,
      endpoint: id ? `https://${id}` : "in-process",
      version: 1,
      probe: Effect.sync(() => {
        calls.push(`probe:${id ?? "local"}`)
        return { transferRequired: false }
      }),
      grant: (lease) =>
        Effect.sync(() => {
          calls.push(`grant:${id ?? "local"}`)
          return { acceptedRevision: lease.topologyRevision, expiresAt: lease.expiresAt }
        }),
      revoke: (lease) =>
        Effect.sync(() => {
          calls.push(`revoke:${id ?? "local"}`)
          return {
            acceptedRevision: lease.topologyRevision,
            expiresAt: lease.expiresAt,
            transferRequired: false,
          }
        }),
    })
    const tokens = ["a".repeat(64), "b".repeat(64)]
    const orchestrator = SessionContextReadiness.makeOrchestrator({
      coordinator,
      now: Effect.succeed(1_000),
      token: () => tokens.shift()!,
    })

    await Effect.runPromise(orchestrator.activate([peer()]))
    expect(proofs.has("local")).toBeTrue()
    expect(await Effect.runPromise(orchestrator.beforeMutation)).toBeFalse()
    expect(proofs.size).toBe(0)
    await Effect.runPromise(orchestrator.activate([peer(), peer(workspaceID)]))

    expect([...proofs.keys()].sort()).toEqual(["local", workspaceID].sort())
    expect(new Set([...proofs.values()].map((proof) => proof.requestToken))).toEqual(new Set(["b".repeat(64)]))
    expect(calls.indexOf("revoke:local")).toBeLessThan(calls.indexOf(`probe:${workspaceID}`))
  })

  test("publishes proofs only after all grants and revokes every acknowledged peer on failure", async () => {
    const workspaceA = WorkspaceV2.ID.make("wrk_a")
    const workspaceB = WorkspaceV2.ID.make("wrk_b")
    const proofs = new Map<string, unknown>()
    const revoked: string[] = []
    const coordinator: SessionContextReadiness.CoordinatorInterface = {
      proof: (workspaceID) => proofs.get(workspaceID ?? "local") as never,
      activate: (entries) =>
        Effect.sync(() => entries.forEach((entry) => proofs.set(entry.workspaceID ?? "local", entry))),
      clear: Effect.sync(() => proofs.clear()),
    }
    const peer = (workspaceID: WorkspaceV2.ID, fail = false): SessionContextReadiness.Peer => ({
      workspaceID,
      endpoint: `https://${workspaceID}`,
      version: 1,
      probe: Effect.succeed({ transferRequired: false }),
      grant: (lease) =>
        fail
          ? Effect.fail("grant failed")
          : Effect.sync(() => {
              expect(proofs.size).toBe(0)
              return { acceptedRevision: lease.topologyRevision, expiresAt: lease.expiresAt }
            }),
      revoke: (lease) =>
        Effect.sync(() => {
          revoked.push(workspaceID)
          return {
            acceptedRevision: lease.topologyRevision,
            expiresAt: lease.expiresAt,
            transferRequired: false,
          }
        }),
    })
    const orchestrator = SessionContextReadiness.makeOrchestrator({
      coordinator,
      now: Effect.succeed(1_000),
      token: () => "a".repeat(64),
    })

    await Effect.runPromise(orchestrator.activate([peer(workspaceA), peer(workspaceB)]))
    expect(proofs.size).toBe(2)
    const failed = await Effect.runPromiseExit(orchestrator.activate([peer(workspaceA), peer(workspaceB, true)]))
    expect(String(failed)).toContain("SessionContextReadiness.TopologyError")
    expect(proofs.size).toBe(0)
    expect(revoked).toContain(workspaceA)
  })

  test("reuses the token for renewal and unions drained transfer-required results", async () => {
    const workspaceA = WorkspaceV2.ID.make("wrk_a")
    const workspaceB = WorkspaceV2.ID.make("wrk_b")
    const tokens: string[] = []
    let now = 1_000
    const coordinator: SessionContextReadiness.CoordinatorInterface = {
      proof: () => undefined,
      activate: () => Effect.void,
      clear: Effect.void,
    }
    const peer = (workspaceID: WorkspaceV2.ID, transferRequired: boolean): SessionContextReadiness.Peer => ({
      workspaceID,
      endpoint: `https://${workspaceID}`,
      version: 1,
      probe: Effect.succeed({ transferRequired }),
      grant: (lease) =>
        Effect.sync(() => {
          tokens.push(lease.requestToken)
          return { acceptedRevision: lease.topologyRevision, expiresAt: lease.expiresAt }
        }),
      revoke: (lease) =>
        Effect.succeed({
          acceptedRevision: lease.topologyRevision,
          expiresAt: lease.expiresAt,
          transferRequired,
        }),
    })
    const orchestrator = SessionContextReadiness.makeOrchestrator({
      coordinator,
      now: Effect.sync(() => now),
      token: () => "b".repeat(64),
    })

    await Effect.runPromise(orchestrator.activate([peer(workspaceA, false), peer(workspaceB, true)]))
    now += 10_000
    await Effect.runPromise(orchestrator.renew)
    expect(new Set(tokens).size).toBe(1)
    expect(await Effect.runPromise(orchestrator.beforeMutation)).toBe(true)
  })
})
