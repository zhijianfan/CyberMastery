import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { V2Event, V2SessionMessagesResponse } from "@opencode-ai/sdk/v2/types"
import { createSessionNextReducer, normalizeCurrentSessionMessage } from "./server-session-next-reducer"

type CurrentEvent = Extract<V2Event, { type: `session.next.${string}` }>
type CurrentMessage = V2SessionMessagesResponse["data"][number]
const model = { providerID: "test", id: "model" }
const tokens = { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }

function event<T extends CurrentEvent["type"]>(
  type: T,
  data: Omit<Extract<CurrentEvent, { type: T }>["data"], "timestamp" | "sessionID">,
) {
  return { id: "evt_test", type, data: { timestamp: 100, sessionID: "ses_1", ...data } } as unknown as Extract<
    CurrentEvent,
    { type: T }
  >
}

function harness(initial: SessionMessageInfo[] = []) {
  const reducer = createSessionNextReducer()
  let messages = initial
  return {
    messages: () => messages,
    apply(input: CurrentEvent) {
      const result = reducer.reduce(messages, input)
      if (result) messages = result.messages
      return result
    },
  }
}

describe("current session event compatibility", () => {
  test("admission remains pending, promoted prompts use message IDs and normalize file and agent mentions", () => {
    const state = harness()
    const prompt = {
      text: "Inspect @readme",
      files: [{ uri: "file:///repo/readme.md", mime: "text/plain", source: { start: 8, end: 15, text: "@readme" } }],
      agents: [{ name: "build", source: { start: 0, end: 6, text: "@build" } }],
    }
    state.apply(event("session.next.prompt.admitted", { messageID: "msg_user", prompt, delivery: "steer" }))
    expect(state.messages()).toEqual([])
    state.apply(event("session.next.prompted", { messageID: "msg_user", prompt, delivery: "steer" }))
    state.apply(event("session.next.prompted", { messageID: "msg_user", prompt, delivery: "steer" }))
    expect(state.messages()).toHaveLength(1)
    expect(state.messages()[0]).toMatchObject({
      id: "msg_user",
      type: "user",
      time: { created: 100 },
      files: [{ source: { type: "uri", uri: "file:///repo/readme.md" }, mention: prompt.files[0]!.source }],
      agents: [{ name: "build", mention: prompt.agents[0]!.source }],
    })
  })

  test("canonical text and reasoning IDs keep interleaved streams and reloaded history distinct", () => {
    const state = harness()
    state.apply(event("session.next.step.started", { assistantMessageID: "msg_a", agent: "build", model }))
    state.apply(event("session.next.text.started", { assistantMessageID: "msg_a", textID: "text-first" }))
    state.apply(
      event("session.next.reasoning.started", {
        assistantMessageID: "msg_a",
        reasoningID: "reason",
        providerMetadata: { vendor: { signature: "start" } },
      }),
    )
    state.apply(event("session.next.text.started", { assistantMessageID: "msg_a", textID: "text-second" }))
    state.apply(
      event("session.next.text.delta", { assistantMessageID: "msg_a", textID: "text-second", delta: "second" }),
    )
    state.apply(event("session.next.text.delta", { assistantMessageID: "msg_a", textID: "text-first", delta: "first" }))
    state.apply(
      event("session.next.reasoning.delta", { assistantMessageID: "msg_a", reasoningID: "reason", delta: "think" }),
    )
    state.apply(event("session.next.text.started", { assistantMessageID: "msg_a", textID: "text-first" }))
    state.apply(
      event("session.next.reasoning.ended", {
        assistantMessageID: "msg_a",
        reasoningID: "reason",
        text: "thought",
        providerMetadata: { vendor: { signature: "end" } },
      }),
    )
    expect(state.messages()[0]).toMatchObject({
      content: [
        { type: "text", id: "text-first", text: "first" },
        {
          type: "reasoning",
          id: "reason",
          text: "thought",
          state: { vendor: { signature: "end" } },
          time: { completed: 100 },
        },
        { type: "text", id: "text-second", text: "second" },
      ],
    })

    const loaded = normalizeCurrentSessionMessage({
      id: "msg_loaded",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 1 },
      content: [
        { type: "text", id: "persisted", text: "saved" },
        { type: "text", id: "last", text: "last" },
      ],
    })
    const reload = harness([loaded])
    reload.apply(
      event("session.next.text.delta", { assistantMessageID: "msg_loaded", textID: "persisted", delta: " live" }),
    )
    expect(reload.messages()[0]).toMatchObject({
      content: [
        { id: "persisted", text: "saved live" },
        { id: "last", text: "last" },
      ],
    })
    expect(
      reload.apply(
        event("session.next.text.delta", { assistantMessageID: "msg_missing", textID: "persisted", delta: "wrong" }),
      )?.missing,
    ).toBe("msg_missing")
    expect(
      reload.apply(
        event("session.next.text.delta", { assistantMessageID: "msg_loaded", textID: "unseen", delta: "wrong" }),
      )?.missing,
    ).toBe("msg_loaded")
  })

  test("tool streaming, execution, progress, result metadata and step failures reach the existing timeline shape", () => {
    const state = harness()
    const owner = { assistantMessageID: "msg_a", callID: "call_1" }
    state.apply(event("session.next.step.started", { assistantMessageID: "msg_a", agent: "parallel-master", model }))
    state.apply(event("session.next.tool.input.started", { ...owner, name: "task_batch" }))
    state.apply(event("session.next.tool.input.delta", { ...owner, delta: '{"tasks":' }))
    expect(state.messages()[0]).toMatchObject({ content: [{ state: { status: "streaming", input: '{"tasks":' } }] })
    state.apply(event("session.next.tool.input.ended", { ...owner, text: '{"tasks":[]}' }))
    state.apply(
      event("session.next.tool.called", {
        ...owner,
        tool: "task_batch",
        input: { tasks: [] },
        provider: { executed: true, metadata: { vendor: { id: "request" } } },
      }),
    )
    state.apply(
      event("session.next.tool.progress", {
        ...owner,
        structured: { title: "Working" },
        content: [{ type: "text", text: "progress" }],
      }),
    )
    expect(state.messages()[0]).toMatchObject({
      content: [
        {
          executed: true,
          providerState: { vendor: { id: "request" } },
          state: { status: "running", metadata: { title: "Working" }, content: [{ text: "progress" }] },
        },
      ],
    })
    state.apply(
      event("session.next.tool.success", {
        ...owner,
        structured: { title: "Done" },
        content: [{ type: "text", text: "result" }],
        result: { done: true },
        outputPaths: ["src/a.ts"],
        provider: { executed: false, metadata: { vendor: { id: "response" } } },
      }),
    )
    expect(state.messages()[0]).toMatchObject({
      content: [
        {
          executed: true,
          providerResultState: { vendor: { id: "response" } },
          state: {
            status: "completed",
            structured: { title: "Done" },
            result: { done: true },
            outputPaths: ["src/a.ts"],
          },
        },
      ],
    })
    state.apply(
      event("session.next.step.ended", { assistantMessageID: "msg_a", finish: "tool-calls", cost: 0.1, tokens }),
    )
    expect(state.messages()[0]).toMatchObject({ finish: "tool-calls", tokens, time: { completed: 100 } })
    state.apply(event("session.next.step.started", { assistantMessageID: "msg_b", agent: "parallel-master", model }))
    state.apply(
      event("session.next.step.failed", {
        assistantMessageID: "msg_b",
        error: { type: "unknown", message: "Provider failed" },
      }),
    )
    expect(state.messages()[1]).toMatchObject({
      finish: "error",
      error: { message: "Provider failed" },
      time: { completed: 100 },
    })
  })

  test("history normalization preserves current provider tool data and inline attachments", () => {
    const message: CurrentMessage = {
      id: "msg_a",
      type: "assistant",
      agent: "build",
      model,
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: "call_pending",
          name: "bash",
          state: { status: "pending", input: "{" },
          time: { created: 2 },
        },
        {
          type: "tool",
          id: "call_done",
          name: "bash",
          provider: { executed: true, metadata: { vendor: { id: "in" } }, resultMetadata: { vendor: { id: "out" } } },
          state: {
            status: "completed",
            input: {},
            structured: { title: "done" },
            content: [{ type: "text", text: "output" }],
            outputPaths: ["a.txt"],
          },
          time: { created: 2, completed: 4 },
        },
      ],
    }
    expect(normalizeCurrentSessionMessage(message)).toMatchObject({
      content: [
        { state: { status: "streaming", input: "{" } },
        {
          executed: true,
          providerState: { vendor: { id: "in" } },
          providerResultState: { vendor: { id: "out" } },
          state: { metadata: { title: "done" }, outputPaths: ["a.txt"] },
        },
      ],
    })
    expect(
      normalizeCurrentSessionMessage({
        id: "msg_u",
        type: "user",
        text: "image",
        time: { created: 1 },
        files: [{ uri: "data:image/png;base64,YWJj", mime: "image/png" }],
      }),
    ).toMatchObject({ files: [{ data: "YWJj", source: { type: "inline" } }] })
    expect(message.content[0]).toMatchObject({ state: { status: "pending" } })
    expect(
      normalizeCurrentSessionMessage({
        id: "msg_uri",
        type: "user",
        text: "file",
        time: { created: 1 },
        files: [{ uri: "data:text/plain,hello%20world", mime: "text/plain" }],
      }),
    ).toMatchObject({ files: [{ source: { type: "uri", uri: "data:text/plain,hello%20world" } }] })
  })

  test("missing step and tool boundaries request hydration; pending tool failures preserve their owning call", () => {
    const state = harness()
    expect(
      state.apply(
        event("session.next.step.ended", { assistantMessageID: "msg_missing", finish: "stop", cost: 0, tokens }),
      )?.missing,
    ).toBe("msg_missing")
    state.apply(event("session.next.step.started", { assistantMessageID: "msg_a", agent: "build", model }))
    expect(
      state.apply(
        event("session.next.tool.called", {
          assistantMessageID: "msg_a",
          callID: "missing",
          tool: "bash",
          input: {},
          provider: { executed: false },
        }),
      )?.missing,
    ).toBe("msg_a")
    state.apply(
      event("session.next.tool.input.started", { assistantMessageID: "msg_a", callID: "failed", name: "bash" }),
    )
    state.apply(
      event("session.next.tool.failed", {
        assistantMessageID: "msg_a",
        callID: "failed",
        error: { type: "unknown", message: "Invalid input" },
        provider: { executed: false },
      }),
    )
    expect(state.messages()[0]).toMatchObject({
      content: [{ id: "failed", state: { status: "error", input: {}, error: { message: "Invalid input" } } }],
    })
  })

  test("agent, model, shell and compaction events use canonical identity", () => {
    const state = harness()
    state.apply(event("session.next.agent.switched", { messageID: "msg_agent", agent: "build" }))
    state.apply(event("session.next.model.switched", { messageID: "msg_model", model }))
    state.apply(
      event("session.next.shell.started", { messageID: "msg_shell", callID: "shell_1", command: "echo test" }),
    )
    state.apply(event("session.next.shell.ended", { callID: "shell_1", output: "test" }))
    expect(state.messages().map((item) => item.id)).toEqual(["msg_agent", "msg_model", "msg_shell"])
    expect(state.messages()[2]).toMatchObject({
      shellID: "shell_1",
      status: "exited",
      output: { output: "test", truncated: false },
      time: { completed: 100 },
    })
    state.apply(event("session.next.compaction.started", { messageID: "msg_compact", reason: "auto" }))
    state.apply(event("session.next.compaction.delta", { messageID: "msg_compact", text: "summary " }))
    state.apply(
      event("session.next.compaction.ended", {
        messageID: "msg_compact",
        reason: "auto",
        text: "summary complete",
        recent: "msg_user",
      }),
    )
    expect(state.messages()[3]).toMatchObject({
      id: "msg_compact",
      status: "completed",
      summary: "summary complete",
      recent: "msg_user",
    })
    expect(state.messages()).toHaveLength(4)
  })
})
