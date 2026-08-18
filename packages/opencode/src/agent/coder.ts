import { Permission } from "@/permission"
import type { Agent } from "./agent"

// Reserved internal Coder agent for host-created child coding sessions.
// 02-contracts-and-data-model.md §10 freezes the child agent identifier as
// "coder" (ChildTaskRunner.runTrusted input). The host — never the model or
// the browser — chooses the child model, directory, parent session,
// workspace, and permissions at child creation, so this definition carries
// no model field and no provider/model references.
//
// Registration in the shared agent registry is owned by the agent.ts track
// (R6); this module only defines the reserved agent. It is `hidden` and a
// `subagent` so it is never user-selectable or eligible as a default agent.

export const ID = "coder" as const
export type ID = typeof ID

export const description = [
  "Reserved internal agent for coding execution delegated by the primary MasterAgent session.",
  "Implements changes, migrations, and formatting; builds, typechecks, and tests; debugs failures; and reports results to the parent.",
].join(" ")

export const prompt = [
  "You are the Coder, a reserved internal agent that performs coding execution on behalf of the primary agent (the parent session).",
  "Your responsibilities:",
  "- Implement code changes, migrations, and formatting.",
  "- Build, typecheck, and test the repository, fixing failures you introduce or find.",
  "- Debug issues with the available tools and verify the outcome.",
  "- Report results back to the parent: what changed, what was verified, and what remains.",
  "Constraints:",
  "- Work only within the granted workspace directory and respect its permissions.",
  "- Do not ask the user questions; return the outcome to the parent session.",
  "- Do not delegate work or create child sessions.",
  "- Never select or override the model or provider; the host has already chosen them.",
].join("\n")

// Mirrors the shared defaults profile of the built-in coding agents (build):
// full allow with guardrails. `external_directory` needs an explicit ask
// because the "*" catch-all above wildcard-matches it; the registry's
// re-ensure/merge supplies the truncation/tmp/skill whitelist on top.
// Workspace permissions are never bypassed.
export const permission = Permission.merge(
  Permission.fromConfig({
    "*": "allow",
    doom_loop: "ask",
    external_directory: {
      "*": "ask",
    },
    question: "deny",
    plan_enter: "deny",
    plan_exit: "deny",
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
  }),
)

export const info: Agent.Info = {
  name: ID,
  description,
  mode: "subagent",
  native: true,
  hidden: true,
  prompt,
  permission,
  options: {},
}

export * as Coder from "./coder"
