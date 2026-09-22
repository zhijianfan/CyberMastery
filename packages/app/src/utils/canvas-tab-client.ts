// The app's vendored client predates canvas tabs. Use the workspace client's
// public entry point until that vendored dependency is upgraded.
import { OpenCode } from "../../../client/src/index"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export function createCanvasTabClient(input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }) {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  })["server.workspace.canvasTab"]
}
