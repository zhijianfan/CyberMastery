import { createSignal } from "solid-js"

export type SessionSurfaceMessage = {
  id: string
  role: "user" | "assistant" | "tool"
  text: string
}

export type SessionSurfaceTool = {
  id: string
  name: string
  status: "idle" | "running" | "done"
}

export type SessionSurfacePermission = {
  id: string
  requestID: string
  status: "pending" | "resolved"
  response?: "allow-once" | "allow-always" | "deny"
}

export type SessionSurfaceStatus = "connecting" | "connected" | "disconnected" | "error"

export interface FakeSessionSurfaceState {
  messages: () => SessionSurfaceMessage[]
  tools: () => SessionSurfaceTool[]
  permissions: () => SessionSurfacePermission[]
  status: () => SessionSurfaceStatus
  errors: () => string[]
  setStatus: (next: SessionSurfaceStatus) => void
  setMessages: (next: SessionSurfaceMessage[]) => void
  appendMessage: (message: SessionSurfaceMessage) => void
  clearMessages: () => void
  setTools: (next: SessionSurfaceTool[]) => void
  setPermissions: (next: SessionSurfacePermission[]) => void
  setErrors: (next: string[]) => void
  clearErrors: () => void
}

export function createFakeSessionSurfaceState() {
  const [messages, setMessages] = createSignal<SessionSurfaceMessage[]>([])
  const [tools, setTools] = createSignal<SessionSurfaceTool[]>([])
  const [permissions, setPermissions] = createSignal<SessionSurfacePermission[]>([])
  const [status, setStatus] = createSignal<SessionSurfaceStatus>("disconnected")
  const [errors, setErrors] = createSignal<string[]>([])

  const addMessage = (message: SessionSurfaceMessage) => {
    setMessages((previous) => [...previous, message])
  }

  return {
    messages,
    tools,
    permissions,
    status,
    errors,
    setStatus,
    setMessages,
    appendMessage: addMessage,
    clearMessages: () => setMessages([]),
    setTools,
    setPermissions,
    setErrors,
    clearErrors: () => setErrors([]),
  }
}
