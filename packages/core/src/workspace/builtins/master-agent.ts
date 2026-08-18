import { MasterAgent } from "@opencode-ai/schema/master-agent"
import { Workspace } from "@opencode-ai/schema/workspace"

// The MasterAgent built-in descriptor. It embeds the existing Session surface
// and carries no configuration passthrough of its own, so server-managed
// session binding fields can never be written through a generic client
// configuration patch. The authoritative binding lives in
// MasterAgent.InstanceConfiguration, created server-side from
// defaultConfiguration below (unbound, workspace-primary).
export const MasterAgentBuiltin = Workspace.Functionality.Info.make({
  id: "builtin:master-agent",
  kind: "builtin",
  label: "Master agent",
  minW: 4,
  minH: 4,
  maxW: null,
  maxH: null,
})

export const defaultConfiguration: MasterAgent.InstanceConfiguration = {
  version: 1,
  directoryBinding: { mode: "workspace-primary" },
  sessionBinding: null,
}
