import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Workspace } from "@opencode-ai/schema/workspace"
import { MasterAgentContext } from "../../src/session/master-agent-context"
import { SessionID } from "../../src/session/schema"

const workspaceID = Workspace.ID.make("wrk_test_1")
const sessionID = SessionID.make("session-test-1")
const otherSessionID = SessionID.make("session-test-2")
const blockID = "block-test-1"

const ownedConfiguration = {
  version: 1,
  directoryBinding: { mode: "workspace-primary" },
  sessionBinding: { mode: "owned", sessionID, generation: 0 },
}

const instance = (
  configuration: unknown = ownedConfiguration,
  overrides: Partial<MasterAgentContext.MasterAgentInstance> = {},
): MasterAgentContext.MasterAgentInstance => ({
  instanceID: "instance-test-1",
  blockID,
  revision: 3,
  configuration,
  ...overrides,
})

const defaultWorkspace: MasterAgentContext.WorkspaceRecord = {
  directories: ["/work/a", "/work/b"],
  model: "anthropic:claude-sonnet-4",
  operatingAgent: "openai/gpt-5.5",
  coderModel: "openai:gpt-4o",
}

const defaultSession: MasterAgentContext.SessionRecord = { workspaceID, permission: [] }

const source = (
  overrides: Partial<MasterAgentContext.MasterAgentContextSource> = {},
): MasterAgentContext.MasterAgentContextSource => ({
  session: () => Effect.succeed(defaultSession),
  workspace: () => Effect.succeed(defaultWorkspace),
  instances: () => Effect.succeed([instance()]),
  ...overrides,
})

const resolverLayer = Layer.effect(
  MasterAgentContext.Service,
  Effect.gen(function* () {
    const src = yield* MasterAgentContext.Source
    return MasterAgentContext.Service.of(MasterAgentContext.makeResolver(src))
  }),
)

const run = <A, E>(
  fake: MasterAgentContext.MasterAgentContextSource,
  self: Effect.Effect<A, E, MasterAgentContext.Service>,
) =>
  self.pipe(
    Effect.provide(
      Layer.provideMerge(resolverLayer, Layer.succeed(MasterAgentContext.Source, MasterAgentContext.Source.of(fake))),
    ),
    Effect.runPromise,
  )

const resolve = () =>
  Effect.gen(function* () {
    const service = yield* MasterAgentContext.Service
    return yield* service.resolve(sessionID)
  })

describe("MasterAgentContext.resolve", () => {
  test("returns not-master-agent for an ordinary session without a workspace", async () => {
    const result = await run(source({ session: () => Effect.succeed({}) }), resolve())
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("returns not-master-agent for a child session", async () => {
    const result = await run(
      source({
        session: () => Effect.succeed({ workspaceID, parentID: SessionID.make("session-parent-1") }),
      }),
      resolve(),
    )
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("returns not-master-agent when no instance owns the session", async () => {
    const result = await run(source({ instances: () => Effect.succeed([]) }), resolve())
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("returns not-master-agent for a stale binding owned by another session", async () => {
    const stale = {
      ...ownedConfiguration,
      sessionBinding: { mode: "owned", sessionID: otherSessionID, generation: 1 },
    }
    const result = await run(source({ instances: () => Effect.succeed([instance(stale)]) }), resolve())
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("returns not-master-agent for an unbound instance", async () => {
    const unbound = { ...ownedConfiguration, sessionBinding: null }
    const result = await run(source({ instances: () => Effect.succeed([instance(unbound)]) }), resolve())
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("returns not-master-agent when the configuration does not decode", async () => {
    const result = await run(
      source({ instances: () => Effect.succeed([instance({ version: 99, sessionBinding: "junk" })]) }),
      resolve(),
    )
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("resolves a valid binding to the full host context", async () => {
    const result = await run(source(), resolve())
    expect(result).toMatchObject({
      status: "master-agent",
      context: {
        workspaceID,
        blockID,
        functionalityInstanceID: "instance-test-1",
        parentSessionID: sessionID,
        directory: "/work/a",
        primaryModel: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        operatingAgent: "openai/gpt-5.5",
        coderModel: { providerID: "openai", modelID: "gpt-4o" },
        taskPermission: "default",
      },
    })
  })

  test("rejects a binding whose workspace is missing", async () => {
    const error = await run(source({ workspace: () => Effect.succeed(undefined) }), resolve().pipe(Effect.flip))
    expect(error).toMatchObject({ _tag: "MasterAgentContext.WorkspaceNotFoundError", workspaceID })
  })

  test("fails when the session record is missing", async () => {
    const error = await run(source({ session: () => Effect.succeed(undefined) }), resolve().pipe(Effect.flip))
    expect(error).toMatchObject({ _tag: "MasterAgentContext.SessionNotFoundError", sessionID })
  })

  test("exposes a cleared Coder model as null", async () => {
    const workspace: MasterAgentContext.WorkspaceRecord = {
      directories: ["/work/a"],
      model: "anthropic:claude-sonnet-4",
      coderModel: undefined,
    }
    const result = await run(source({ workspace: () => Effect.succeed(workspace) }), resolve())
    expect(result).toMatchObject({
      status: "master-agent",
      context: {
        coderModel: null,
        primaryModel: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        operatingAgent: null,
      },
    })
  })

  test("resolves a fixed directory binding", async () => {
    const fixed = {
      ...ownedConfiguration,
      directoryBinding: { mode: "fixed", directory: "/fixed/dir" },
    }
    const result = await run(source({ instances: () => Effect.succeed([instance(fixed)]) }), resolve())
    expect(result).toMatchObject({ status: "master-agent", context: { directory: "/fixed/dir" } })
  })

  test("rejects a workspace-primary binding with no workspace directory", async () => {
    const workspace: MasterAgentContext.WorkspaceRecord = { directories: [] }
    const error = await run(source({ workspace: () => Effect.succeed(workspace) }), resolve().pipe(Effect.flip))
    expect(error).toMatchObject({
      _tag: "MasterAgentContext.UnresolvedDirectoryError",
      workspaceID,
      blockID,
    })
  })

  test("ignores instances of other workspaces (cross-workspace references)", async () => {
    const result = await run(source({ instances: () => Effect.succeed([]) }), resolve())
    expect(result).toMatchObject({ status: "not-master-agent" })
  })

  test("derives task permission from the session ruleset", async () => {
    const cases: Array<{ ruleset: PermissionV1.Ruleset | undefined; expected: MasterAgentContext.TaskPermission }> = [
      { ruleset: undefined, expected: "default" },
      { ruleset: [], expected: "default" },
      { ruleset: [{ permission: "edit", pattern: "*", action: "deny" }], expected: "default" },
      { ruleset: [{ permission: "task", pattern: "*", action: "deny" }], expected: "deny" },
      { ruleset: [{ permission: "task", pattern: "coder", action: "allow" }], expected: "allow" },
      { ruleset: [{ permission: "task", pattern: "*", action: "ask" }], expected: "ask" },
    ]
    for (const { ruleset, expected } of cases) {
      const result = await run(
        source({ session: () => Effect.succeed({ workspaceID, permission: ruleset }) }),
        resolve(),
      )
      expect(result).toMatchObject({ status: "master-agent", context: { taskPermission: expected } })
    }
  })
})

describe("parseModelSelection", () => {
  test("parses canonical providerID:modelID selections", () => {
    expect(MasterAgentContext.parseModelSelection("anthropic:claude-sonnet-4")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  test("parses legacy providerID/modelID selections", () => {
    expect(MasterAgentContext.parseModelSelection("anthropic/claude-sonnet-4")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  test("decodes missing or malformed selections as null", () => {
    expect(MasterAgentContext.parseModelSelection(undefined)).toBeNull()
    expect(MasterAgentContext.parseModelSelection("")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("no-separator")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("provider/model/extra")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("provider:model:extra")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("/model")).toBeNull()
    expect(MasterAgentContext.parseModelSelection(":model")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("provider/")).toBeNull()
    expect(MasterAgentContext.parseModelSelection("provider:")).toBeNull()
  })
})
