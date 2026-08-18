import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

// Frozen literals from devplan/master-agent/master-agent-max-parallel-plan/02-contracts-and-data-model.md.
// The functionality ID identifies host-owned MasterAgent instances; the child
// Coder agent id is fixed by the ChildTaskRunner contract.
export const MASTER_AGENT_FUNCTIONALITY = "builtin:master-agent"
export const CODER_AGENT = "coder"
export const CODER_TASK_TOOL = "coder-task"

// Strict Coder-enabled policy removes direct repository mutation and
// unrestricted agent shell tools from the primary session. Tool IDs match the
// builtin registry; "bash" is the ShellTool id/permission key and "execute" is
// the experimental code-mode shell tool.
export const CODER_MUTATION_TOOLS = ["edit", "write", "apply_patch"] as const
export const CODER_SHELL_TOOLS = ["bash", "execute"] as const
export const CODER_EXCLUDED_TOOLS = [...CODER_MUTATION_TOOLS, ...CODER_SHELL_TOOLS] as const

export type TaskPermission = "allow" | "deny" | "ask" | "default"

export interface MasterAgentPolicyInput {
  /** True only for sessions bound to a host-owned builtin:master-agent instance. */
  readonly isMasterAgent: boolean
  /** True when the workspace has a non-null coderModel. */
  readonly coderConfigured: boolean
  /** Existing project/session permission rules, merged agent + session rulesets. */
  readonly permission: PermissionV1.Ruleset
}

export interface MasterAgentPolicyResult {
  readonly isMasterAgent: boolean
  readonly coderEnabled: boolean
  readonly taskPermission: TaskPermission
  /** True when the reserved coder-task tool is part of the effective tool set. */
  readonly coderTaskVisible: boolean
  /** Effective tool IDs for the session, sorted and de-duplicated. */
  readonly tools: readonly string[]
  /** Tool IDs removed by the strict Coder-enabled set, sorted. */
  readonly removed: readonly string[]
}

/**
 * Delegation authority reuses the existing `task` permission key with the
 * `coder` pattern, matching the ask patterns used by CoderTaskTool. "default"
 * means no task rule matches the coder pattern and the call-time ask flow
 * applies.
 */
export function resolveTaskPermission(permission: PermissionV1.Ruleset): TaskPermission {
  const matched = permission.findLast(
    (rule) => Wildcard.match("task", rule.permission) && Wildcard.match(CODER_AGENT, rule.pattern),
  )
  return matched?.action ?? "default"
}

/**
 * Deterministic host policy for the primary session's effective tools.
 *
 * Ordinary sessions and MasterAgent sessions with Coder disabled keep the
 * given tool IDs exactly. Enabled MasterAgent sessions drop direct repository
 * mutation and unrestricted agent shell tools, keep read/search/context tools,
 * and add the reserved coder-task delegation tool unless the `task` permission
 * denies it. User-operated terminal UI is not an agent tool and is untouched.
 */
export function evaluateMasterAgentPolicy(
  input: MasterAgentPolicyInput,
  toolIDs: Iterable<string>,
): MasterAgentPolicyResult {
  const taskPermission = resolveTaskPermission(input.permission)
  const coderEnabled = input.isMasterAgent && input.coderConfigured
  const unique = [...new Set(toolIDs)]

  if (!coderEnabled) {
    return {
      isMasterAgent: input.isMasterAgent,
      coderEnabled: false,
      taskPermission,
      coderTaskVisible: false,
      tools: unique.sort(),
      removed: [],
    }
  }

  const excluded = new Set<string>(CODER_EXCLUDED_TOOLS)
  const tools = unique.filter((id) => !excluded.has(id))
  const removed = unique.filter((id) => excluded.has(id))
  const coderTaskVisible = taskPermission !== "deny"
  if (coderTaskVisible) tools.push(CODER_TASK_TOOL)

  return {
    isMasterAgent: input.isMasterAgent,
    coderEnabled: true,
    taskPermission,
    coderTaskVisible,
    tools: tools.sort(),
    removed: removed.sort(),
  }
}
