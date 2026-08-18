import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Event, Functionality, MasterAgent, Session, Workspace } from "../src/index"

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => (input: unknown) => Schema.decodeUnknownSync(schema)(input)

const workspaceBase = {
  id: "wrk_exports01",
  name: "exports",
  style: "s",
  directories: [],
  pluginIDs: [],
  skillIDs: [],
  git: [],
  time: { created: 0, updated: 0 },
}

describe("schema public exports", () => {
  test("Workspace exposes Info with the workspace-wide coderModel field", () => {
    const info: Workspace.Info = decode(Workspace.Info)({
      ...workspaceBase,
      coderModel: "anthropic/claude-sonnet-4",
    })
    expect(info.coderModel).toBe("anthropic/claude-sonnet-4")
    expect(decode(Workspace.Info)(workspaceBase).coderModel).toBeUndefined()
  })

  test("Workspace.ID constructors are public through the barrel", () => {
    const created: Workspace.ID = Workspace.ID.create()
    expect(created.startsWith("wrk_")).toBe(true)
    const made: Workspace.ID = Workspace.ID.make("wrk_exact01")
    expect(Schema.encodeSync(Workspace.ID)(made)).toBe("wrk_exact01")
    expect(Schema.encodeSync(Workspace.ID)(Workspace.ID.ascending("wrk_exact02"))).toBe("wrk_exact02")
  })

  test("MasterAgent contract symbols are exported through the barrel", () => {
    const functionalityID: MasterAgent.FunctionalityID = "builtin:master-agent"
    expect(decode(MasterAgent.FunctionalityID)("builtin:master-agent")).toBe(functionalityID)

    expect(decode(MasterAgent.DirectoryBinding)({ mode: "workspace-primary" })).toEqual({ mode: "workspace-primary" })
    expect(decode(MasterAgent.DirectoryBinding)({ mode: "fixed", directory: "/tmp" })).toEqual({
      mode: "fixed",
      directory: "/tmp",
    })

    const owned: MasterAgent.SessionBinding = decode(MasterAgent.SessionBinding)({
      mode: "owned",
      sessionID: "ses_bound01",
      generation: 3,
    })
    expect(owned).toEqual({ mode: "owned", sessionID: Session.ID.make("ses_bound01"), generation: 3 })
    expect(decode(MasterAgent.SessionBinding)(null)).toBeNull()

    const config: MasterAgent.InstanceConfiguration = decode(MasterAgent.InstanceConfiguration)({
      version: 1,
      directoryBinding: { mode: "workspace-primary" },
      sessionBinding: null,
    })
    expect(config).toEqual({ version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null })

    const binding: MasterAgent.Binding = decode(MasterAgent.Binding)({
      workspaceID: "wrk_bound01",
      blockID: "block-1",
      functionalityInstanceID: "inst-1",
      sessionID: "ses_bound01",
      directory: "/tmp/work",
      generation: 0,
      revision: 1,
    })
    expect(binding.workspaceID).toBe(Workspace.ID.make("wrk_bound01"))

    expect(decode(MasterAgent.GetRequest)({ workspaceID: "wrk_get01", blockID: "block-1" })).toEqual({
      workspaceID: Workspace.ID.make("wrk_get01"),
      blockID: "block-1",
    })
    expect(decode(MasterAgent.EnsureRequest)({ workspaceID: "wrk_get01", blockID: "block-1" })).toEqual({
      workspaceID: Workspace.ID.make("wrk_get01"),
      blockID: "block-1",
    })
    expect(
      decode(MasterAgent.ResetRequest)({
        workspaceID: "wrk_get01",
        blockID: "block-1",
        expectedSessionID: "ses_bound01",
        expectedRevision: 2,
      }),
    ).toEqual({
      workspaceID: Workspace.ID.make("wrk_get01"),
      blockID: "block-1",
      expectedSessionID: Session.ID.make("ses_bound01"),
      expectedRevision: 2,
    })
  })

  test("MasterAgent.BindingUpdated publishes the binding event contract", () => {
    const event = decode(MasterAgent.BindingUpdated)({
      id: Event.ID.create(),
      type: "workspace.master-agent.binding.updated",
      data: {
        workspaceID: "wrk_event01",
        blockID: "block-1",
        sessionID: "ses_event01",
        generation: 0,
        revision: 1,
      },
    })
    expect(event.type).toBe("workspace.master-agent.binding.updated")
    expect(event.data).toEqual({
      workspaceID: Workspace.ID.make("wrk_event01"),
      blockID: "block-1",
      sessionID: Session.ID.make("ses_event01"),
      generation: 0,
      revision: 1,
    })
  })

  test("Functionality descriptor types are public for app composition", () => {
    const manifest: Functionality.Manifest = decode(Functionality.Manifest)({
      id: "builtin:master-agent",
      version: 1,
      label: "Master Agent",
      description: "hosted coding agent",
      icon: "agent",
      kind: "builtin",
      renderer: { moduleId: "canvas", exportName: "MasterAgentBlock" },
      constraints: { initialAspect: "square", minW: 4, minH: 4 },
      lifecycle: { clientWhenHidden: "suspend", hostWhenNoViewers: "keep-running" },
      concurrency: { policy: "singleton", maximumActive: 1, maximumQueued: 0 },
      rights: { mount: ["read"], operations: {} },
      context: {
        accepts: ["session"],
        produces: [],
        defaultBudget: {
          maximumBytes: 0,
          maximumEstimatedTokens: 0,
          maximumFacts: 0,
          maximumReferences: 0,
          maximumArtifacts: 0,
          maximumRecentEvents: 0,
        },
      },
    })
    expect(manifest.id).toBe("builtin:master-agent")
  })

  test("Session.ID remains public for the session surface", () => {
    const id: Session.ID = Session.ID.make("ses_surface01")
    expect(Schema.encodeSync(Session.ID)(id)).toBe("ses_surface01")
    expect(Session.ID.create().startsWith("ses_")).toBe(true)
  })
})
