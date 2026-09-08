import { expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { adaptCurrentSessionEvent, normalizeCurrentSessionMessage } from "./current-session-events"
import { createV2SessionReducer } from "./server-session-v2-reducer"
import { normalizeSessionMessages } from "@/utils/session-message"

test("projects native prompt attachments into file and agent parts", () => {
  const message = normalizeCurrentSessionMessage({
    id: "msg_user",
    type: "user",
    time: { created: 1 },
    text: "@notes.txt @build",
    files: [
      {
        uri: "file:///repo/notes.txt",
        mime: "text/plain",
        name: "notes.txt",
        source: { start: 0, end: 10, text: "@notes.txt" },
      },
    ],
    agents: [{ name: "build", source: { start: 11, end: 17, text: "@build" } }],
  })
  const parts = normalizeSessionMessages("ses", [message]).parts.get("msg_user")!
  expect(parts[1]).toMatchObject({ url: "file:///repo/notes.txt", source: { text: { value: "@notes.txt" } } })
  expect(parts[2]).toMatchObject({ name: "build", source: { value: "@build" } })
})

test("continues distinct native text IDs from fetched history and ISO timestamps", () => {
  const source = [
    normalizeCurrentSessionMessage({
      id: "msg_assistant",
      type: "assistant",
      agent: "parallel-master",
      model: { id: "model", providerID: "provider" },
      content: [
        { type: "text", id: "first", text: "one" },
        { type: "text", id: "second", text: "two" },
      ],
      time: { created: 1 },
    }),
  ]
  const adapted = adaptCurrentSessionEvent(
    {
      id: "evt_delta",
      type: "session.next.text.delta",
      data: {
        sessionID: "ses",
        assistantMessageID: "msg_assistant",
        textID: "second",
        delta: "!",
        timestamp: "1970-01-01T00:00:00.123Z",
      },
    } as unknown as OpenCodeEvent,
    source,
  )!
  expect(adapted).toHaveLength(1)
  expect(adapted[0]).toMatchObject({ created: 123, data: { ordinal: 1, contentID: "second" } })
  const result = createV2SessionReducer().reduce(source, adapted[0]!)
  expect(result?.messages[0]).toMatchObject({ content: [{ text: "one" }, { text: "two!" }] })
})

test("normalizes native pending tools and preserves legacy history values", () => {
  const assistant = {
    id: "msg_assistant",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [
      {
        type: "tool",
        id: "call",
        name: "bash",
        provider: { executed: true },
        state: { status: "pending", input: "{" },
        time: { created: 1 },
      },
    ],
    time: { created: 1 },
  }
  expect(normalizeCurrentSessionMessage(assistant)).toMatchObject({
    content: [{ id: "call", executed: true, state: { status: "streaming", input: "{" } }],
  })
  const old: SessionMessageInfo = {
    ...assistant,
    type: "assistant",
    content: [
      {
        type: "tool",
        id: "old",
        name: "bash",
        executed: true,
        state: { status: "running", input: {}, metadata: { title: "working" } },
        time: { created: 1 },
      },
    ],
  }
  expect(normalizeCurrentSessionMessage(old)).toMatchObject({
    content: [{ executed: true, state: { metadata: { title: "working" } } }],
  })
})

test("maps native tool progress and failure into the existing reducer", () => {
  const reducer = createV2SessionReducer()
  const state = {
    messages: [
      normalizeCurrentSessionMessage({
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        time: { created: 1 },
      }),
    ],
  }
  const apply = (type: string, data: object) => {
    for (const event of adaptCurrentSessionEvent(
      {
        id: "evt",
        type,
        data: { sessionID: "ses", assistantMessageID: "msg_assistant", callID: "call", timestamp: 2, ...data },
      } as unknown as OpenCodeEvent,
      state.messages,
    ) ?? []) {
      state.messages = reducer.reduce(state.messages, event)?.messages ?? state.messages
    }
  }
  apply("session.next.tool.input.started", { name: "bash" })
  apply("session.next.tool.called", { tool: "bash", input: { command: "test" }, provider: { executed: false } })
  apply("session.next.tool.progress", {
    structured: { phase: "running" },
    content: [{ type: "text", text: "partial" }],
  })
  apply("session.next.tool.failed", { error: { type: "unknown", message: "failed" }, provider: { executed: false } })
  expect(state.messages[0]).toMatchObject({
    content: [
      {
        state: {
          status: "error",
          structured: { phase: "running" },
          content: [{ type: "text", text: "partial" }],
        },
      },
    ],
  })
})
