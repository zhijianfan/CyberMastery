import { BlockChat } from "./block-chat"
import { SessionScopeProvider, createSessionScope, type SessionScope } from "./session-scope"
import { SessionTargetProvider } from "./session-target"
import type { CanvasSessionSurfaceProps } from "./session-target"

export type { CanvasSessionSurfaceProps, SessionSurfaceTarget } from "./session-target"

// Each canvas block addresses its own binding and mounts the compact chat
// view with a separate DOM/focus scope. The routed session page is not embedded.
export function CanvasSessionSurface(props: CanvasSessionSurfaceProps) {
  const scope = createSessionScope(
    () => props.surfaceID,
    () => props.focused,
  )
  return (
    <SessionTargetProvider target={props.target}>
      <SessionScopeProvider scope={scope}>
        <SurfaceRoot {...props} scope={scope} />
      </SessionScopeProvider>
    </SessionTargetProvider>
  )
}

function SurfaceRoot(props: CanvasSessionSurfaceProps & { scope: SessionScope }) {
  const scope = props.scope

  const requestFocus = () => {
    if (!props.focused) props.onFocus()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    requestFocus()
  }

  return (
    <div
      id={scope.id("root")}
      class="canvas-session-surface"
      data-surface-id={scope.surfaceID()}
      data-session-id={props.target.sessionID}
      data-focused={props.focused}
      onPointerDown={onPointerDown}
      onFocusIn={requestFocus}
      ref={(element) => scope.setRoot(element)}
    >
      <BlockChat
        role={props.role}
        target={props.target}
        surfaceID={props.surfaceID}
        focused={props.focused}
        queueEnabled={props.queueEnabled}
        workspaceModels={props.workspaceModels}
        beforeSubmit={props.beforeSubmit}
        onFocus={props.onFocus}
        onRequestOpenFullPage={props.onRequestOpenFullPage}
      />
    </div>
  )
}
