export * as SessionContextReadiness from "./session-context-readiness"

import { Clock, Context, Effect, Layer, Schema, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { tags } from "@opencode-ai/core/effect/app-node"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { SessionContextTransferReadiness } from "@opencode-ai/core/session/context-transfer-readiness"
import { createHash, randomBytes } from "node:crypto"

export const TOPOLOGY_HEADER = "x-opencode-session-context-topology"
export const LEASE_HEADER = "x-opencode-session-context-lease"
const proofs = new Map<string, SessionContextTransferReadiness.RequestProof>()
const local = "<local>"

export function currentProof(workspaceID?: WorkspaceV2.ID) {
  return proofs.get(workspaceID ?? local) ?? proofs.get(local)
}

export interface CoordinatorInterface {
  readonly proof: (workspaceID?: WorkspaceV2.ID) => SessionContextTransferReadiness.RequestProof | undefined
  readonly activate: (
    entries: ReadonlyArray<{
      readonly workspaceID?: WorkspaceV2.ID
      readonly topologyRevision: string
      readonly requestToken: string
    }>,
  ) => Effect.Effect<void>
  readonly clear: Effect.Effect<void>
}

export class Coordinator extends Context.Service<Coordinator, CoordinatorInterface>()(
  "@opencode/SessionContextReadinessCoordinator",
) {}

export const coordinatorLayer = Layer.sync(Coordinator, () => {
    return Coordinator.of({
      proof: currentProof,
      activate: (entries) =>
        Effect.sync(() => {
          const next = entries.map((entry) => [
            entry.workspaceID ?? local,
            SessionContextTransferReadiness.makeRequestProof(entry),
          ] as const)
          proofs.clear()
          for (const [workspaceID, proof] of next) proofs.set(workspaceID, proof)
        }),
      clear: Effect.sync(() => proofs.clear()),
    })
  })

export const coordinatorNode = LayerNode.make({
  service: Coordinator,
  layer: coordinatorLayer,
  deps: [],
  tag: tags.values.global,
})

export interface Peer {
  readonly workspaceID?: WorkspaceV2.ID
  readonly endpoint: string
  readonly version: 1
  readonly probe: Effect.Effect<{ readonly transferRequired: boolean }, unknown>
  readonly grant: (
    lease: SessionContextTransferReadiness.LeaseInput,
  ) => Effect.Effect<SessionContextTransferReadiness.LeaseAck, unknown>
  readonly revoke: (
    lease: SessionContextTransferReadiness.LeaseInput,
  ) => Effect.Effect<SessionContextTransferReadiness.LeaseAck & { readonly transferRequired: boolean }, unknown>
}

export class TopologyError extends Schema.TaggedErrorClass<TopologyError>()(
  "SessionContextReadiness.TopologyError",
  { phase: Schema.Literals(["probe", "grant", "renew", "revoke"]), cause: Schema.Defect() },
) {}

export function makeOrchestrator(input: {
  readonly coordinator: CoordinatorInterface
  readonly now?: Effect.Effect<number>
  readonly token?: () => string
}) {
  const lock = Semaphore.makeUnsafe(1)
  const now = input.now ?? Clock.currentTimeMillis
  const token = input.token ?? (() => randomBytes(32).toString("hex"))
  let active:
    | {
        readonly peers: ReadonlyArray<Peer>
        readonly topologyRevision: string
        readonly requestToken: string
        expiresAt: number
      }
    | undefined

  const revoke = (state: NonNullable<typeof active>) =>
    Effect.gen(function* () {
      yield* input.coordinator.clear
      const results = yield* Effect.forEach(
        state.peers,
        (peer) =>
          peer
            .revoke({
              version: 1,
              workspaceID: peer.workspaceID,
              topologyRevision: state.topologyRevision,
              requestToken: state.requestToken,
              expiresAt: state.expiresAt,
            })
            .pipe(Effect.mapError((cause) => new TopologyError({ phase: "revoke", cause }))),
        { concurrency: "unbounded" },
      )
      active = undefined
      return results.some((result) => result.transferRequired)
    })

  const grant = (peers: ReadonlyArray<Peer>, phase: "grant" | "renew", previous?: NonNullable<typeof active>) =>
    Effect.gen(function* () {
      const topologyRevision = revision(peers)
      const requestToken = previous?.topologyRevision === topologyRevision ? previous.requestToken : token()
      const expiresAt = (yield* now) + SessionContextTransferReadiness.LEASE_DURATION_MS
      const acknowledged: Peer[] = []
      const failure = yield* Effect.forEach(
        peers,
        (peer) =>
          peer
            .grant({ version: 1, workspaceID: peer.workspaceID, topologyRevision, requestToken, expiresAt })
            .pipe(Effect.tap(() => Effect.sync(() => acknowledged.push(peer)))),
        { discard: true },
      ).pipe(
        Effect.as(undefined),
        Effect.catch((error) => Effect.succeed({ error })),
      )
      if (failure) {
        yield* input.coordinator.clear
        yield* Effect.forEach(
          acknowledged,
          (peer) =>
            peer
              .revoke({ version: 1, workspaceID: peer.workspaceID, topologyRevision, requestToken, expiresAt })
              .pipe(Effect.ignore),
          { concurrency: "unbounded", discard: true },
        )
        active = undefined
        return yield* new TopologyError({ phase, cause: failure.error })
      }
      active = { peers, topologyRevision, requestToken, expiresAt }
      yield* input.coordinator.activate(
        peers.map((peer) => ({ workspaceID: peer.workspaceID, topologyRevision, requestToken })),
      )
      return { topologyRevision, expiresAt }
    })

  return {
    activate: (peers: ReadonlyArray<Peer>) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* input.coordinator.clear
          yield* Effect.forEach(peers, (peer) => peer.probe, { concurrency: "unbounded", discard: true }).pipe(
            Effect.mapError((cause) => new TopologyError({ phase: "probe", cause })),
          )
          return yield* grant(peers, "grant")
        }),
      ),
    renew: lock.withPermit(
      Effect.gen(function* () {
        if (!active) return
        return yield* grant(active.peers, "renew", active)
      }),
    ),
    beforeMutation: lock.withPermit(
      Effect.gen(function* () {
        if (!active) return false
        return yield* revoke(active)
      }),
    ),
    revision: () => active?.topologyRevision,
  }
}

function revision(peers: ReadonlyArray<Peer>) {
  return createHash("sha256")
    .update(
      peers
        .map((peer) => `${peer.workspaceID ?? ""}\0${peer.endpoint}\0${peer.version}`)
        .sort()
        .join("\n"),
    )
    .digest("hex")
}

export class PrivateTransportError extends Schema.TaggedErrorClass<PrivateTransportError>()(
  "SessionContextReadiness.PrivateTransportError",
  { protocol: Schema.String, hostname: Schema.String },
) {}

export class PrivateRedirectError extends Schema.TaggedErrorClass<PrivateRedirectError>()(
  "SessionContextReadiness.PrivateRedirectError",
  { status: Schema.Number },
) {}

export function validateTarget(input: {
  readonly url: string | URL
  readonly confidential?: boolean
}): Effect.Effect<URL, PrivateTransportError> {
  return Effect.try({
    try: () => new URL(input.url),
    catch: () => new PrivateTransportError({ protocol: "invalid", hostname: "invalid" }),
  }).pipe(
    Effect.flatMap((url) => {
      if (input.confidential || url.protocol === "https:") return Effect.succeed(url)
      if (url.protocol === "http:" && isLoopback(url.hostname)) return Effect.succeed(url)
      return Effect.fail(new PrivateTransportError({ protocol: url.protocol, hostname: url.hostname }))
    }),
  )
}

export function executePrivate(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  options?: { readonly confidential?: boolean },
) {
  return Effect.gen(function* () {
    yield* validateTarget({ url: request.url, confidential: options?.confidential })
    const response = yield* client.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    )
    if (response.status >= 300 && response.status < 400)
      return yield* new PrivateRedirectError({ status: response.status })
    return response
  })
}

function isLoopback(hostname: string) {
  if (hostname === "::1" || hostname === "[::1]") return true
  const octets = hostname.split(".")
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  )
}
