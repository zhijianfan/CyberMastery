import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { makeDefaultApi } from "@opencode-ai/protocol/api"
import { WorkspaceGroup } from "@opencode-ai/protocol/groups/workspace"
import { MasterAgentGroup } from "@opencode-ai/protocol/groups/workspace-master-agent"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Workspace } from "@opencode-ai/schema/workspace"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode-ai/protocol/test/LocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode-ai/protocol/test/SessionLocationMiddleware",
) {}

// Composes the full public protocol entry, exactly like the server and client do.
const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

const updateEndpoint = WorkspaceGroup.endpoints["workspace.update"]
const updatePayloadSchema = [...updateEndpoint.payload.values()][0]!.schemas[0]

const decodePayload = (input: unknown) =>
  Schema.decodeUnknownSync(updatePayloadSchema as Schema.Decoder<unknown>)(input) as {
    id: string
    patch: { coderModel?: string | null }
  }

const encodePayload = (input: unknown) =>
  Schema.encodeSync(updatePayloadSchema as Schema.Encoder<unknown>)(input) as {
    id: string
    patch: { coderModel?: string | null }
  }

const binding = {
  workspaceID: Workspace.ID.make("wrk_test"),
  blockID: "block-1",
  functionalityInstanceID: "inst_1",
  sessionID: "ses_test",
  directory: "/tmp",
  generation: 0,
  revision: 1,
}

// The endpoint error sets hold schema views rather than the class references, so
// match on the annotated identifier (which equals the class name) instead.
const errorIds = (endpoint: { error: ReadonlySet<Schema.Top> }) =>
  [...endpoint.error].map((schema) => schema.ast.annotations?.identifier)

describe("protocol composition via public entry", () => {
  test("makeDefaultApi mounts the workspace and masterAgent groups", () => {
    expect(Api.groups["server.workspace"]).toBeDefined()
    const masterAgent = Api.groups["server.workspace.masterAgent"]

    expect(masterAgent).toBeDefined()
    expect(Object.keys(masterAgent.endpoints).sort()).toEqual([
      "workspace.masterAgent.ensure",
      "workspace.masterAgent.get",
      "workspace.masterAgent.reset",
    ])
  })

  test("workspace group preserves all current endpoint identifiers", () => {
    expect(Object.keys(WorkspaceGroup.endpoints).sort()).toEqual(
      [
        "workspace.create",
        "workspace.duplicate",
        "workspace.functionality.list",
        "workspace.get",
        "workspace.layout.get",
        "workspace.layout.save",
        "workspace.list",
        "workspace.remove",
        "workspace.update",
      ].sort(),
    )
  })
})

describe("workspace coder fragment composition", () => {
  test("update payload accepts an explicit null coderModel (clear)", () => {
    const decoded = decodePayload({ id: "wrk_test01", patch: { coderModel: null } })

    expect(decoded.patch.coderModel).toBeNull()
  })

  test("update payload accepts a concrete coderModel", () => {
    const decoded = decodePayload({ id: "wrk_test01", patch: { coderModel: "anthropic/claude-sonnet-4" } })

    expect(decoded.patch.coderModel).toBe("anthropic/claude-sonnet-4")
  })

  test("update payload treats an absent coderModel as unchanged", () => {
    const decoded = decodePayload({ id: "wrk_test01", patch: {} })

    expect("coderModel" in decoded.patch).toBe(false)
  })

  test("update payload rejects a non-string coderModel", () => {
    expect(() => decodePayload({ id: "wrk_test01", patch: { coderModel: 42 } })).toThrow()
  })

  test("update payload encodes a concrete coderModel", () => {
    const encoded = encodePayload({ id: Workspace.ID.make("wrk_test01"), patch: { coderModel: "anthropic/claude-sonnet-4" } })

    expect(encoded.patch.coderModel).toBe("anthropic/claude-sonnet-4")
  })

  test("update payload encodes an explicit null coderModel (clear)", () => {
    const encoded = encodePayload({ id: Workspace.ID.make("wrk_test01"), patch: { coderModel: null } })

    expect(encoded.patch.coderModel).toBeNull()
  })

  test("update payload omits coderModel when left undefined", () => {
    const encoded = encodePayload({ id: Workspace.ID.make("wrk_test01"), patch: {} })

    expect("coderModel" in encoded.patch).toBe(false)
  })
})

describe("masterAgent group composition", () => {
  test("exposes exactly the get, ensure and reset endpoints", () => {
    expect(Object.keys(MasterAgentGroup.endpoints).sort()).toEqual([
      "workspace.masterAgent.ensure",
      "workspace.masterAgent.get",
      "workspace.masterAgent.reset",
    ])
  })

  test("wires the typed lifecycle errors on the get endpoint", () => {
    expect(errorIds(MasterAgentGroup.endpoints["workspace.masterAgent.get"])).toEqual(
      expect.arrayContaining([
        "MasterAgentWorkspaceNotFoundError",
        "MasterAgentBlockNotFoundError",
        "MasterAgentWrongFunctionalityError",
        "MasterAgentInstanceNotFoundError",
        "MasterAgentAccessDeniedError",
        "MasterAgentConflictError",
      ]),
    )
  })

  test("wires the stale and busy reset errors on the reset endpoint", () => {
    expect(errorIds(MasterAgentGroup.endpoints["workspace.masterAgent.reset"])).toEqual(
      expect.arrayContaining([
        "MasterAgentWorkspaceNotFoundError",
        "MasterAgentBlockNotFoundError",
        "MasterAgentWrongFunctionalityError",
        "MasterAgentInstanceNotFoundError",
        "MasterAgentAccessDeniedError",
        "MasterAgentStaleBindingError",
        "MasterAgentBusyError",
        "MasterAgentConflictError",
      ]),
    )
  })

  test("get success schema decodes bound and unbound responses", () => {
    const getSuccess = [...MasterAgentGroup.endpoints["workspace.masterAgent.get"].success][0] as Schema.Decoder<unknown>

    expect(Schema.decodeUnknownSync(getSuccess)({ status: "bound", binding })).toEqual({
      status: "bound",
      binding,
    })
    expect(Schema.decodeUnknownSync(getSuccess)({ status: "unbound" })).toEqual({ status: "unbound" })
  })

  test("reset success schema decodes reset, stale and busy responses", () => {
    const resetSuccess = [...MasterAgentGroup.endpoints["workspace.masterAgent.reset"].success][0] as Schema.Decoder<unknown>

    expect(Schema.decodeUnknownSync(resetSuccess)({ status: "reset", binding })).toEqual({
      status: "reset",
      binding,
    })
    expect(Schema.decodeUnknownSync(resetSuccess)({ status: "stale", currentRevision: 4 })).toEqual({
      status: "stale",
      currentRevision: 4,
    })
    expect(Schema.decodeUnknownSync(resetSuccess)({ status: "busy", reason: "session-active" })).toEqual({
      status: "busy",
      reason: "session-active",
    })
  })

  test("ensure success schema decodes a binding", () => {
    const ensureSuccess = [...MasterAgentGroup.endpoints["workspace.masterAgent.ensure"].success][0] as Schema.Decoder<unknown>

    expect(Schema.decodeUnknownSync(ensureSuccess)(binding)).toEqual(binding)
  })

  test("masterAgent endpoints route under the shared workspace root", () => {
    expect(MasterAgentGroup.endpoints["workspace.masterAgent.get"].path).toBe(
      "/api/workspace/:workspaceID/master-agent/:blockID",
    )
    expect(MasterAgentGroup.endpoints["workspace.masterAgent.ensure"].path).toBe(
      "/api/workspace/:workspaceID/master-agent/:blockID/ensure",
    )
    expect(MasterAgentGroup.endpoints["workspace.masterAgent.reset"].path).toBe(
      "/api/workspace/:workspaceID/master-agent/:blockID/reset",
    )
  })
})

describe("workspace info surface", () => {
  test("Workspace.Info remains decodable with and without coderModel", () => {
    const base = {
      id: Workspace.ID.make("wrk_test01"),
      name: "n",
      style: "s",
      directories: [],
      pluginIDs: [],
      skillIDs: [],
      git: [],
      time: { created: 0, updated: 0 },
    }

    expect(Schema.decodeUnknownSync(Workspace.Info)(base).coderModel).toBeUndefined()
    expect(
      Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" }).coderModel,
    ).toBe("anthropic/claude-sonnet-4")
    expect(MasterAgent.FunctionalityID).toBeDefined()
  })
})
