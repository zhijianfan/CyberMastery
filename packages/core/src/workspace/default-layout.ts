import { Workspace } from "@opencode-ai/schema/workspace"

export function createDefaultLayout(workspaceID: Workspace.ID): Workspace.Layout.Info {
  return Workspace.Layout.Info.make({
    id: crypto.randomUUID(),
    workspaceID,
    revision: 0,
    blocks: [],
  })
}
