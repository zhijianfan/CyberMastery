export * as SessionContextTransferReadiness from "./context-transfer-readiness"

import { Clock, Context, Deferred, Effect, Layer, Schema, Semaphore } from "effect"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { WorkspaceV2 } from "../workspace"
import { SessionSchema } from "./schema"

const proofBrand = Symbol()
export interface RequestProof {
  readonly [proofBrand]: true
  readonly topologyRevision: string
  readonly requestToken: string
}

export interface LeaseInput {
  readonly version: 1
  readonly workspaceID?: WorkspaceV2.ID
  readonly topologyRevision: string
  readonly expiresAt: number
  readonly requestToken: string
}

export interface LeaseAck {
  readonly acceptedRevision: string
  readonly expiresAt: number
}

export class LeaseConflict extends Schema.TaggedErrorClass<LeaseConflict>()(
  "SessionContextTransferReadiness.LeaseConflict",
  { reason: Schema.String },
) {}

export type Mode = "v1-local-explicit" | "v1-clean-only" | "v2-enriched"

export interface Interface {
  readonly withPermit: <A, E, R>(
    input: {
      readonly sessionID: SessionSchema.ID
      readonly workspaceID?: WorkspaceV2.ID
      readonly proof?: RequestProof
    },
    run: (mode: Mode) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionContextTransferReadiness") {}

export interface ManagerInterface {
  readonly grant: (input: LeaseInput) => Effect.Effect<LeaseAck, LeaseConflict>
  readonly revoke: (input: LeaseInput) => Effect.Effect<LeaseAck, LeaseConflict>
}

export class Manager extends Context.Service<Manager, ManagerInterface>()(
  "@opencode/v2/SessionContextTransferReadinessManager",
) {}

export const node = LayerNode.unbound(Service, tags.values.global)

const modeLayer = (mode: Mode) => Layer.succeed(Service, Service.of({ withPermit: (_input, run) => run(mode) }))

export const localOnlyLayer = modeLayer("v1-local-explicit")
export const localEnrichedLayer = modeLayer("v2-enriched")
export const v2EnrichedLayer = localEnrichedLayer
export const managedNotReadyLayer = modeLayer("v1-clean-only")

export const localOnlyNode = makeGlobalNode({ service: Service, layer: localOnlyLayer, deps: [] })
export const localEnrichedNode = makeGlobalNode({ service: Service, layer: localEnrichedLayer, deps: [] })
export const v2EnrichedNode = localEnrichedNode
export const managedNotReadyNode = makeGlobalNode({ service: Service, layer: managedNotReadyLayer, deps: [] })

type LeaseState = LeaseInput & {
  readonly expiresAt: number
  accepting: boolean
  active: number
  drained?: Deferred.Deferred<void>
}

class ManagedState extends Context.Service<ManagedState, { readonly lock: Semaphore.Semaphore; lease?: LeaseState }>()(
  "@opencode/v2/SessionContextTransferReadinessState",
) {}

export const LEASE_DURATION_MS = 30_000

const managedStateNode = makeGlobalNode({
  service: ManagedState,
  layer: Layer.sync(ManagedState, () => ({ lock: Semaphore.makeUnsafe(1) })),
  deps: [],
})

const managedReadinessLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* ManagedState
    return Service.of({
      withPermit: (input, run) =>
        Effect.acquireUseRelease(
          state.lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              const lease = state.lease
              if (lease && lease.expiresAt <= now) {
                lease.accepting = false
                if (lease.active === 0) state.lease = undefined
              }
              const current = state.lease
              if (
                !current?.accepting ||
                !input.proof ||
                (current.workspaceID !== undefined && input.workspaceID !== current.workspaceID) ||
                input.proof.topologyRevision !== current.topologyRevision ||
                input.proof.requestToken !== current.requestToken
              )
                return false
              current.active++
              return true
            }),
          ),
          (acquired) => run(acquired ? "v2-enriched" : "v1-clean-only"),
          (acquired) => {
            if (!acquired) return Effect.void
            return state.lock.withPermit(
              Effect.gen(function* () {
                const lease = state.lease
                if (!lease) return
                lease.active--
                if (lease.active !== 0 || lease.accepting) return
                if (lease.drained) yield* Deferred.succeed(lease.drained, undefined)
                state.lease = undefined
              }),
            )
          },
        ),
    })
  }),
)

const managedManagerLayer = Layer.effect(
  Manager,
  Effect.gen(function* () {
    const state = yield* ManagedState
    const grant = (input: LeaseInput): Effect.Effect<LeaseAck, LeaseConflict> =>
      Effect.gen(function* () {
        const result = yield* state.lock.withPermit(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            if (!/^[0-9a-f]{64}$/i.test(input.requestToken) || input.expiresAt <= now)
              return yield* new LeaseConflict({ reason: "invalid readiness lease" })
            const expired = state.lease
            if (expired && expired.expiresAt <= now) {
              expired.accepting = false
              if (expired.active > 0) {
                expired.drained ??= yield* Deferred.make<void>()
                return { _tag: "Wait" as const, drained: expired.drained }
              }
              state.lease = undefined
            }
            const current = state.lease
            if (
              current &&
              (current.workspaceID !== input.workspaceID ||
                current.topologyRevision !== input.topologyRevision ||
                current.requestToken !== input.requestToken)
            )
              return yield* new LeaseConflict({ reason: "conflicting readiness lease" })
            const expiresAt = Math.min(input.expiresAt, now + LEASE_DURATION_MS)
            state.lease = current
              ? Object.assign(current, { expiresAt, accepting: true })
              : { ...input, expiresAt, accepting: true, active: 0 }
            return { _tag: "Granted" as const, ack: { acceptedRevision: input.topologyRevision, expiresAt } }
          }),
        )
        if (result._tag === "Granted") return result.ack
        yield* Deferred.await(result.drained)
        return yield* grant(input)
      })
    return Manager.of({
      grant,
      revoke: (input) =>
        Effect.gen(function* () {
          const result = yield* state.lock.withPermit(
            Effect.gen(function* () {
              const current = state.lease
              if (!current) return { ack: { acceptedRevision: input.topologyRevision, expiresAt: input.expiresAt } }
              if (
                current.workspaceID !== input.workspaceID ||
                current.topologyRevision !== input.topologyRevision ||
                current.requestToken !== input.requestToken
              )
                return yield* new LeaseConflict({ reason: "conflicting readiness lease" })
              current.accepting = false
              if (current.active === 0) {
                state.lease = undefined
                return { ack: { acceptedRevision: current.topologyRevision, expiresAt: current.expiresAt } }
              }
              current.drained ??= yield* Deferred.make<void>()
              return {
                ack: { acceptedRevision: current.topologyRevision, expiresAt: current.expiresAt },
                drained: current.drained,
              }
            }),
          )
          if (result.drained) yield* Deferred.await(result.drained)
          return result.ack
        }),
    })
  }),
)

export const managedLeaseNode = makeGlobalNode({
  service: Service,
  layer: managedReadinessLayer,
  deps: [managedStateNode],
})
export const managedLeaseManagerNode = makeGlobalNode({
  service: Manager,
  layer: managedManagerLayer,
  deps: [managedStateNode],
})
export const managedLeaseLayer = LayerNode.compile(LayerNode.group([managedLeaseNode, managedLeaseManagerNode]))

export function makeRequestProof(input: {
  readonly topologyRevision: string
  readonly requestToken: string
}): RequestProof {
  return { [proofBrand]: true, ...input }
}
