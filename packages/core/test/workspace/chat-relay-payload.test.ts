import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import chatRelayPayloadMigration from "@opencode-ai/core/database/migration/20260817_chat_relay_payload"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { ChatRelayPayload } from "@opencode-ai/core/workspace/chat-relay-payload"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node, ChatRelayPayload.node])),
)

// Test databases are fresh in-memory (test/preload.ts) and are built from the
// Drizzle schema snapshot (schema.gen.ts), which predates the chat_relay_payload
// table, so the registered migration never runs there. Apply it explicitly
// until the snapshot is regenerated; the guard makes this a no-op once the
// table exists.
const ensurePayloadTable = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const tables = yield* db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_relay_payload'`,
  )
  if (tables.length > 0) return
  yield* db.transaction((tx) => chatRelayPayloadMigration.up(tx))
})

describe("chat relay payload repository", () => {
  test("normal migrations preserve pre-cutover payloads across database reopen", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "chat-relay-payload.sqlite")
    const layer = () =>
      AppNodeBuilder.build(
        LayerNode.group([Database.node, WorkspaceService.node, ChatRelayPayload.node]),
        [[Database.node, Database.layerFromPath(filename)]],
      )

    const workspaceID = await Effect.gen(function* () {
      const { db } = yield* Database.Service
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "pre-cutover-payload" })
      yield* db.run(sql`
        INSERT INTO chat_relay_payload (
          id, workspace_id, conversation_id, text, files, seq, important, time_created
        ) VALUES (
          ${"payload-before-cutover"},
          ${info.id},
          ${"conversation-before-cutover"},
          ${"persisted response"},
          ${JSON.stringify([{ name: "evidence.txt", url: "https://example.com/evidence.txt" }])},
          ${7},
          ${1},
          ${1_717_171_717_000}
        )
      `)
      return info.id
    }).pipe(Effect.provide(layer()), Effect.scoped, Effect.runPromise)

    const listed = await Effect.gen(function* () {
      const payloads = yield* ChatRelayPayload.Service
      return yield* payloads.list(workspaceID)
    }).pipe(Effect.provide(layer()), Effect.scoped, Effect.runPromise)

    expect(listed).toEqual([
      {
        id: "payload-before-cutover",
        workspaceID,
        conversationId: "conversation-before-cutover",
        text: "persisted response",
        files: [{ name: "evidence.txt", url: "https://example.com/evidence.txt" }],
        index: 7,
        important: true,
        timeCreated: 1_717_171_717_000,
      },
    ])
  })

  it.effect("append assigns per-workspace indexes starting at 1", () =>
    Effect.gen(function* () {
      yield* ensurePayloadTable
      const workspace = yield* WorkspaceService.Service
      const payloads = yield* ChatRelayPayload.Service
      const info = yield* workspace.create({ name: "crp-index" })

      const first = yield* payloads.append({
        workspaceID: info.id,
        conversationId: "conv-1",
        text: "first response",
        files: [{ name: "a.txt", url: "https://example.com/a.txt" }],
      })
      expect(first.index).toBe(1)
      expect(first.important).toBe(false)

      const second = yield* payloads.append({
        workspaceID: info.id,
        conversationId: "conv-1",
        text: "second response",
        files: [],
      })
      expect(second.index).toBe(2)
      expect(second.important).toBe(false)
    }),
  )

  it.effect("append indexes are isolated per workspace", () =>
    Effect.gen(function* () {
      yield* ensurePayloadTable
      const workspace = yield* WorkspaceService.Service
      const payloads = yield* ChatRelayPayload.Service
      const workspaceA = yield* workspace.create({ name: "crp-isolation-a" })
      const workspaceB = yield* workspace.create({ name: "crp-isolation-b" })

      yield* payloads.append({
        workspaceID: workspaceA.id,
        conversationId: "conv-a",
        text: "a1",
        files: [],
      })
      yield* payloads.append({
        workspaceID: workspaceA.id,
        conversationId: "conv-a",
        text: "a2",
        files: [],
      })

      const firstB = yield* payloads.append({
        workspaceID: workspaceB.id,
        conversationId: "conv-b",
        text: "b1",
        files: [],
      })
      expect(firstB.index).toBe(1)

      // A's rows are untouched by B's appends.
      const fromA = yield* payloads.list(workspaceA.id)
      expect(fromA.map((payload) => payload.text)).toEqual(["a2", "a1"])
    }),
  )

  it.effect("list returns payloads newest first with all fields intact", () =>
    Effect.gen(function* () {
      yield* ensurePayloadTable
      const workspace = yield* WorkspaceService.Service
      const payloads = yield* ChatRelayPayload.Service
      const info = yield* workspace.create({ name: "crp-list" })
      const files = [
        { name: "report.pdf", url: "https://example.com/report.pdf" },
        { name: "notes.md", url: "https://example.com/notes.md" },
      ]

      const first = yield* payloads.append({
        workspaceID: info.id,
        conversationId: "conv-1",
        text: "first response",
        files: files.slice(0, 1),
      })
      const second = yield* payloads.append({
        workspaceID: info.id,
        conversationId: "conv-2",
        text: "second response",
        files,
      })

      const listed = yield* payloads.list(info.id)
      expect(listed.map((payload) => payload.index)).toEqual([2, 1])
      expect(listed[0].text).toBe(second.text)
      expect(listed[0].conversationId).toBe(second.conversationId)
      expect(listed[0].files).toEqual(second.files)
      expect(listed[0].timeCreated).toBe(second.timeCreated)
      expect(listed[0].workspaceID).toBe(second.workspaceID)
      expect(listed[0].id).toBe(second.id)
      expect(listed[1].text).toBe(first.text)
      expect(listed[1].files).toEqual(first.files)
    }),
  )

  it.effect("markImportant persists the flag across list calls", () =>
    Effect.gen(function* () {
      yield* ensurePayloadTable
      const workspace = yield* WorkspaceService.Service
      const payloads = yield* ChatRelayPayload.Service
      const info = yield* workspace.create({ name: "crp-important" })
      const appended = yield* payloads.append({
        workspaceID: info.id,
        conversationId: "conv-1",
        text: "response",
        files: [],
      })

      const marked = yield* payloads.markImportant({
        workspaceID: info.id,
        payloadID: appended.id,
        important: true,
      })
      expect(marked.important).toBe(true)
      expect((yield* payloads.list(info.id))[0].important).toBe(true)

      const cleared = yield* payloads.markImportant({
        workspaceID: info.id,
        payloadID: appended.id,
        important: false,
      })
      expect(cleared.important).toBe(false)
      expect((yield* payloads.list(info.id))[0].important).toBe(false)
    }),
  )

  it.effect("markImportant on an unknown payload fails with PayloadNotFoundError", () =>
    Effect.gen(function* () {
      yield* ensurePayloadTable
      const workspace = yield* WorkspaceService.Service
      const payloads = yield* ChatRelayPayload.Service
      const info = yield* workspace.create({ name: "crp-not-found" })

      const error = yield* payloads
        .markImportant({ workspaceID: info.id, payloadID: "missing-payload", important: true })
        .pipe(Effect.flip)
      expect(error._tag).toBe("ChatRelayPayload.PayloadNotFoundError")
      expect(error.payloadID).toBe("missing-payload")
    }),
  )
})
