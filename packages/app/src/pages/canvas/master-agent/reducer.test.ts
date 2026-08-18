import { describe, expect, test } from "bun:test"
import { classifyMasterAgentError, initialBindingState, reduceMasterAgentBinding } from "./reducer"
import type { MasterAgent } from "./types"

function binding(overrides: Partial<MasterAgent.Binding> = {}): MasterAgent.Binding {
  return {
    workspaceID: "ws-1",
    blockID: "block-1",
    functionalityInstanceID: "fi-1",
    sessionID: "session-1",
    directory: "/repo",
    generation: 1,
    revision: 1,
    ...overrides,
  }
}

function updatedEvent(overrides: Partial<MasterAgent.BindingUpdatedEvent> = {}): MasterAgent.BindingUpdatedEvent {
  return {
    type: "workspace.master-agent.binding.updated",
    workspaceID: "ws-1",
    blockID: "block-1",
    sessionID: "session-1",
    generation: 1,
    revision: 1,
    ...overrides,
  }
}

function ready(): { status: "ready"; binding: MasterAgent.Binding } {
  return { status: "ready", binding: binding() }
}

describe("initialBindingState", () => {
  test("starts uninitialized", () => {
    expect(initialBindingState()).toEqual({ status: "uninitialized" })
  })
})

describe("binding lifecycle", () => {
  test("uninitialized -> loading -> ready", () => {
    const state = reduceMasterAgentBinding(initialBindingState(), { type: "loading" })
    expect(state).toEqual({ status: "loading" })
    const done = reduceMasterAgentBinding(state, { type: "binding", binding: binding({ revision: 3 }) })
    expect(done).toEqual({ status: "ready", binding: binding({ revision: 3 }) })
  })

  test("get returning null leaves the block without a binding", () => {
    const state = reduceMasterAgentBinding({ status: "loading" }, { type: "binding-missing" })
    expect(state).toEqual({ status: "uninitialized" })
  })

  test("loading does not degrade a ready block", () => {
    const state = reduceMasterAgentBinding(ready(), { type: "loading" })
    expect(state).toEqual(ready())
  })

  test("removed resets a ready block to uninitialized", () => {
    expect(reduceMasterAgentBinding(ready(), { type: "removed" })).toEqual({ status: "uninitialized" })
  })
})

describe("terminal states", () => {
  test("permission-denied is stored directly", () => {
    expect(reduceMasterAgentBinding({ status: "loading" }, { type: "permission-denied" })).toEqual({
      status: "permission-denied",
    })
  })

  test("unavailable keeps its reason", () => {
    expect(reduceMasterAgentBinding({ status: "loading" }, { type: "unavailable", reason: "workspace-not-found" })).toEqual({
      status: "unavailable",
      reason: "workspace-not-found",
    })
  })

  test("error keeps the error and recoverable flag", () => {
    const error = new Error("network down")
    expect(reduceMasterAgentBinding({ status: "loading" }, { type: "error", error, recoverable: true })).toEqual({
      status: "error",
      error,
      recoverable: true,
    })
    expect(reduceMasterAgentBinding({ status: "loading" }, { type: "error", error, recoverable: false })).toEqual({
      status: "error",
      error,
      recoverable: false,
    })
  })

  test("non-ready states return to loading on demand", () => {
    expect(reduceMasterAgentBinding({ status: "permission-denied" }, { type: "loading" })).toEqual({ status: "loading" })
    expect(reduceMasterAgentBinding({ status: "unavailable", reason: "block-not-found" }, { type: "loading" })).toEqual({
      status: "loading",
    })
    expect(
      reduceMasterAgentBinding({ status: "error", error: "boom", recoverable: true }, { type: "loading" }),
    ).toEqual({ status: "loading" })
  })
})

describe("binding-updated events", () => {
  test("newer revision replaces session and generation", () => {
    const state = reduceMasterAgentBinding(ready(), {
      type: "binding-updated",
      event: updatedEvent({ sessionID: "session-2", generation: 2, revision: 5 }),
    })
    expect(state).toEqual({
      status: "ready",
      binding: binding({ sessionID: "session-2", generation: 2, revision: 5 }),
    })
  })

  test("duplicate revision is ignored", () => {
    const state = reduceMasterAgentBinding(ready(), { type: "binding-updated", event: updatedEvent({ revision: 1 }) })
    expect(state).toEqual(ready())
  })

  test("older revision is ignored", () => {
    const state = ready()
    const applied = reduceMasterAgentBinding(state, {
      type: "binding-updated",
      event: updatedEvent({ sessionID: "session-2", generation: 2, revision: 7 }),
    })
    const stale = reduceMasterAgentBinding(applied, {
      type: "binding-updated",
      event: updatedEvent({ sessionID: "session-old", generation: 1, revision: 6 }),
    })
    expect(stale).toEqual(applied)
  })

  test("event for another workspace is ignored", () => {
    const state = reduceMasterAgentBinding(ready(), {
      type: "binding-updated",
      event: updatedEvent({ workspaceID: "ws-2", revision: 9 }),
    })
    expect(state).toEqual(ready())
  })

  test("event for another block is ignored", () => {
    const state = reduceMasterAgentBinding(ready(), {
      type: "binding-updated",
      event: updatedEvent({ blockID: "block-2", revision: 9 }),
    })
    expect(state).toEqual(ready())
  })

  test("event while uninitialized requests a refetch", () => {
    const state = reduceMasterAgentBinding(initialBindingState(), {
      type: "binding-updated",
      event: updatedEvent({ revision: 9 }),
    })
    expect(state).toEqual({ status: "loading" })
  })
})

describe("binding snapshots", () => {
  test("older snapshot is ignored (stale reset response)", () => {
    const state = reduceMasterAgentBinding(ready(), { type: "binding", binding: binding({ revision: 0 }) })
    expect(state).toEqual(ready())
  })

  test("equal snapshot is accepted as an idempotent refresh", () => {
    const state = reduceMasterAgentBinding(ready(), { type: "binding", binding: binding({ revision: 1 }) })
    expect(state).toEqual(ready())
  })

  test("snapshot is adopted when the block is not ready", () => {
    const state = reduceMasterAgentBinding({ status: "loading" }, { type: "binding", binding: binding({ revision: 0 }) })
    expect(state).toEqual({ status: "ready", binding: binding({ revision: 0 }) })
  })
})

describe("reconnect", () => {
  test("ready block keeps its binding", () => {
    expect(reduceMasterAgentBinding(ready(), { type: "reconnect" })).toEqual(ready())
  })

  test("every other state asks for an authoritative fetch", () => {
    expect(reduceMasterAgentBinding(initialBindingState(), { type: "reconnect" })).toEqual({ status: "loading" })
    expect(reduceMasterAgentBinding({ status: "permission-denied" }, { type: "reconnect" })).toEqual({ status: "loading" })
    expect(reduceMasterAgentBinding({ status: "unavailable", reason: "x" }, { type: "reconnect" })).toEqual({
      status: "loading",
    })
    expect(reduceMasterAgentBinding({ status: "error", error: "x", recoverable: true }, { type: "reconnect" })).toEqual({
      status: "loading",
    })
  })
})

describe("block removal and remount", () => {
  test("a removed block can be remounted with a fresh binding", () => {
    const state = reduceMasterAgentBinding(ready(), { type: "removed" })
    const remounted = reduceMasterAgentBinding(
      reduceMasterAgentBinding(state, { type: "loading" }),
      { type: "binding", binding: binding({ sessionID: "session-3", revision: 4 }) },
    )
    expect(remounted).toEqual({ status: "ready", binding: binding({ sessionID: "session-3", revision: 4 }) })
  })
})

describe("classifyMasterAgentError", () => {
  test("access-denied maps to permission-denied", () => {
    expect(classifyMasterAgentError({ type: "access-denied" })).toEqual({ type: "permission-denied" })
  })

  test("structural errors map to unavailable", () => {
    expect(classifyMasterAgentError({ type: "workspace-not-found" })).toEqual({
      type: "unavailable",
      reason: "workspace-not-found",
    })
    expect(classifyMasterAgentError({ type: "wrong-functionality", actual: "builtin:chat" })).toEqual({
      type: "unavailable",
      reason: "wrong-functionality",
    })
    expect(classifyMasterAgentError({ type: "session-not-found" })).toEqual({
      type: "unavailable",
      reason: "session-not-found",
    })
  })

  test("stale-binding with a current binding adopts it", () => {
    expect(classifyMasterAgentError({ type: "stale-binding", current: binding({ revision: 8 }) })).toEqual({
      type: "binding",
      binding: binding({ revision: 8 }),
    })
  })

  test("stale-binding without a current binding is a recoverable error", () => {
    expect(classifyMasterAgentError({ type: "stale-binding" })).toEqual({
      type: "error",
      error: { type: "stale-binding" },
      recoverable: true,
    })
  })

  test("reset policy conflicts are recoverable errors", () => {
    expect(classifyMasterAgentError({ type: "reset-busy" })).toEqual({
      type: "error",
      error: { type: "reset-busy" },
      recoverable: true,
    })
    expect(classifyMasterAgentError({ type: "reset-has-pending-input" })).toMatchObject({
      type: "error",
      recoverable: true,
    })
    expect(classifyMasterAgentError({ type: "concurrent-conflict" })).toMatchObject({
      type: "error",
      recoverable: true,
    })
  })

  test("unknown errors are recoverable by default", () => {
    const error = new Error("socket closed")
    expect(classifyMasterAgentError(error)).toEqual({ type: "error", error, recoverable: true })
    expect(classifyMasterAgentError("string failure")).toEqual({ type: "error", error: "string failure", recoverable: true })
  })
})
