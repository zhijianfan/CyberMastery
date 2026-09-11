import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { V2Event, V2SessionMessagesResponse } from "@opencode-ai/sdk/v2/types"
import { createV2SessionReducer, type V2SessionReduction } from "./server-session-v2-reducer"

type CurrentMessage = V2SessionMessagesResponse["data"][number]
type CurrentEvent = Extract<V2Event, { type: `session.next.${string}` }>
type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>

// Local Core and the separately versioned client use different wire contracts.
// Preserve canonical content IDs and structured tool data alongside the UI fields.
export function normalizeCurrentSessionMessage(message: CurrentMessage): SessionMessageInfo {
  if (message.type === "user")
    return {
      ...message,
      files: message.files?.map((file) => ({
        ...file,
        data: /^data:[^,]*;base64,/.test(file.uri) ? file.uri.slice(file.uri.indexOf(",") + 1) : "",
        source: /^data:[^,]*;base64,/.test(file.uri) ? { type: "inline" } : { type: "uri", uri: file.uri },
        mention: file.source,
      })),
      agents: message.agents?.map((agent) => ({ ...agent, mention: agent.source })),
    } as SessionMessageInfo
  if (message.type === "shell")
    return {
      ...message,
      shellID: message.callID,
      status: message.time.completed === undefined ? "running" : "exited",
      output: {
        output: message.output,
        cursor: message.output.length,
        size: message.output.length,
        truncated: false,
      },
    } as SessionMessageInfo
  if (message.type === "compaction") return { ...message, status: "completed" } as SessionMessageInfo
  if (message.type !== "assistant") return message as SessionMessageInfo
  return {
    ...message,
    content: message.content.map((content) => {
      if (content.type === "text") return content
      if (content.type === "reasoning") return { ...content, state: content.providerMetadata }
      return {
        ...content,
        executed: content.provider?.executed,
        providerState: content.provider?.metadata,
        providerResultState: content.provider?.resultMetadata,
        state:
          content.state.status === "pending"
            ? { ...content.state, status: "streaming" }
            : { ...content.state, metadata: content.state.structured },
      }
    }),
  } as unknown as SessionMessageInfo
}

export function createSessionNextReducer() {
  const compatible = createV2SessionReducer()

  const reduce = (source: readonly SessionMessageInfo[], event: CurrentEvent): V2SessionReduction | undefined => {
    const sessionID = event.data.sessionID
    const result = (messages: SessionMessageInfo[], touched: string[] = []): V2SessionReduction => ({
      sessionID,
      messages,
      touched,
    })
    const append = (message: SessionMessageInfo) =>
      result(source.some((item) => item.id === message.id) ? [...source] : [...source, message], [message.id])
    const update = (id: string, apply: (message: SessionMessageInfo) => SessionMessageInfo) => {
      if (!source.some((item) => item.id === id)) return { ...result([...source]), missing: id }
      return result(
        source.map((message) => (message.id === id ? apply(message) : message)),
        [id],
      )
    }
    const project = (type: OpenCodeEvent["type"], data: object = event.data): V2SessionReduction | undefined => {
      if (type !== "session.step.started" && "assistantMessageID" in event.data) {
        const assistantMessageID = event.data.assistantMessageID
        const assistant = source.find((item) => item.id === assistantMessageID)
        if (assistant?.type !== "assistant") return { ...result([...source]), missing: assistantMessageID }
        if (type !== "session.tool.input.started" && "callID" in event.data) {
          const callID = event.data.callID
          if (!assistant.content.some((item) => item.type === "tool" && item.id === callID))
            return { ...result([...source]), missing: assistant.id }
        }
      }
      return compatible.reduce(source, {
        ...event,
        type,
        created: event.data.timestamp,
        data,
      } as unknown as OpenCodeEvent)
    }

    switch (event.type) {
      case "session.next.prompt.admitted":
        return result([...source])
      case "session.next.prompted":
        return append(
          normalizeCurrentSessionMessage({
            id: event.data.messageID,
            type: "user",
            metadata: event.metadata,
            ...event.data.prompt,
            time: { created: event.data.timestamp },
          }),
        )
      case "session.next.agent.switched":
        return append(
          normalizeCurrentSessionMessage({
            id: event.data.messageID,
            type: "agent-switched",
            metadata: event.metadata,
            agent: event.data.agent,
            time: { created: event.data.timestamp },
          }),
        )
      case "session.next.model.switched":
        return append(
          normalizeCurrentSessionMessage({
            id: event.data.messageID,
            type: "model-switched",
            metadata: event.metadata,
            model: event.data.model,
            time: { created: event.data.timestamp },
          }),
        )
      case "session.next.context.updated":
      case "session.next.synthetic":
        return append({
          id: event.data.messageID,
          type: event.type === "session.next.synthetic" ? "synthetic" : "system",
          text: event.data.text,
          time: { created: event.data.timestamp },
        })
      case "session.next.shell.started":
        return append(
          normalizeCurrentSessionMessage({
            id: event.data.messageID,
            type: "shell",
            metadata: event.metadata,
            callID: event.data.callID,
            command: event.data.command,
            output: "",
            time: { created: event.data.timestamp },
          }),
        )
      case "session.next.shell.ended": {
        const shell = source.findLast((item) => item.type === "shell" && item.shellID === event.data.callID)
        if (!shell) return result([...source])
        return update(shell.id, (item) =>
          item.type !== "shell"
            ? item
            : {
                ...item,
                status: "exited",
                output: {
                  output: event.data.output,
                  cursor: event.data.output.length,
                  size: event.data.output.length,
                  truncated: false,
                },
                time: { ...item.time, completed: event.data.timestamp },
              },
        )
      }
      case "session.next.step.started":
        return project("session.step.started")
      case "session.next.step.ended":
        return project("session.step.ended")
      case "session.next.step.failed":
        return project("session.step.failed")
      case "session.next.text.started":
      case "session.next.text.delta":
      case "session.next.text.ended":
      case "session.next.reasoning.started":
      case "session.next.reasoning.delta":
      case "session.next.reasoning.ended": {
        const type = "textID" in event.data ? "text" : "reasoning"
        const id = "textID" in event.data ? event.data.textID : event.data.reasoningID
        const assistant = source.find((item) => item.id === event.data.assistantMessageID)
        if (assistant?.type !== "assistant") return { ...result([...source]), missing: event.data.assistantMessageID }
        const exists = assistant.content.some((item) => item.type === type && "id" in item && item.id === id)
        if (!exists && !event.type.endsWith(".started")) return { ...result([...source]), missing: assistant.id }
        return update(assistant.id, (item) => {
          if (item.type !== "assistant") return item
          if (event.type.endsWith(".started"))
            return exists
              ? item
              : {
                  ...item,
                  content: [
                    ...item.content,
                    {
                      type,
                      id,
                      text: "",
                      ...(type === "reasoning"
                        ? {
                            state: "providerMetadata" in event.data ? event.data.providerMetadata : undefined,
                            time: { created: event.data.timestamp },
                          }
                        : {}),
                    },
                  ] as Assistant["content"],
                }
          return {
            ...item,
            content: item.content.map((content) => {
              if (content.type !== type || !("id" in content) || content.id !== id) return content
              return {
                ...content,
                text:
                  "delta" in event.data
                    ? content.text + event.data.delta
                    : "text" in event.data
                      ? event.data.text
                      : content.text,
                ...(event.type === "session.next.reasoning.ended" && content.type === "reasoning"
                  ? {
                      state: event.data.providerMetadata ?? content.state,
                      time: { created: content.time?.created ?? event.data.timestamp, completed: event.data.timestamp },
                    }
                  : {}),
              }
            }) as Assistant["content"],
          }
        })
      }
      case "session.next.tool.input.started":
        return project("session.tool.input.started")
      case "session.next.tool.input.delta":
        return project("session.tool.input.delta")
      case "session.next.tool.input.ended":
        return project("session.tool.input.ended")
      case "session.next.tool.called":
        return project("session.tool.called", {
          ...event.data,
          executed: event.data.provider.executed,
          state: event.data.provider.metadata,
        })
      case "session.next.tool.progress":
        return project("session.tool.progress", { ...event.data, metadata: event.data.structured })
      case "session.next.tool.success":
      case "session.next.tool.failed": {
        const reduced = project(
          event.type === "session.next.tool.success" ? "session.tool.success" : "session.tool.failed",
          {
            ...event.data,
            executed: event.data.provider.executed,
            resultState: event.data.provider.metadata,
            ...("structured" in event.data ? { metadata: event.data.structured } : {}),
          },
        )
        if (!reduced) return reduced
        return {
          ...reduced,
          messages: reduced.messages.map((message) =>
            message.id !== event.data.assistantMessageID || message.type !== "assistant"
              ? message
              : {
                  ...message,
                  content: message.content.map((content) =>
                    content.type !== "tool" || content.id !== event.data.callID
                      ? content
                      : {
                          ...content,
                          state: {
                            ...content.state,
                            result: event.data.result,
                            ...("outputPaths" in event.data ? { outputPaths: event.data.outputPaths } : {}),
                          },
                        },
                  ),
                },
          ),
        }
      }
      case "session.next.retried": {
        const assistant = source.findLast(
          (item): item is Assistant => item.type === "assistant" && item.time.completed === undefined,
        )
        if (!assistant) return result([...source])
        return project("session.retry.scheduled", {
          ...event.data,
          assistantMessageID: assistant.id,
          at: event.data.timestamp,
          error: { type: "unknown", ...event.data.error },
        })
      }
      case "session.next.compaction.started":
        return append({
          id: event.data.messageID,
          type: "compaction",
          status: "running",
          reason: event.data.reason,
          summary: "",
          recent: "",
          time: { created: event.data.timestamp },
        })
      case "session.next.compaction.delta":
        return update(event.data.messageID, (item) =>
          item.type === "compaction" && item.status === "running"
            ? { ...item, summary: item.summary + event.data.text }
            : item,
        )
      case "session.next.compaction.ended": {
        const message = normalizeCurrentSessionMessage({
          id: event.data.messageID,
          type: "compaction",
          reason: event.data.reason,
          summary: event.data.text,
          recent: event.data.recent,
          time: { created: event.data.timestamp },
        })
        return source.some((item) => item.id === message.id) ? update(message.id, () => message) : append(message)
      }
      default:
        return
    }
  }

  return { reduce, clear: compatible.clear }
}
