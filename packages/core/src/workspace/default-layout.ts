import { Workspace } from "@opencode-ai/schema/workspace"

export function createDefaultLayout(workspaceID: Workspace.ID): Workspace.Layout.Info {
  return Workspace.Layout.Info.make({
    id: crypto.randomUUID(),
    workspaceID,
    revision: 0,
    blocks: [
      Workspace.Block.Record.make({
        id: "block-1",
        functionality: "builtin:chat",
        transform: Workspace.Block.Transform.make({ x: 0, y: 0, w: 4, h: 4, z: 0 }),
      }),
    ],
  })
}
