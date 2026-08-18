import { describe, expect, it } from "bun:test"
import { Coder } from "../../src/agent/coder"
import { Permission } from "../../src/permission"

const CODING_TOOLS = [
  "edit",
  "write",
  "apply_patch",
  "bash",
  "glob",
  "grep",
  "read",
  "list",
  "webfetch",
  "websearch",
  "todowrite",
]

const DENIED_PERMISSIONS = ["question", "plan_enter", "plan_exit"]

describe("reserved Coder agent definition", () => {
  it("exposes a stable reserved identifier", () => {
    expect(Coder.ID).toBe("coder")
    expect(Coder.info.name).toBe(Coder.ID)
  })

  it("is internal and not user-selectable", () => {
    expect(Coder.info.hidden).toBe(true)
    expect(Coder.info.mode).toBe("subagent")
    expect(Coder.info.native).toBe(true)
  })

  it("defines a system role for implementation, build, test, migration, debugging, and reporting to the parent", () => {
    expect(Coder.info.description).toBeTruthy()
    const text = `${Coder.info.description}\n${Coder.info.prompt ?? ""}`.toLowerCase()
    for (const keyword of ["implement", "build", "test", "migration", "debug", "parent"]) {
      expect(text).toContain(keyword)
    }
  })

  it("allows the coding tool profile without bypassing workspace permissions", () => {
    for (const tool of CODING_TOOLS) {
      expect(Permission.evaluate(tool, "*", Coder.info.permission).action).toBe("allow")
    }
    for (const name of DENIED_PERMISSIONS) {
      expect(Permission.evaluate(name, "*", Coder.info.permission).action).toBe("deny")
    }
    expect(Permission.evaluate("doom_loop", "*", Coder.info.permission).action).toBe("ask")
    expect(Permission.evaluate("read", "*.env", Coder.info.permission).action).toBe("ask")
    expect(Permission.evaluate("read", "*.env.example", Coder.info.permission).action).toBe("allow")
    expect(Permission.evaluate("external_directory", "*", Coder.info.permission).action).toBe("ask")
  })

  it("does not embed a model override", () => {
    expect("model" in Coder.info).toBe(false)
    expect(Coder.info.model).toBeUndefined()
  })
})
