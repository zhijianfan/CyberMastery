// Explicit session-surface targeting (spec 02 §13). These primitives identify
// an existing host session — they never create, ensure, or fetch one. Every
// surface that mounts a session (routed page or canvas block) addresses the
// same host session through these targets, so multiple surfaces can mount
// without duplicate stores or route dependency.

import { createContext, useContext, type JSX } from "solid-js"

export interface SessionSurfaceTarget {
  sessionID: string
  directory?: string
  workspaceID?: string
}

// Contract 13: the props of the canvas-hosted session surface (consumed by U3).
export interface CanvasSessionSurfaceProps {
  target: SessionSurfaceTarget
  surfaceID: string
  focused: boolean
  queueEnabled: boolean
  onFocus(): void
  onRequestOpenFullPage?(): void
}

export function normalizeTarget(target: SessionSurfaceTarget): SessionSurfaceTarget {
  return {
    sessionID: target.sessionID.trim(),
    directory: target.directory?.trim() || undefined,
    workspaceID: target.workspaceID?.trim() || undefined,
  }
}

export function targetKey(target: SessionSurfaceTarget): string {
  const normalized = normalizeTarget(target)
  return `${normalized.sessionID}|${normalized.directory ?? ""}|${normalized.workspaceID ?? ""}`
}

const SessionTargetContext = createContext<SessionSurfaceTarget>()

export function SessionTargetProvider(props: { target: SessionSurfaceTarget; children: JSX.Element }) {
  return <SessionTargetContext.Provider value={props.target}>{props.children}</SessionTargetContext.Provider>
}

export function useSessionTarget(): SessionSurfaceTarget {
  const target = useContext(SessionTargetContext)
  if (!target) throw new Error("useSessionTarget must be used within a SessionTargetProvider")
  return target
}
