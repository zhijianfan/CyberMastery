import type { OpenCodeEvent, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import type { SessionEvent } from "@opencode-ai/schema/session-event"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Prompt } from "@opencode-ai/schema/prompt"

export function normalizeCurrentPrompt(input: unknown): Pick<SessionMessageUser, "text" | "files" | "agents"> {
  const prompt = input as typeof Prompt.Encoded
  return {
    ...prompt,
    files: prompt.files?.map((file) =>
      "uri" in file
        ? {
            ...file,
            data: "",
            source: { type: "uri", uri: file.uri },
            mention: file.source,
          }
        : file,
    ),
    agents: prompt.agents?.map((agent) => ({ ...agent, ...("source" in agent ? { mention: agent.source } : {}) })),
  } as Pick<SessionMessageUser, "text" | "files" | "agents">
}

// The app still consumes the published client contract. Keep conversion at
// this boundary while preserving native content IDs for reconnects and replay.
export function normalizeCurrentSessionMessage(input: unknown): SessionMessageInfo {
  const message = input as typeof SessionMessage.Message.Encoded
  if (message.type === "user") return { ...message, ...normalizeCurrentPrompt(message) } as SessionMessageInfo
  if (message.type === "compaction") return { status: "completed", ...message } as SessionMessageInfo
  if (message.type === "shell" && "callID" in message) {
    return {
      ...message,
      shellID: message.callID,
      status: message.time.completed === undefined ? "running" : "exited",
      output: { output: message.output, cursor: message.output.length, size: message.output.length, truncated: false },
    } as SessionMessageInfo
  }
  if (message.type !== "assistant") return message as SessionMessageInfo
  return {
    ...message,
    content: message.content.map((content) => {
      if (content.type !== "tool") return content
      return {
        ...content,
        executed: "executed" in content ? content.executed : content.provider?.executed,
        providerState: "providerState" in content ? content.providerState : content.provider?.metadata,
        providerResultState:
          "providerResultState" in content ? content.providerResultState : content.provider?.resultMetadata,
        state:
          content.state.status === "pending"
            ? { ...content.state, status: "streaming" }
            : { metadata: content.state.structured ?? {}, ...content.state },
      }
    }),
  } as unknown as SessionMessageInfo
}

export const normalizeCurrentSessionMessages = (input: readonly unknown[]) => input.map(normalizeCurrentSessionMessage)

export function adaptCurrentSessionEvent(event: OpenCodeEvent, source: readonly SessionMessageInfo[]) {
  if (!event.type.startsWith("session.next.")) return
  const current = event as unknown as typeof SessionEvent.All.Encoded
  const created = timestamp(current.data.timestamp)
  const make = (type: string, data: object, id = event.id) =>
    ({
      ...event,
      id,
      type,
      created,
      data: { ...data, sessionID: current.data.sessionID },
    }) as OpenCodeEvent
  const messageEventID = (messageID: string) => messageID.replace(/^msg_/, "evt_")
  const type = current.type.replace("session.next.", "session.")
  switch (current.type) {
    case "session.next.prompt.admitted":
    case "session.next.prompted": {
      const data = {
        inputID: current.data.messageID,
        input: { type: "user", data: normalizeCurrentPrompt(current.data.prompt), delivery: current.data.delivery },
      }
      return current.type === "session.next.prompt.admitted"
        ? [make("session.input.admitted", data)]
        : [make("session.input.admitted", data), make("session.input.promoted", data)]
    }
    case "session.next.agent.switched":
      return [make("session.agent.selected", current.data, messageEventID(current.data.messageID))]
    case "session.next.model.switched":
      return [make("session.model.selected", current.data, messageEventID(current.data.messageID))]
    case "session.next.synthetic":
      return [make("session.synthetic", current.data, messageEventID(current.data.messageID))]
    case "session.next.moved":
      return [make("session.moved", { ...current.data, subpath: current.data.subdirectory })]
    case "session.next.text.started":
    case "session.next.text.delta":
    case "session.next.text.ended":
    case "session.next.reasoning.started":
    case "session.next.reasoning.delta":
    case "session.next.reasoning.ended": {
      const kind = "textID" in current.data ? "text" : "reasoning"
      const contentID = "textID" in current.data ? current.data.textID : current.data.reasoningID
      const assistant = source.find((message) => message.id === current.data.assistantMessageID)
      const content = assistant?.type === "assistant" ? assistant.content.filter((part) => part.type === kind) : []
      const found = content.findIndex((part) => "id" in part && part.id === contentID)
      const data = { ...current.data, contentID, ordinal: found < 0 ? content.length : found }
      const start = make(`session.${kind}.started`, data)
      return found < 0 && !type.endsWith(".started") ? [start, make(type, data)] : [make(type, data)]
    }
    case "session.next.tool.called":
    case "session.next.tool.success":
    case "session.next.tool.failed":
      return [
        make(type, {
          ...current.data,
          executed: current.data.provider.executed,
          state: current.data.provider.metadata,
          resultState: current.data.provider.metadata,
          metadata: "structured" in current.data ? current.data.structured : {},
        }),
      ]
    case "session.next.shell.started":
      return [
        make(
          "session.shell.started",
          {
            shell: { id: current.data.callID, command: current.data.command, status: "running" },
          },
          messageEventID(current.data.messageID),
        ),
      ]
    case "session.next.shell.ended":
      return [
        make("session.shell.ended", {
          shell: { id: current.data.callID, status: "exited" },
          output: {
            output: current.data.output,
            cursor: current.data.output.length,
            size: current.data.output.length,
            truncated: false,
          },
        }),
      ]
    case "session.next.compaction.started":
    case "session.next.compaction.delta":
    case "session.next.compaction.ended":
      return [make(type, { ...current.data, inputID: current.data.messageID }, messageEventID(current.data.messageID))]
    case "session.next.retried": {
      const assistant = source.findLast((message) => message.type === "assistant")
      return [make("session.retry.scheduled", { ...current.data, assistantMessageID: assistant?.id, at: created })]
    }
    case "session.next.context.updated":
      return []
    default:
      return [make(type, current.data)]
  }
}

function timestamp(value: unknown) {
  return typeof value === "number" ? value : Date.parse(String(value))
}
