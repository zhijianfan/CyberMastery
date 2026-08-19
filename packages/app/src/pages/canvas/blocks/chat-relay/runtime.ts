import type {
  AuthRuntimeState,
  BlockDescriptor,
  ChatRelayCommand,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  SessionRuntimeState,
} from "./types"

interface ChatRelayRuntimeMessagePartView {
  id: string
  kind: MessagePartRuntimeState["kind"]
  state?: MessagePartRuntimeState["state"]
}

export interface ChatRelayRuntimeViewMessage {
  id: string
  role: MessageRuntimeState["role"]
  text: string
  parts: ChatRelayRuntimeMessagePartView[]
  timeCreated?: number
}

export interface ChatRelayRuntimeView {
  connectionStatus: RuntimeResourceState["connection"]["status"]
  auth?: AuthRuntimeState
  session?: SessionRuntimeState
  messages: ChatRelayRuntimeViewMessage[]
  pendingPermissions: PermissionRuntimeState[]
  errors: string[]
}

export interface ChatRelayRuntimeContext {
  state?: RuntimeResourceState
  snapshot(bindings?: RuntimeResourceBinding[]): Promise<RuntimeSnapshot<RuntimeResourceState>>
  subscribe(
    bindings: RuntimeResourceBinding[],
    cursor: string,
    onEvent: (event: RuntimeEventEnvelope) => void,
  ): () => void
  sendCommand(command: ChatRelayCommand): Promise<void>
}

export const CHAT_RELAY_DEFAULT_SESSION_ID = "chat-relay-default-session"

const BLOCK_DESCRIPTOR_ID = "builtin:chat-relay"

export const DEFAULT_MOCK_CHAT_RELAY_CONTEXT_STATE: RuntimeResourceState = {
  connection: {
    status: "disconnected",
  },
  authByProvider: {
    opencode: {
      providerID: "opencode",
      status: "missing",
    },
  },
  sessionsByID: {},
  messagesByID: {},
  partsByID: {},
  permissionsByID: {},
}

function compareMessageTime(message: MessageRuntimeState): number {
  return message.timeCreated ?? 0
}

function parseNumberCursor(cursor: string): number {
  const parsed = Number.parseInt(cursor, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const ChatRelayRuntimeAdapter = {
  getBindings(descriptor: ChatRelayBlockDescriptor) {
    const sessionID = descriptor.bindings?.sessionID ?? CHAT_RELAY_DEFAULT_SESSION_ID
    return [
      { type: "auth", id: "opencode" },
      { type: "session", id: sessionID },
      { type: "message", id: sessionID },
      { type: "message-part", id: sessionID },
      { type: "permission", id: sessionID },
    ] satisfies RuntimeResourceBinding[]
  },
  async hydrate(descriptor: ChatRelayBlockDescriptor, context: ChatRelayRuntimeContext) {
    const bindings = this.getBindings(descriptor)
    return context.snapshot(bindings)
  },
  select(descriptor: ChatRelayBlockDescriptor, state: RuntimeResourceState) {
    const auth = state.authByProvider.opencode
    const sessionID = descriptor.bindings?.sessionID ?? CHAT_RELAY_DEFAULT_SESSION_ID
    const session = sessionID ? state.sessionsByID[sessionID] : undefined
    const messages = Object.values(state.messagesByID)
      .filter((message) => message.sessionID === session?.id)
      .sort((left, right) => {
        const difference = compareMessageTime(left) - compareMessageTime(right)
        return difference === 0 ? left.id.localeCompare(right.id) : difference
      })
      .map((message) => {
        const parts = Object.values(state.partsByID)
          .filter((part) => part.messageID === message.id)
          .sort((left, right) => left.id.localeCompare(right.id))
        const text = parts
          .filter((part) => part.kind === "text")
          .flatMap((part) => part.text ?? [])
          .filter(Boolean)
          .join("")

        return {
          id: message.id,
          role: message.role,
          text,
          timeCreated: message.timeCreated,
          parts: parts.map((part) => ({ id: part.id, kind: part.kind, state: part.state })),
        }
      })
    const pendingPermissions = Object.values(state.permissionsByID)
      .filter((permission) => permission.status === "pending" && permission.sessionID === session?.id)
      .sort((left, right) => left.requestID.localeCompare(right.requestID))
    const errors = [
      state.connection.lastError,
      auth?.error,
      session?.error,
      ...Object.values(state.partsByID)
        .filter((part) => part.error !== undefined)
        .map((part) => part.error as string),
    ].filter(Boolean) as string[]

    return {
      connectionStatus: state.connection.status,
      auth,
      session,
      messages,
      pendingPermissions,
      errors,
    }
  },
  async dispatch(descriptor: ChatRelayBlockDescriptor, command: ChatRelayCommand, context: ChatRelayRuntimeContext) {
    const bindings = this.getBindings(descriptor)
    if (!bindings.length) throw new Error("Missing chat relay bindings")
    await context.sendCommand(command)
  },
}

interface MockRuntimeScriptEntry {
  cursor: string
  delayMs: number
  resource: RuntimeResourceBinding
  apply: (state: RuntimeResourceState) => void
}

interface MockRuntimeContextOptions {
  initialState?: RuntimeResourceState
  script?: MockRuntimeScriptEntry[]
  onCommand?: (command: ChatRelayCommand, state: RuntimeResourceState) => void
}

export const createDefaultChatRelayMockScript = (): MockRuntimeScriptEntry[] => [
  {
    cursor: "1",
    delayMs: 20,
    resource: { type: "auth", id: "opencode" },
    apply: (state) => {
      state.authByProvider.opencode = {
        providerID: "opencode",
        status: "awaiting-login",
        loginURL: "https://chat.example/login",
        userCode: "ABC-123",
      }
    },
  },
  {
    cursor: "2",
    delayMs: 20,
    resource: { type: "auth", id: "opencode" },
    apply: (state) => {
      state.authByProvider.opencode = {
        providerID: "opencode",
        status: "ready",
      }
    },
  },
  {
    cursor: "3",
    delayMs: 20,
    resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[CHAT_RELAY_DEFAULT_SESSION_ID] = {
        id: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "idle",
        directory: "/repo",
      }
      state.connection.status = "connected"
      state.connection.lastError = undefined
    },
  },
  {
    cursor: "4",
    delayMs: 20,
    resource: { type: "message", id: "m-1" },
    apply: (state) => {
      state.messagesByID["m-1"] = {
        id: "m-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        role: "assistant",
        timeCreated: 10,
      }
    },
  },
  {
    cursor: "5",
    delayMs: 20,
    resource: { type: "message-part", id: "p-1" },
    apply: (state) => {
      state.partsByID["p-1"] = {
        id: "p-1",
        messageID: "m-1",
        kind: "text",
        text: "Hello",
      }
    },
  },
  {
    cursor: "5",
    delayMs: 20,
    resource: { type: "message-part", id: "p-2" },
    apply: (state) => {
      state.partsByID["p-2"] = {
        id: "p-2",
        messageID: "m-1",
        kind: "text",
        text: " world",
      }
    },
  },
  {
    cursor: "3",
    delayMs: 20,
    resource: { type: "session", id: CHAT_RELAY_DEFAULT_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[CHAT_RELAY_DEFAULT_SESSION_ID] = {
        id: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "busy",
        directory: "/repo",
      }
      state.connection.lastError = "stale update"
    },
  },
  {
    cursor: "6",
    delayMs: 20,
    resource: { type: "permission", id: "permission-1" },
    apply: (state) => {
      state.permissionsByID["permission-1"] = {
        id: "permission-1",
        requestID: "ask-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "pending",
      }
    },
  },
  {
    cursor: "7",
    delayMs: 20,
    resource: { type: "permission", id: "permission-1" },
    apply: (state) => {
      state.permissionsByID["permission-1"] = {
        id: "permission-1",
        requestID: "ask-1",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        status: "resolved",
        response: "allow-once",
      }
    },
  },
  {
    cursor: "8",
    delayMs: 20,
    resource: { type: "message", id: "m-2" },
    apply: (state) => {
      state.messagesByID["m-2"] = {
        id: "m-2",
        sessionID: CHAT_RELAY_DEFAULT_SESSION_ID,
        role: "assistant",
        timeCreated: 20,
      }
      state.partsByID["p-3"] = {
        id: "p-3",
        messageID: "m-2",
        kind: "text",
        text: " Ready",
      }
    },
  },
]

export type {
  AuthRuntimeState,
  ChatRelayCommand,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  SessionRuntimeState,
}

export const createMockChatRelayContext = ({
  initialState = DEFAULT_MOCK_CHAT_RELAY_CONTEXT_STATE,
  script = [],
  onCommand,
}: MockRuntimeContextOptions = {}) => {
  const state: RuntimeResourceState = {
    ...initialState,
    authByProvider: { ...initialState.authByProvider },
    sessionsByID: { ...initialState.sessionsByID },
    messagesByID: { ...initialState.messagesByID },
    partsByID: { ...initialState.partsByID },
    permissionsByID: { ...initialState.permissionsByID },
  }
  let latestCursor = 0

  const normalize = (cursor: string) => parseNumberCursor(cursor)

  return {
    state,
    async snapshot(_bindings?: RuntimeResourceBinding[]) {
      return {
        cursor: String(latestCursor),
        state: {
          connection: { ...state.connection },
          authByProvider: { ...state.authByProvider },
          sessionsByID: { ...state.sessionsByID },
          messagesByID: { ...state.messagesByID },
          partsByID: { ...state.partsByID },
          permissionsByID: { ...state.permissionsByID },
        },
      }
    },
    subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (event: RuntimeEventEnvelope) => void) {
      const baseline = normalize(cursor)
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const match = bindings.some.bind(bindings)

      const handlers = script
        .filter((entry) => normalize(entry.cursor) > baseline)
        .filter((entry) =>
          match((binding) => binding.type === entry.resource.type && binding.id === entry.resource.id),
        )
        .map((entry) => {
          const timer = setTimeout(() => {
            if (normalize(entry.cursor) <= latestCursor) return
            latestCursor = normalize(entry.cursor)
            entry.apply(state)
            onEvent({
              cursor: entry.cursor,
              revision: 1,
              timestamp: Date.now(),
              resource: entry.resource,
              event: "updated",
              data: entry,
            })
          }, entry.delayMs)
          timers.add(timer)
          return timer
        })

      return () => {
        handlers.forEach(clearTimeout)
        handlers.forEach((timer) => timers.delete(timer))
      }
    },
    async sendCommand(command: ChatRelayCommand) {
      if (command.type === "session.prompt") {
        state.connection.lastError = undefined
      }

      onCommand?.(command, state)
    },
  }
}

export const buildMockChatRelayContext = createMockChatRelayContext

interface ChatRelayBlockDescriptor extends BlockDescriptor {
  functionalityID: typeof BLOCK_DESCRIPTOR_ID
  bindings: { sessionID?: string }
}
