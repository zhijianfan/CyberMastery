import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  denyRules,
  layer,
  Service,
  UserWorkspaceRightsService,
  WorkspaceMembershipService,
} from "@opencode-ai/core/capability/service"
import type { CapabilityCheckInput } from "@opencode-ai/core/capability/service"
import type { CapabilitySubject, Right } from "@opencode-ai/core/capability/subjects"

const ALL: Right[] = ["read", "write", "execute"]
const READ_ONLY: Right[] = ["read"]
const WRITE_ONLY: Right[] = ["write"]

const testLayer = (member: boolean, rights: Right[] = ALL) =>
  Layer.provide(
    Layer.provide(
      layer,
      Layer.succeed(WorkspaceMembershipService, {
        isMember: () => Effect.succeed(member),
      }),
    ),
    Layer.succeed(UserWorkspaceRightsService, {
      rightsFor: () => Effect.succeed(rights),
    }),
  )

const runCheck = (input: CapabilityCheckInput, member: boolean, rights: Right[] = ALL) =>
  Effect.runPromise(
    Effect.provide(
      Service.pipe(Effect.flatMap((service) => service.check(input))),
      testLayer(member, rights),
    ),
  )

const runRequire = (input: CapabilityCheckInput, member: boolean, rights: Right[] = ALL) =>
  Effect.runPromise(
    Effect.provide(
      Service.pipe(Effect.flatMap((service) => service.require(input))),
      testLayer(member, rights),
    ),
  )

// --- Fixtures ----------------------------------------------------------------

const workspace: CapabilitySubject = { type: "Workspace", workspaceID: "wrk_1" }
const chatInstance: CapabilitySubject = {
  type: "FunctionalityInstance",
  workspaceID: "wrk_1",
  instanceID: "inst_1",
  functionalityID: "builtin:chat",
}
const pack = (sensitivity: "public" | "workspace" | "private", owner = "user-1"): CapabilitySubject => ({
  type: "CtxPack",
  workspaceID: "wrk_1",
  ctxPackID: "ctxkpsl_1",
  sensitivity,
  createdByUserID: owner,
})

const ctxpackOps = ["ctxpack.read", "ctxpack.create", "ctxpack.patch", "ctxpack.remove", "ctxpack.restore", "ctxpack.materialize"]

describe("CapabilityService", () => {
  test("member with all rights: every CtxPack operation allowed", async () => {
    for (const operation of ctxpackOps) {
      const result = await runCheck({ userID: "user-1", operation, subject: pack("workspace") }, true)
      expect(result, operation).toEqual({ allowed: true })
    }
  })

  test("read-only user: read + materialize allowed, mutations denied insufficient-rights:write", async () => {
    for (const operation of ["ctxpack.read", "ctxpack.materialize"]) {
      const result = await runCheck({ userID: "user-1", operation, subject: pack("workspace") }, true, READ_ONLY)
      expect(result, operation).toEqual({ allowed: true })
    }
    for (const operation of ["ctxpack.create", "ctxpack.patch", "ctxpack.remove", "ctxpack.restore"]) {
      const result = await runCheck({ userID: "user-1", operation, subject: pack("workspace") }, true, READ_ONLY)
      expect(result, operation).toEqual({ allowed: false, reason: "insufficient-rights:write" })
    }
  })

  test("write-only user: chat.context.attach allowed on FunctionalityInstance; materialize denied insufficient-rights:read", async () => {
    const attach = await runCheck(
      { userID: "user-1", operation: "chat.context.attach", subject: chatInstance },
      true,
      WRITE_ONLY,
    )
    expect(attach).toEqual({ allowed: true })

    const materialize = await runCheck(
      { userID: "user-1", operation: "ctxpack.materialize", subject: pack("workspace") },
      true,
      WRITE_ONLY,
    )
    expect(materialize).toEqual({ allowed: false, reason: "insufficient-rights:read" })
  })

  test("non-member: every operation denied not-workspace-member", async () => {
    const subjects: CapabilitySubject[] = [workspace, chatInstance, pack("public"), pack("workspace"), pack("private")]
    const operations = [...ctxpackOps, "chat.context.attach", "ctxpack.bogus"]
    for (const subject of subjects) {
      for (const operation of operations) {
        const result = await runCheck({ userID: "user-1", operation, subject }, false)
        expect(result, `${operation} on ${subject.type}`).toEqual({ allowed: false, reason: "not-workspace-member" })
      }
    }
  })

  test("private pack: non-owner denied for every operation; owner allowed", async () => {
    const subject = pack("private", "owner-1")
    for (const operation of [...ctxpackOps, "chat.context.attach"]) {
      const denied = await runCheck({ userID: "user-2", operation, subject }, true)
      expect(denied, operation).toEqual({ allowed: false, reason: "private-pack-not-owned" })

      const allowed = await runCheck({ userID: "owner-1", operation, subject }, true)
      expect(allowed, operation).toEqual({ allowed: true })
    }
  })

  test("unknown operation denied unknown-operation", async () => {
    const result = await runCheck({ userID: "user-1", operation: "ctxpack.frobnicate", subject: pack("public") }, true)
    expect(result).toEqual({ allowed: false, reason: "unknown-operation" })
  })

  test("require raises the frozen CtxPackPermissionDenied error on deny and resolves on allow", async () => {
    await expect(
      runRequire({ userID: "user-1", operation: "ctxpack.create", subject: pack("workspace") }, true, READ_ONLY),
    ).rejects.toMatchObject({ _tag: "CtxPackPermissionDenied", operation: "ctxpack.create" })

    await expect(
      runRequire({ userID: "user-1", operation: "ctxpack.read", subject: pack("workspace") }, true),
    ).resolves.toBeUndefined()
  })

  test("explicit deny list entry wins over granted rights", async () => {
    denyRules.push({ operation: "ctxpack.read", subjectType: "CtxPack" })
    try {
      const denied = await runCheck({ userID: "user-1", operation: "ctxpack.read", subject: pack("public") }, true)
      expect(denied).toEqual({ allowed: false, reason: "explicit-deny" })

      // Unrelated operations are unaffected by the entry.
      const allowed = await runCheck({ userID: "user-1", operation: "ctxpack.create", subject: pack("public") }, true)
      expect(allowed).toEqual({ allowed: true })
    } finally {
      denyRules.pop()
    }
  })
})
