import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
} from "../../runtime/contracts"
import { createServerBlockRuntimeContext } from "../../runtime/server-transport"
import type {
  AuthRuntimeState,
  ChatRelayBlockDescriptor,
  ChatRelayCommand,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeEventEnvelope,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
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

export interface ChatRelayView {
  sessionID: string
  connectionStatus: RuntimeResourceState["connection"]["status"]
  auth?: AuthRuntimeState
  session?: SessionRuntimeState
  messages: ChatRelayRuntimeViewMessage[]
  pendingPermissions: PermissionRuntimeState[]
  errors: string[]
}

export interface ChatRelayResolved {
  sessionID: string
  snapshot: RuntimeSnapshot<RuntimeResourceState>
  dispose: () => void
}

// Bridge context kept for `createServerBlockRuntimeContext`
// (runtime/server-transport.ts), which resolves snapshots over the
// OpenCode-native block-runtime endpoints.
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

// Fallback session id for the pre-integration window: `resolve` derives the
// host-owned session id from `workspace.chatRelay.ensure`, so this only guards
// the mapping when a descriptor arrives without a binding yet.
const FALLBACK_RELAY_SESSION_ID = "chat-relay-default-session"

const RELAY_FUNCTIONALITY_ID = "builtin:chat-relay"

function relayBindings(descriptor: ChatRelayBlockDescriptor): RuntimeResourceBinding[] {
  const sessionID = descriptor.bindings?.sessionID ?? FALLBACK_RELAY_SESSION_ID
  return [
    { type: "auth", id: "opencode" },
    { type: "session", id: sessionID },
    { type: "message", id: sessionID },
    { type: "message-part", id: sessionID },
    { type: "permission", id: sessionID },
  ]
}

function toRelayDescriptor(block: CanvasBlockDescriptor, sessionID: string): ChatRelayBlockDescriptor {
  return {
    id: block.id,
    functionalityID: RELAY_FUNCTIONALITY_ID,
    layout: { x: 0, y: 0, width: 0, height: 0 },
    bindings: { sessionID },
  }
}

function compareMessageTime(message: MessageRuntimeState): number {
  return message.timeCreated ?? 0
}

function parseNumberCursor(cursor: string): number {
  const parsed = Number.parseInt(cursor, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function selectView(resolved: ChatRelayResolved): ChatRelayView {
  const state = resolved.snapshot.state
  const sessionID = resolved.sessionID
  const auth = state.authByProvider.opencode
  const session = state.sessionsByID[sessionID]
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
    sessionID,
    connectionStatus: state.connection.status,
    auth,
    session,
    messages,
    pendingPermissions,
    errors,
  }
}

// Narrow v2 command surface ChatRelay dispatches against. `session.prompt`
// exists on the pinned SDK today; `session.abort`, `permission.respond`, and
// `auth.start` are the post-regeneration surface M adds after this run (see
// HANDOFF-H). The adapter routes through this cast so no call-site changes are
// needed once the SDK regenerates; until then the legacy branch stays the live
// send path.
interface ChatRelayCommandClient {
  session: {
    prompt(input: {
      sessionID: string
      prompt: { text: string }
      delivery: "steer" | "queue"
      resume?: boolean
    }): Promise<unknown>
    abort(input: { sessionID: string }): Promise<unknown>
  }
  permission: {
    respond(input: { requestID: string; response: "once" | "always" | "reject" }): Promise<unknown>
  }
  auth: {
    start(input: { providerID: string }): Promise<unknown>
  }
}

function permissionResponse(response: "allow-once" | "allow-always" | "deny"): "once" | "always" | "reject" {
  if (response === "allow-once") return "once"
  if (response === "allow-always") return "always"
  return "reject"
}

async function dispatchCommand(
  resolved: ChatRelayResolved,
  command: ChatRelayCommand,
  services: BlockRuntimeServices,
): Promise<void> {
  const client = services.serverSDK().client.v2 as unknown as ChatRelayCommandClient
  const sessionID = resolved.sessionID
  switch (command.type) {
    case "session.prompt":
      await client.session.prompt({
        sessionID,
        prompt: { text: command.text },
        delivery: command.delivery,
        resume: true,
      })
      return
    case "session.abort":
      await client.session.abort({ sessionID })
      return
    case "session.create":
      await services.serverSDK().client.v2.session.create({ id: sessionID })
      return
    case "permission.respond":
      await client.permission.respond({
        requestID: command.requestID,
        response: permissionResponse(command.response),
      })
      return
    case "auth.start":
      await client.auth.start({ providerID: command.providerID })
      return
  }
}

type ChatRelayRegistration = BlockRuntimeRegistration<ChatRelayResolved, ChatRelayView, ChatRelayCommand> & {
  getBindings(descriptor: ChatRelayBlockDescriptor): RuntimeResourceBinding[]
}

export const ChatRelayRuntimeAdapter: ChatRelayRegistration = {
  functionalityID: RELAY_FUNCTIONALITY_ID,
  mode: "native",

  getBindings(descriptor: ChatRelayBlockDescriptor): RuntimeResourceBinding[] {
    return relayBindings(descriptor)
  },

  async resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }) {
    const binding = await input.services.serverSDK().client.v2.workspace.chatRelay.ensure(
      { workspaceID: input.workspaceID, blockID: input.block.id },
      { throwOnError: true },
    )
    if (input.signal.aborted) throw makeAbortError()
    const sessionID = binding.data.sessionID
    const snapshot = await createServerBlockRuntimeContext(input.services.serverSDK).snapshot(
      relayBindings(toRelayDescriptor(input.block, sessionID)),
    )
    if (input.signal.aborted) throw makeAbortError()
    return { sessionID, snapshot, dispose: () => undefined }
  },

  select(input: { resolved: ChatRelayResolved; projection: unknown; localView: unknown }): ChatRelayView {
    return selectView(input.resolved)
  },

  async dispatch(input: {
    resolved: ChatRelayResolved
    command: ChatRelayCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }) {
    await dispatchCommand(input.resolved, input.command, input.services)
  },

  dispose() {},
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
    resource: { type: "session", id: FALLBACK_RELAY_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[FALLBACK_RELAY_SESSION_ID] = {
        id: FALLBACK_RELAY_SESSION_ID,
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
        sessionID: FALLBACK_RELAY_SESSION_ID,
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
    resource: { type: "session", id: FALLBACK_RELAY_SESSION_ID },
    apply: (state) => {
      state.sessionsByID[FALLBACK_RELAY_SESSION_ID] = {
        id: FALLBACK_RELAY_SESSION_ID,
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
        sessionID: FALLBACK_RELAY_SESSION_ID,
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
        sessionID: FALLBACK_RELAY_SESSION_ID,
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
        sessionID: FALLBACK_RELAY_SESSION_ID,
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