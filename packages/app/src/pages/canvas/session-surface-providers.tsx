import { CommentsProvider } from "@/context/comments"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { createComponent, createMemo, Show, type JSX, type ParentProps } from "solid-js"

type Binding = { directory: string; sessionID: string }

// Bind draft state to the block's session, independently of the canvas route.
// Rebinding disposes the old surface and its local composer state.
export function CanvasSessionSurfaceProviders(props: ParentProps<{ directory?: string; sessionID?: string }>) {
  const server = useServer()
  const serverSync = useServerSync()
  const binding = createMemo(
    () => (props.directory && props.sessionID ? { directory: props.directory, sessionID: props.sessionID } : undefined),
    undefined,
    { equals: (previous, next) => previous?.directory === next?.directory && previous?.sessionID === next?.sessionID },
  )
  return createComponent<{
    when: Binding | undefined
    keyed: true
    children: (current: Binding) => JSX.Element
  }>(Show, {
    get when() {
      return binding()
    },
    keyed: true,
    children: (current) => {
      serverSync().session.bindV2(current.sessionID)
      return (
        <SDKProvider directory={() => current.directory}>
          <DirectoryDataProvider
            directory={() => current.directory}
            server={() => server.key}
            sessionID={() => current.sessionID}
          >
            <FileProvider>
              <PromptProvider scope={() => ({ dir: base64Encode(current.directory), id: current.sessionID })}>
                <CommentsProvider sessionID={() => current.sessionID}>{props.children}</CommentsProvider>
              </PromptProvider>
            </FileProvider>
          </DirectoryDataProvider>
        </SDKProvider>
      )
    },
  })
}
