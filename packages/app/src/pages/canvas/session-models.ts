import type { CanvasManager } from "./manager"
import type { RuntimeBlockHandle } from "./runtime/contracts"

export async function prepareWorkspaceSession(
  manager: Pick<CanvasManager, "modelIntent" | "waitForModelSelection" | "workspaceID">,
  runtime: RuntimeBlockHandle | undefined,
  sessionID: string,
  errorMessage: string,
) {
  if (!runtime) throw new Error(errorMessage)
  const workspaceID = manager.workspaceID()
  while (true) {
    const intent = manager.modelIntent()
    await manager.waitForModelSelection().catch(() => {
      throw new Error(errorMessage)
    })
    await runtime.refresh("before-submit")
    // Refresh preserves the mounted draft on failure, so its retained view alone is not sufficient.
    const view = runtime.view() as { sessionID?: string } | undefined
    if (manager.workspaceID() !== workspaceID || runtime.status() !== "ready" || view?.sessionID !== sessionID)
      throw new Error(errorMessage)
    if (manager.modelIntent() === intent) return
  }
}
