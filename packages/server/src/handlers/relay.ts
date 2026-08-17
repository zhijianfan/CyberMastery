import path from "path"
import { appendFile, mkdir } from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import { ChatRelayPayload } from "@opencode-ai/core/workspace/chat-relay-payload"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { RelayError } from "@opencode-ai/protocol/groups/relay"
import { Api } from "../api"

import type { ChatCrawler, ChatRelay, ChatSessionContext, RelayedMessage, RelayState } from "@opencode-ai/relay"

let instance: ChatRelay | undefined
let initializing: Promise<RelayState> | undefined
let submitting: Promise<unknown> | undefined

// The crawler is switchable: set OPENCODE_CHAT_RELAY_PROVIDER to crawl a
// different provider (e.g. "claude"). Storage is namespaced per provider so
// sessions from different providers never mix.
let activeCrawler: ChatCrawler | undefined

async function loadCrawler(): Promise<ChatCrawler> {
  if (activeCrawler) return activeCrawler
  const relay = await import("@opencode-ai/relay")
  const requested = process.env.OPENCODE_CHAT_RELAY_PROVIDER ?? "chatgpt"
  activeCrawler = requested === "claude" ? relay.ClaudeCrawler : relay.ChatGPTCrawler
  return activeCrawler
}

const RELAY_ROOT = path.join(Global.Path.data, "chat-relay")

// Each relayed message becomes part of the relay session's OperatingContext
// stack. The OperatingAgent consumes this stack; for now the relay appends
// every message, compacted into timestamped, indexed JSONL records.
async function relayToOperatingAgent(
  store: string,
  message: RelayedMessage,
  context: ChatSessionContext,
): Promise<void> {
  await mkdir(path.dirname(store), { recursive: true })
  const record = {
    conversationId: context.conversationId,
    id: message.id,
    role: message.role,
    text: message.text,
    files: message.files ?? [],
    at: message.at,
  }
  await appendFile(store, JSON.stringify(record) + "\n", "utf8")
}

function providerDir(crawler: ChatCrawler) {
  return path.join(RELAY_ROOT, crawler.id)
}

async function loadInstance(): Promise<ChatRelay> {
  if (instance) return Promise.resolve(instance)
  const crawler = await loadCrawler()
  const relay = await import("@opencode-ai/relay")
  const dir = providerDir(crawler)
  instance = new relay.ChatRelay({
    crawler,
    profile: { profileDir: path.join(dir, "profile") },
    sessionStorePath: path.join(dir, "session.json"),
    relay: (message, context) => relayToOperatingAgent(path.join(dir, "operating-context.jsonl"), message, context),
  })
  return instance
}

function relayError(error: unknown) {
  return new RelayError({
    name: "RelayError",
    data: { message: error instanceof Error ? error.message : String(error) },
  })
}

const initialize = Effect.tryPromise({
  try: () => {
    initializing ??= loadInstance()
      .then(async (relay) => {
        if (relay.status() === "error") await relay.dispose()
        return relay.initialize()
      })
      .finally(() => {
        initializing = undefined
      })
    return initializing
  },
  catch: relayError,
}).pipe(Effect.map((status) => ({ status })))

// The UI only needs the visible conversation window; the full session history
// resides server-side (session store + OperatingContext stack). Cap the relayed
// tail so repeated status polls stay cheap and bounded.
const RELAY_TAIL_LIMIT = 50

const status = Effect.tryPromise({
  try: async () => {
    const relay = instance
    const session = relay?.sessionContext()
    const messages = session ? [...session.messages] : []
    return {
      status: relay?.status() ?? "uninitialized",
      provider: relay?.crawlerId ?? "chatgpt",
      conversationId: session?.conversationId,
      url: session?.url,
      messages: messages.slice(-RELAY_TAIL_LIMIT),
      totalMessages: messages.length,
    }
  },
  catch: relayError,
})

const dispose = Effect.tryPromise({
  try: async () => {
    if (submitting) await submitting
    const relay = instance
    if (!relay) return
    await relay.dispose()
    instance = undefined
  },
  catch: relayError,
}).pipe(Effect.as(HttpApiSchema.NoContent.make()))

export const RelayHandler = HttpApiBuilder.group(Api, "server.relay", (handlers) =>
  Effect.gen(function* () {
    const store = yield* ChatRelayPayload.Service
    return handlers
      .handle("relay.initialize", () => initialize)
      .handle("relay.status", () => status)
      .handle("relay.submit", (ctx) =>
        Effect.gen(function* () {
          const relay = yield* Effect.tryPromise({ try: () => loadInstance(), catch: relayError })
          yield* Effect.tryPromise({
            try: async () => {
              if (submitting) await submitting
              if (!relay.isInitialized()) {
                throw new Error("ChatRelay cannot route until initialized with a logged-in browser session")
              }
              submitting = relay.submit(ctx.payload.message).finally(() => {
                submitting = undefined
              })
              await submitting
            },
            catch: relayError,
          })
          const session = relay.sessionContext()
          const message = session?.messages.at(-1)
          if (!message) return yield* Effect.fail(relayError(new Error("ChatRelay produced no relayed reply")))
          const payload = yield* store.append({
            workspaceID: ctx.payload.workspaceID,
            conversationId: session?.conversationId ?? "unknown",
            text: message.text,
            files: message.files ?? [],
          })
          return { message, payload }
        }),
      )
      .handle("relay.dispose", () => dispose)
      .handle("relay.payload.list", (ctx) => store.list(ctx.params.workspaceID))
      .handle("relay.payload.markImportant", (ctx) =>
        store
          .markImportant({
            workspaceID: ctx.params.workspaceID,
            payloadID: ctx.params.payloadID,
            important: ctx.payload.important,
          })
          .pipe(Effect.mapError((error) => relayError(new Error(`payload not found: ${error.payloadID}`)))),
      )
  }),
)
