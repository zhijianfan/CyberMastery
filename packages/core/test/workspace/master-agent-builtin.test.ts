import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { MasterAgentBuiltin, defaultConfiguration } from "@opencode-ai/core/workspace/builtins/master-agent"

const decodeConfiguration = Schema.decodeUnknownSync(MasterAgent.InstanceConfiguration)

describe("MasterAgent built-in descriptor", () => {
  test("stable id, kind, label, and layout defaults", () => {
    expect(MasterAgentBuiltin.id).toBe("builtin:master-agent")
    expect(MasterAgentBuiltin.kind).toBe("builtin")
    expect(MasterAgentBuiltin.label).toBe("Master agent")
    expect(MasterAgentBuiltin.minW).toBe(4)
    expect(MasterAgentBuiltin.minH).toBe(4)
    expect(MasterAgentBuiltin.maxW).toBeNull()
    expect(MasterAgentBuiltin.maxH).toBeNull()
    expect(Schema.decodeUnknownSync(MasterAgent.FunctionalityID)(MasterAgentBuiltin.id)).toBe(
      "builtin:master-agent",
    )
  })

  test("default configuration is version 1 with a workspace-primary binding", () => {
    expect(defaultConfiguration).toEqual({
      version: 1,
      directoryBinding: { mode: "workspace-primary" },
      sessionBinding: null,
    })
    expect(decodeConfiguration(defaultConfiguration)).toEqual(defaultConfiguration)
  })

  test("configuration validation accepts the default and rejects unsupported shapes", () => {
    expect(() =>
      decodeConfiguration({
        version: 2,
        directoryBinding: { mode: "workspace-primary" },
        sessionBinding: null,
      }),
    ).toThrow()
    expect(() =>
      decodeConfiguration({
        version: 1,
        directoryBinding: { mode: "fixed" },
        sessionBinding: null,
      }),
    ).toThrow()
  })

  test("server-managed session binding is not exposed as descriptor configuration", () => {
    expect(MasterAgentBuiltin).not.toHaveProperty("sessionBinding")
    expect(MasterAgentBuiltin).not.toHaveProperty("configuration")
    // The binding surface exists only server-side on the instance schema.
    const owned = decodeConfiguration({
      version: 1,
      directoryBinding: { mode: "workspace-primary" },
      sessionBinding: { mode: "owned", sessionID: "session_test", generation: 0 },
    })
    expect(owned.sessionBinding?.mode).toBe("owned")
  })
})
