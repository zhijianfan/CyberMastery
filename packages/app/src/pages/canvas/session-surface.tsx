import { SessionSurfaceBase } from "../session-surface-base"
import { SessionScopeProvider, createSessionScope, type SessionScope } from "./session-scope"
import { SessionTargetProvider } from "./session-target"
import type { CanvasSessionSurfaceProps } from "./session-target"

export type { CanvasSessionSurfaceProps, SessionSurfaceTarget } from "./session-target"

// Track U3 — Canvas session multi-instance adapter. Composes the U1
// target/scope providers with the U2 base Session surface so more than one
// mounted session works without route or singleton collisions. Keyboard
// commands stay scoped to the focused block: the base surface gates its key
// handling on the `focused` prop, and the scope below gates block-level
// handlers through `keyboardOwned`.
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

  return (
    <div
      id={scope.id("root")}
      class="canvas-session-surface"
      data-surface-id={scope.surfaceID()}
      data-session-id={props.target.sessionID}
      data-focused={props.focused}
      onPointerDown={requestFocus}
      onFocusIn={requestFocus}
      ref={(element) => scope.setRoot(element)}
    >
      <SessionSurfaceBase
        target={props.target}
        surfaceID={props.surfaceID}
        focused={props.focused}
        queueEnabled={props.queueEnabled}
        onFocus={props.onFocus}
        onRequestOpenFullPage={props.onRequestOpenFullPage}
      />
    </div>
  )
}
