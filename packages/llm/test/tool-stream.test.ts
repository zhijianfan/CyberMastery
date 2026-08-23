import { describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { LLMError } from "../src/schema"
import { ToolStream } from "../src/protocols/utils/tool-stream"
import { it } from "./lib/effect"

const ADAPTER = "test-route"

describe("ToolStream", () => {
  it.effect("starts from OpenAI-style deltas and finalizes parsed input", () =>
    Effect.gen(function* () {
      const first = ToolStream.appendOrStart(
        ADAPTER,
        ToolStream.empty<number>(),
        0,
        { id: "call_1", name: "lookup", text: '{"query"' },
        "missing tool",
      )
      if (ToolStream.isError(first)) return yield* first
      const second = ToolStream.appendOrStart(ADAPTER, first.tools, 0, { text: ':"weather"}' }, "missing tool")
      if (ToolStream.isError(second)) return yield* second
      const finished = yield* ToolStream.finish(ADAPTER, second.tools, 0)

      expect(first.events).toEqual([
        { type: "tool-input-start", id: "call_1", name: "lookup" },
        { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
      ])
      expect(second.events).toEqual([{ type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' }])
      expect(finished).toEqual({
        tools: {},
        events: [
          { type: "tool-input-end", id: "call_1", name: "lookup" },
          { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
        ],
      })
    }),
  )

  for (const testCase of [
    {
      name: "top-level",
      fragments: ['{"task":"private-value","task":', "2}"],
      path: "$.task",
    },
    {
      name: "nested",
      fragments: ['{"batch":{"task":1,"task":2}}', ""],
      path: "$.batch.task",
    },
    {
      name: "escaped-equivalent",
      fragments: ['{"task":1,"\\u0074ask":2}', ""],
      path: "$.task",
    },
    {
      name: "cross-fragment",
      fragments: ['{"tasks":[{"id":"one"}],"ta', 'sks":[{"id":"two"}]}'],
      path: "$.tasks",
    },
  ] as const)
    it.effect(`rejects ${testCase.name} duplicate keys`, () =>
      Effect.gen(function* () {
        const first = ToolStream.appendOrStart(
          ADAPTER,
          ToolStream.empty<number>(),
          0,
          { id: "call_1", name: "lookup", text: testCase.fragments[0] },
          "missing tool",
        )
        if (ToolStream.isError(first)) return yield* first
        const second = ToolStream.appendOrStart(
          ADAPTER,
          first.tools,
          0,
          { text: testCase.fragments[1] },
          "missing tool",
        )
        if (ToolStream.isError(second)) return yield* second
        const exit = yield* ToolStream.finish(ADAPTER, second.tools, 0).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isSuccess(exit)) return
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(LLMError)
        if (!(error instanceof LLMError)) return
        expect(error.reason.message).toContain(testCase.path)
        expect(error.reason.message).not.toContain("private-value")
        if (error.reason._tag === "InvalidProviderOutput") expect(error.reason.raw).toBeUndefined()
      }),
    )

  it.effect("keeps malformed JSON with duplicate keys on the generic error path", () =>
    Effect.gen(function* () {
      const tools = ToolStream.start(
        ToolStream.empty<number>(),
        0,
        { id: "call_1", name: "lookup", input: '{"task":1,/*not JSON*/"task":2}' },
        ADAPTER,
      )
      if (ToolStream.isError(tools)) return yield* tools
      const exit = yield* ToolStream.finish(ADAPTER, tools, 0).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(LLMError)
      if (!(error instanceof LLMError)) return
      expect(error.reason.message).toBe(`Invalid JSON input for ${ADAPTER} tool call lookup`)
    }),
  )

  it.effect("allows repeated keys in sibling objects and key-like string content", () =>
    Effect.gen(function* () {
      const first = ToolStream.appendOrStart(
        ADAPTER,
        ToolStream.empty<number>(),
        0,
        { id: "call_1", name: "lookup", text: '{"left":{"task":1},"right":' },
        "missing tool",
      )
      if (ToolStream.isError(first)) return yield* first
      const second = ToolStream.appendOrStart(
        ADAPTER,
        first.tools,
        0,
        { text: '{"task":2},"text":"\\"task\\":3"}' },
        "missing tool",
      )
      if (ToolStream.isError(second)) return yield* second
      const finished = yield* ToolStream.finish(ADAPTER, second.tools, 0)

      expect(finished.events?.at(-1)).toEqual({
        type: "tool-call",
        id: "call_1",
        name: "lookup",
        input: {
          left: { task: 1 },
          right: { task: 2 },
          text: '"task":3',
        },
      })
    }),
  )

  for (const testCase of [
    { name: "call ID", delta: { id: "call_2", text: "" } },
    { name: "tool name", delta: { name: "search", text: "" } },
  ] as const)
    it.effect(`rejects a changed non-empty ${testCase.name} for an active stream key`, () =>
      Effect.gen(function* () {
        const first = ToolStream.appendOrStart(
          ADAPTER,
          ToolStream.empty<number>(),
          0,
          { id: "call_1", name: "lookup", text: "" },
          "missing tool",
        )
        if (ToolStream.isError(first)) return yield* first
        const result = ToolStream.appendOrStart(ADAPTER, first.tools, 0, testCase.delta, "missing tool")

        expect(result).toBeInstanceOf(LLMError)
        if (ToolStream.isError(result)) expect(result.reason.message).toContain(`changed ${testCase.name}`)
      }),
    )

  it.effect("ignores empty identity fields for an active stream key", () =>
    Effect.gen(function* () {
      const first = ToolStream.appendOrStart(
        ADAPTER,
        ToolStream.empty<number>(),
        0,
        { id: "call_1", name: "lookup", text: "" },
        "missing tool",
      )
      if (ToolStream.isError(first)) return yield* first
      const second = ToolStream.appendOrStart(
        ADAPTER,
        first.tools,
        0,
        { id: "", name: "", text: "{}" },
        "missing tool",
      )
      if (ToolStream.isError(second)) return yield* second

      expect(second.tool).toMatchObject({ id: "call_1", name: "lookup", input: "{}" })
    }),
  )

  it.effect("fails appendExisting when the provider skipped the tool start", () =>
    Effect.gen(function* () {
      const error = ToolStream.appendExisting(ADAPTER, ToolStream.empty<number>(), 0, "{}", "missing tool")

      expect(error).toBeInstanceOf(LLMError)
      if (ToolStream.isError(error)) expect(error.reason.message).toBe("missing tool")
    }),
  )

  for (const testCase of [
    { name: "same identity", tool: { id: "call_1", name: "lookup" } },
    { name: "changed call ID", tool: { id: "call_2", name: "lookup" } },
    { name: "changed tool name", tool: { id: "call_1", name: "search" } },
  ] as const)
    it.effect(`rejects a repeated explicit start with ${testCase.name}`, () =>
      Effect.gen(function* () {
        const first = ToolStream.start(
          ToolStream.empty<number>(),
          0,
          { id: "call_1", name: "lookup", input: '{"query":' },
          ADAPTER,
        )
        if (ToolStream.isError(first)) return yield* first
        const repeated = ToolStream.start(first, 0, testCase.tool, ADAPTER)

        expect(repeated).toBeInstanceOf(LLMError)
      }),
    )

  it.effect("uses final input override without losing accumulated deltas", () =>
    Effect.gen(function* () {
      const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
        id: "call_1",
        name: "lookup",
        input: '{"query":"partial"}',
      }, ADAPTER)
      if (ToolStream.isError(tools)) return yield* tools
      const finished = yield* ToolStream.finishWithInput(ADAPTER, tools, "item_1", '{"query":"final"}')

      expect(finished).toEqual({
        tools: {},
        events: [
          { type: "tool-input-end", id: "call_1", name: "lookup" },
          { type: "tool-call", id: "call_1", name: "lookup", input: { query: "final" } },
        ],
      })
    }),
  )

  it.effect("preserves providerExecuted and clears all tools", () =>
    Effect.gen(function* () {
      const first = ToolStream.start<number>(ToolStream.empty<number>(), 0, {
        id: "call_1",
        name: "lookup",
        input: "{}",
      }, ADAPTER)
      if (ToolStream.isError(first)) return yield* first
      const tools = ToolStream.start(first, 1, {
        id: "call_2",
        name: "web_search",
        input: '{"query":"docs"}',
        providerExecuted: true,
      }, ADAPTER)
      if (ToolStream.isError(tools)) return yield* tools
      const finished = yield* ToolStream.finishAll(ADAPTER, tools)

      expect(finished).toEqual({
        tools: {},
        events: [
          { type: "tool-input-end", id: "call_1", name: "lookup" },
          { type: "tool-call", id: "call_1", name: "lookup", input: {} },
          { type: "tool-input-end", id: "call_2", name: "web_search" },
          {
            type: "tool-call",
            id: "call_2",
            name: "web_search",
            input: { query: "docs" },
            providerExecuted: true,
          },
        ],
      })
    }),
  )
})
