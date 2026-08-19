import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type {
  AuthRuntimeState,
  MessagePartRuntimeState,
  MessageRuntimeState,
  PermissionRuntimeState,
  RuntimeResourceBinding,
  RuntimeResourceState,
  RuntimeSnapshot,
  SessionRuntimeState,
} from "@opencode-ai/protocol/groups/block-runtime"
import { DateTime, Effect } from "effect"

const CURSOR_PREFIX = "runtime"

// Map a native session message to the runtime role vocabulary. Only user and
// assistant messages are projected; system/shell/compaction records are
// presentation-irrelevant for the block runtime v1.
export function messageRole(message: SessionMessage.Message): "user" | "assistant" | undefined {
  if (message.type === "user") return "user"
  if (message.type === "assistant") return "assistant"
  return undefined
}

// Project the parts of one native message. User text becomes a synthetic
// "text" part so the block UI can render the prompt without a parallel part
// store. Assistant content items map 1:1 by their native IDs.
export function messageParts(message: SessionMessage.Message): MessagePartRuntimeState[] {
  if (message.type === "user") {
    return [
      {
        id: `${message.id}:text`,
        messageID: message.id,
        kind: "text",
        text: message.text ?? "",
      },
    ]
  }
  if (message.type !== "assistant") return []
  return message.content.map((item) => {
    if (item.type === "text") {
      return { id: item.id, messageID: message.id, kind: "text", text: item.text }
    }
    if (item.type === "reasoning") {
      return { id: item.id, messageID: message.id, kind: "reasoning", text: item.text }
    }
    return {
      id: item.id,
      messageID: message.id,
      kind: "tool",
      state: {
        name: item.name,
        status: item.state.status,
        state: item.state,
      },
      error: item.state.status === "error" ? item.state.error.message : undefined,
    }
  })
}

export type ResourceSnapshotDeps =
  | SessionV2.Service
  | Credential.Service
  | PermissionV2.Service
  | EventV2.Service
  | Database.Service

// Build the authoritative resource snapshot for the requested bindings.
// The cursor is `runtime:<maxDurableSeq>`: the highest durable event sequence
// across the bound session aggregates, so a subscription starting from
// seq + 1 never misses a durable event that the snapshot already contains.
export const resourceSnapshot = (
  bindings: ReadonlyArray<RuntimeResourceBinding>,
): Effect.Effect<RuntimeSnapshot, unknown, ResourceSnapshotDeps> =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const credentials = yield* Credential.Service
    const permissions = yield* PermissionV2.Service
    const database = yield* Database.Service

    const active = yield* sessions.active

    const authByProvider: Record<string, AuthRuntimeState> = {}
    for (const binding of bindings.filter((binding) => binding.type === "auth")) {
      const info = yield* credentials.get(binding.id as Credential.ID)
      authByProvider[binding.id] = {
        providerID: binding.id,
        status: info ? "ready" : "missing",
      }
    }

    const sessionsByID: Record<string, SessionRuntimeState> = {}
    const messagesByID: Record<string, MessageRuntimeState> = {}
    const partsByID: Record<string, MessagePartRuntimeState> = {}
    const permissionsByID: Record<string, PermissionRuntimeState> = {}

    for (const binding of bindings.filter((binding) => binding.type === "session")) {
      const sessionID = binding.id as SessionV2.ID
      const info = yield* sessions.get(sessionID)
      sessionsByID[binding.id] = {
        id: binding.id,
        status: active.has(sessionID) ? "busy" : "idle",
        modelID: info.model ? info.model.id : undefined,
        agentID: info.agent ?? undefined,
      }

      const messages = yield* sessions.messages({ sessionID })
      for (const message of messages) {
        const role = messageRole(message)
        if (!role) continue
        messagesByID[message.id] = {
          id: message.id,
          sessionID: binding.id,
          role,
          timeCreated: DateTime.toEpochMillis(message.time.created),
        }
        for (const part of messageParts(message)) partsByID[part.id] = part
      }

      for (const request of yield* permissions.forSession(sessionID)) {
        permissionsByID[request.id] = {
          id: request.id,
          requestID: request.id,
          sessionID: binding.id,
          status: "pending",
        }
      }
    }

    let maxSeq = 0
    for (const id of Object.keys(sessionsByID)) {
      const seq = yield* EventV2.latestSequence(database.db, id)
      if (seq > maxSeq) maxSeq = seq
    }

    const state: RuntimeResourceState = {
      connection: { status: "connected" },
      authByProvider,
      sessionsByID,
      messagesByID,
      partsByID,
      permissionsByID,
    }

    return {
      cursor: `${CURSOR_PREFIX}:${maxSeq}`,
      state,
    }
  })
