// CapabilityService: explicit, deny-first policy evaluation for the CtxPack
export * as Capability from "./service"

// CapabilityService: explicit, deny-first policy evaluation for the CtxPack
// v1 slice. Host-authoritative: workspace membership is a port provided by
// the host at wiring time (M1); finer-grained roles arrive through the
// UserWorkspaceRights provider (defaults to full rights for members in v1).
//
// Policy rules, evaluated in order — the first matching rule decides:
//   1. Not a workspace member                                  -> deny "not-workspace-member"
//   2. Unknown operation                                       -> deny "unknown-operation"
//   3. CtxPack sensitivity "private" and not the creator       -> deny "private-pack-not-owned" (every operation)
//   4. Every right in requiredRights[operation] must be granted -> deny "insufficient-rights:<right>"
//   5. Explicit deny list (denyRules, built-in, extendable)     -> deny "explicit-deny"
//
// No secret material ever appears in subjects, results, or errors, and this
// module never logs content.

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode, tags } from "../effect/app-node"
import { LayerNode } from "../effect/layer-node"
import { requiredRights } from "./operations"
import type { CtxPackOperation } from "./operations"
import type { CapabilitySubject, Right } from "./subjects"

// --- Ports ---------------------------------------------------------------

// Provided by the host at wiring time (M1). Tests use a fake. The exported
// port (workspaceMembershipPort) is unbound — hosts replace it via
// AppNodeBuilder replacements; workspaceMembershipLive is the safe
// deny-by-default stand-in until M1 wires the real membership source.
export interface WorkspaceMembership {
  readonly isMember: (userID: string, workspaceID: string) => Effect.Effect<boolean>
}
export class WorkspaceMembershipService extends Context.Service<
  WorkspaceMembershipService,
  WorkspaceMembership
>()("@opencode/v2/WorkspaceMembership") {}

export const workspaceMembershipPort = LayerNode.unbound(WorkspaceMembershipService, tags.values.global)

// Deny-by-default v1 stand-in: until M1 provides the real membership source,
// nobody is a member, so every check denies (deny-first).
export const workspaceMembershipLive = LayerNode.make({
  service: WorkspaceMembershipService,
  layer: Layer.succeed(WorkspaceMembershipService, {
    isMember: () => Effect.succeed(false),
  }),
  deps: [],
})

// Policy hook for finer roles. v1 default: membership confers every right.
// M1 swaps in the real role provider later; tests inject read-only /
// write-only providers.
export interface UserWorkspaceRights {
  readonly rightsFor: (userID: string, workspaceID: string) => Effect.Effect<Right[]>
}
export class UserWorkspaceRightsService extends Context.Service<
  UserWorkspaceRightsService,
  UserWorkspaceRights
>()("@opencode/v2/UserWorkspaceRights") {}

export const DefaultUserWorkspaceRights: UserWorkspaceRights = {
  rightsFor: () => Effect.succeed(["read", "write", "execute"]),
}

// Built-in explicit deny list. Frozen shape: entries match an operation name
// against a subject type ("Workspace" | "FunctionalityInstance" | "CtxPack").
// Empty in v1; future code may extend it (e.g. to hard-deny operations on
// specific functionality kinds). Rule 5 — an entry wins over granted rights.
export const denyRules: Array<{ operation: string; subjectType: string }> = []

// --- Input / output --------------------------------------------------------

export interface CapabilityCheckInput {
  userID: string
  operation: string
  subject: CapabilitySubject
}

export interface CapabilityResult {
  allowed: boolean
  reason?: string
}

// Frozen error shape consumed by other lanes: { _tag: "CtxPackPermissionDenied", operation }.
// M1 aligns this import with the S1 schema union.
export class CtxPackPermissionDeniedError extends Schema.TaggedErrorClass<CtxPackPermissionDeniedError>()(
  "CtxPackPermissionDenied",
  { operation: Schema.String },
) {}
export type CtxPackPermissionDeniedLike = CtxPackPermissionDeniedError

// --- Service ----------------------------------------------------------------

export interface Interface {
  readonly check: (input: CapabilityCheckInput) => Effect.Effect<CapabilityResult>
  readonly require: (input: CapabilityCheckInput) => Effect.Effect<void, CtxPackPermissionDeniedLike>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Capability") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const membership = yield* WorkspaceMembershipService
    // UserWorkspaceRights is an optional refinement: absent, members get the
    // v1 default of all three rights.
    const rightsProvider = Context.getOption(yield* Effect.context(), UserWorkspaceRightsService).pipe(
      Option.getOrElse(() => DefaultUserWorkspaceRights),
    )

    const check: Interface["check"] = Effect.fn("Capability.check")(function* (input) {
      // 1. Membership is the outer gate: every subject is workspace-scoped.
      if (!(yield* membership.isMember(input.userID, input.subject.workspaceID))) {
        return { allowed: false, reason: "not-workspace-member" }
      }
      // 2. Unknown operations are denied by default.
      const required = requiredRights[input.operation as CtxPackOperation]
      if (!required) {
        return { allowed: false, reason: "unknown-operation" }
      }
      // 3. Private packs are creator-only, for every operation.
      if (
        input.subject.type === "CtxPack" &&
        input.subject.sensitivity === "private" &&
        input.subject.createdByUserID !== input.userID
      ) {
        return { allowed: false, reason: "private-pack-not-owned" }
      }
      // 4. Required rights must all be granted.
      const granted = yield* rightsProvider.rightsFor(input.userID, input.subject.workspaceID)
      for (const right of required) {
        if (!granted.includes(right)) {
          return { allowed: false, reason: `insufficient-rights:${right}` }
        }
      }
      // 5. Explicit deny list wins over rights.
      if (
        denyRules.some((rule) => rule.operation === input.operation && rule.subjectType === input.subject.type)
      ) {
        return { allowed: false, reason: "explicit-deny" }
      }
      return { allowed: true }
    })

    const require: Interface["require"] = Effect.fn("Capability.require")(function* (input) {
      const result = yield* check(input)
      if (!result.allowed) {
        return yield* new CtxPackPermissionDeniedError({ operation: input.operation })
      }
    })

    return Service.of({ check, require })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [workspaceMembershipLive] })
