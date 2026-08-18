import { describe, expect, test } from "bun:test"
import {
  CODER_AGENT,
  CODER_EXCLUDED_TOOLS,
  CODER_MUTATION_TOOLS,
  CODER_SHELL_TOOLS,
  CODER_TASK_TOOL,
  evaluateMasterAgentPolicy,
  resolveTaskPermission,
  type MasterAgentPolicyInput,
  type TaskPermission,
} from "../../src/session/master-agent-policy"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

const ALL_TOOLS = [
  "invalid",
  "question",
  "bash",
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "apply_patch",
  "task",
  "webfetch",
  "todowrite",
  "websearch",
  "skill",
  "plan_exit",
  "lsp",
  "execute",
  "mcp:filesystem",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]

const READ_SEARCH_CONTEXT_TOOLS = [
  "read",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "skill",
  "lsp",
  "todowrite",
  "question",
  "task",
  "plan_exit",
  "invalid",
  "mcp:filesystem",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]

const EXCLUDED_SORTED = [...CODER_EXCLUDED_TOOLS].sort()

function rule(permission: string, pattern: string, action: PermissionV1.Action): PermissionV1.Rule {
  return { permission, pattern, action }
}

function input(overrides: Partial<MasterAgentPolicyInput>): MasterAgentPolicyInput {
  return { isMasterAgent: false, coderConfigured: false, permission: [], ...overrides }
}

describe("resolveTaskPermission", () => {
  const cases: { name: string; permission: PermissionV1.Ruleset; expected: TaskPermission }[] = [
    { name: "empty ruleset", permission: [], expected: "default" },
    { name: "task coder allow", permission: [rule("task", "coder", "allow")], expected: "allow" },
    { name: "task coder deny", permission: [rule("task", "coder", "deny")], expected: "deny" },
    { name: "task coder ask", permission: [rule("task", "coder", "ask")], expected: "ask" },
    { name: "task wildcard deny", permission: [rule("task", "*", "deny")], expected: "deny" },
    { name: "task other pattern deny", permission: [rule("task", "general", "deny")], expected: "default" },
    { name: "unrelated permission deny", permission: [rule("edit", "*", "deny")], expected: "default" },
    {
      name: "last match wins over wildcard",
      permission: [rule("task", "*", "allow"), rule("task", "coder", "deny")],
      expected: "deny",
    },
    {
      name: "last match wins reversed",
      permission: [rule("task", "coder", "deny"), rule("task", "*", "allow")],
      expected: "allow",
    },
    { name: "deny keyed by coder agent constant", permission: [rule("task", CODER_AGENT, "deny")], expected: "deny" },
  ]
  for (const c of cases) {
    test(c.name, () => {
      expect(resolveTaskPermission(c.permission)).toBe(c.expected)
    })
  }
})

describe("evaluateMasterAgentPolicy", () => {
  describe("ordinary sessions", () => {
    const permissions: { name: string; permission: PermissionV1.Ruleset }[] = [
      { name: "default", permission: [] },
      { name: "task allow", permission: [rule("task", "coder", "allow")] },
      { name: "task deny", permission: [rule("task", "coder", "deny")] },
      { name: "task ask", permission: [rule("task", "coder", "ask")] },
    ]
    for (const p of permissions) {
      for (const coderConfigured of [false, true]) {
        test(`${p.name} permission, coderConfigured=${coderConfigured}`, () => {
          const result = evaluateMasterAgentPolicy(
            input({ isMasterAgent: false, coderConfigured, permission: p.permission }),
            ALL_TOOLS,
          )
          expect(result.coderEnabled).toBe(false)
          expect(result.coderTaskVisible).toBe(false)
          expect(result.removed).toEqual([])
          expect(result.tools).toEqual([...ALL_TOOLS].sort())
          expect(result.tools).toContain("edit")
          expect(result.tools).toContain("write")
          expect(result.tools).toContain("apply_patch")
          expect(result.tools).toContain("bash")
        })
      }
    }
  })

  describe("MasterAgent with Coder disabled", () => {
    test("preserves the exact tool set", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: false }), ALL_TOOLS)
      expect(result.coderEnabled).toBe(false)
      expect(result.coderTaskVisible).toBe(false)
      expect(result.removed).toEqual([])
      expect(result.tools).toEqual([...ALL_TOOLS].sort())
      expect(result.tools).toContain("edit")
    })

    test("task deny does not hide coder-task when routing is disabled", () => {
      const result = evaluateMasterAgentPolicy(
        input({ isMasterAgent: true, coderConfigured: false, permission: [rule("task", "coder", "deny")] }),
        ALL_TOOLS,
      )
      expect(result.coderEnabled).toBe(false)
      expect(result.taskPermission).toBe("deny")
      expect(result.coderTaskVisible).toBe(false)
      expect(result.tools).not.toContain(CODER_TASK_TOOL)
      expect(result.removed).toEqual([])
    })
  })

  describe("MasterAgent with Coder enabled", () => {
    const permissionCases: { name: string; permission: PermissionV1.Ruleset; visible: boolean }[] = [
      { name: "default", permission: [], visible: true },
      { name: "task allow", permission: [rule("task", "coder", "allow")], visible: true },
      { name: "task ask", permission: [rule("task", "coder", "ask")], visible: true },
      { name: "task deny on coder", permission: [rule("task", "coder", "deny")], visible: false },
      { name: "task deny wildcard", permission: [rule("task", "*", "deny")], visible: false },
      { name: "task deny other agent", permission: [rule("task", "general", "deny")], visible: true },
    ]
    for (const c of permissionCases) {
      test(`${c.name}: coder-task ${c.visible ? "visible" : "hidden"}`, () => {
        const result = evaluateMasterAgentPolicy(
          input({ isMasterAgent: true, coderConfigured: true, permission: c.permission }),
          ALL_TOOLS,
        )
        expect(result.coderEnabled).toBe(true)
        expect(result.coderTaskVisible).toBe(c.visible)
        if (c.visible) expect(result.tools).toContain(CODER_TASK_TOOL)
        else expect(result.tools).not.toContain(CODER_TASK_TOOL)
      })
    }

    test("removes direct repository mutation tools", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: true }), ALL_TOOLS)
      for (const id of CODER_MUTATION_TOOLS) {
        expect(result.tools).not.toContain(id)
        expect(result.removed).toContain(id)
      }
    })

    test("removes unrestricted agent shell tools", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: true }), ALL_TOOLS)
      for (const id of CODER_SHELL_TOOLS) {
        expect(result.tools).not.toContain(id)
        expect(result.removed).toContain(id)
      }
    })

    test("removed is exactly the strict exclusion set", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: true }), ALL_TOOLS)
      expect(result.removed).toEqual(EXCLUDED_SORTED)
    })

    test("keeps read/search/context tools", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: true }), ALL_TOOLS)
      for (const id of READ_SEARCH_CONTEXT_TOOLS) expect(result.tools).toContain(id)
    })

    test("task deny hides coder-task but keeps delegation-subagent task tool", () => {
      const result = evaluateMasterAgentPolicy(
        input({ isMasterAgent: true, coderConfigured: true, permission: [rule("task", "coder", "deny")] }),
        ALL_TOOLS,
      )
      expect(result.tools).not.toContain(CODER_TASK_TOOL)
      expect(result.tools).toContain("task")
    })

    test("task allow keeps coder-task and task tool", () => {
      const result = evaluateMasterAgentPolicy(
        input({ isMasterAgent: true, coderConfigured: true, permission: [rule("task", "coder", "allow")] }),
        ALL_TOOLS,
      )
      expect(result.tools).toContain(CODER_TASK_TOOL)
      expect(result.tools).toContain("task")
    })

    test("result is sorted and de-duplicated", () => {
      const result = evaluateMasterAgentPolicy(
        input({ isMasterAgent: true, coderConfigured: true }),
        ["write", "read", "read", "bash", "edit", "grep"],
      )
      expect(result.tools).toEqual(["coder-task", "grep", "read"])
      expect(result.removed).toEqual(["bash", "edit", "write"])
    })

    test("empty tool list", () => {
      const result = evaluateMasterAgentPolicy(input({ isMasterAgent: true, coderConfigured: true }), [])
      expect(result.tools).toEqual(["coder-task"])
      expect(result.removed).toEqual([])
    })
  })
})
