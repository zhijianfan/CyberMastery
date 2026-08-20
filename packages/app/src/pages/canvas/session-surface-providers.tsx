import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { useServer } from "@/context/server"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { Show, type ParentProps } from "solid-js"

// Canvas-mounted session surfaces (ChatRelay, MasterAgent) need the same
// per-directory provider stack the session route uses. The canvas page itself
// only provides the server-scoped contexts (ServerSDK/ServerSync/Layout), so
// the block hosts wrap their embedded surface here. Renders nothing until the
// binding's directory is known.
export function CanvasSessionSurfaceProviders(props: ParentProps<{ directory?: string; sessionID?: string }>) {
  const server = useServer()
  return (
    <Show when={props.directory} keyed>
      {(directory) => (
        <SDKProvider directory={() => directory}>
          <DirectoryDataProvider
            directory={() => directory}
            server={() => server.key}
            sessionID={() => props.sessionID}
          >
            <FileProvider>
              <PromptProvider>
                <CommentsProvider>{props.children}</CommentsProvider>
              </PromptProvider>
            </FileProvider>
          </DirectoryDataProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
