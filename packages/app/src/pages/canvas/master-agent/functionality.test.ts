import { expect, test } from "bun:test"
import {
  MASTER_AGENT_BLOCK_TYPE,
  MASTER_AGENT_DEFAULT_SIZE,
  MASTER_AGENT_FUNCTIONALITY_BY_TYPE,
  MASTER_AGENT_FUNCTIONALITY_ID,
  MASTER_AGENT_MODULE,
  initialConfiguration,
  type MasterAgentClientConfiguration,
} from "./functionality"

test("uses the contract literal functionality id", () => {
  expect(MASTER_AGENT_FUNCTIONALITY_ID).toBe("builtin:master-agent")
  expect(MASTER_AGENT_MODULE.functionality).toBe("builtin:master-agent")
})

test("maps the master-agent block type to the functionality id", () => {
  expect(MASTER_AGENT_FUNCTIONALITY_BY_TYPE).toEqual({ "master-agent": "builtin:master-agent" })
  expect(MASTER_AGENT_MODULE.type).toBe(MASTER_AGENT_BLOCK_TYPE)
})

test("declares addable metadata with a default size", () => {
  expect(MASTER_AGENT_MODULE.title).toBe("Master Agent")
  expect(MASTER_AGENT_MODULE.w).toBeGreaterThan(0)
  expect(MASTER_AGENT_MODULE.h).toBeGreaterThan(0)
  expect(MASTER_AGENT_DEFAULT_SIZE).toEqual({ w: MASTER_AGENT_MODULE.w, h: MASTER_AGENT_MODULE.h })
  expect(typeof MASTER_AGENT_MODULE.icon).toBe("function")
})

test("produces the initial configuration shape", () => {
  expect(initialConfiguration({ mode: "workspace-primary" })).toEqual({
    version: 1,
    directoryBinding: { mode: "workspace-primary" },
    sessionBinding: null,
  })
  expect(initialConfiguration({ mode: "fixed", directory: "C:/repo" })).toEqual({
    version: 1,
    directoryBinding: { mode: "fixed", directory: "C:/repo" },
    sessionBinding: null,
  })
})

test("never writes a session binding in the client configuration", () => {
  const configuration = initialConfiguration({ mode: "workspace-primary" })
  expect(configuration.sessionBinding).toBeNull()
  // @ts-expect-error sessionBinding is server-managed and not client-writable
  const invalid: MasterAgentClientConfiguration = { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: { mode: "owned", sessionID: "session-1", generation: 0 } }
  expect(invalid).toBeDefined()
})

test("does not collide with existing built-in functionalities", () => {
  const existingFunctionalityIds = [
    "builtin:chat",
    "builtin:context",
    "builtin:tools",
    "builtin:files",
    "builtin:notes",
    "builtin:voice",
    "builtin:chat-relay",
    "builtin:operating-chat-session",
  ]
  const existingBlockTypes = ["context", "tools", "files", "notes", "voice", "chat-relay", "operating-chat", "legacy"]
  expect(existingFunctionalityIds).not.toContain(MASTER_AGENT_FUNCTIONALITY_ID)
  expect(existingBlockTypes).not.toContain(MASTER_AGENT_BLOCK_TYPE)
})
