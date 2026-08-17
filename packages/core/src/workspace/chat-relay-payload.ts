export * as ChatRelayPayload from "./chat-relay-payload"

import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { ChatRelayPayloadTable } from "./sql"

export interface DownloadableFile {
  name: string
  url: string
}

// One captured ChatRelay response, stored per workspace. `index` is the
// per-workspace monotonic sequence; `important` is user-marked; `timeCreated`
// is the capture timestamp.
export interface Payload {
  readonly id: string
  readonly workspaceID: Workspace.ID
  readonly conversationId: string
  readonly text: string
  readonly files: readonly DownloadableFile[]
  readonly index: number
  readonly important: boolean
  readonly timeCreated: number
}

export class PayloadNotFoundError extends Schema.TaggedErrorClass<PayloadNotFoundError>()(
  "ChatRelayPayload.PayloadNotFoundError",
  { payloadID: Schema.String },
) {}

export interface Interface {
  readonly append: (input: {
    workspaceID: Workspace.ID
    conversationId: string
    text: string
    files: readonly DownloadableFile[]
  }) => Effect.Effect<Payload>
  readonly list: (workspaceID: Workspace.ID) => Effect.Effect<readonly Payload[]>
  readonly markImportant: (input: {
    workspaceID: Workspace.ID
    payloadID: string
    important: boolean
  }) => Effect.Effect<Payload, PayloadNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ChatRelayPayload") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const append: Interface["append"] = Effect.fn("ChatRelayPayload.append")(function* (input) {
      const rows = yield* db
        .select({ seq: ChatRelayPayloadTable.seq })
        .from(ChatRelayPayloadTable)
        .where(eq(ChatRelayPayloadTable.workspace_id, input.workspaceID))
        .orderBy(desc(ChatRelayPayloadTable.seq))
        .limit(1)
        .pipe(Effect.orDie)
      const index = (rows[0]?.seq ?? 0) + 1
      const row = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceID,
        conversation_id: input.conversationId,
        text: input.text,
        files: input.files,
        seq: index,
        important: false,
        time_created: Date.now(),
      }
      yield* db.insert(ChatRelayPayloadTable).values(row).run().pipe(Effect.orDie)
      return fromRow(row)
    })

    const list: Interface["list"] = Effect.fn("ChatRelayPayload.list")(function* (workspaceID) {
      const rows = yield* db
        .select()
        .from(ChatRelayPayloadTable)
        .where(eq(ChatRelayPayloadTable.workspace_id, workspaceID))
        .orderBy(desc(ChatRelayPayloadTable.seq))
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const markImportant: Interface["markImportant"] = Effect.fn("ChatRelayPayload.markImportant")(function* (input) {
      const rows = yield* db
        .update(ChatRelayPayloadTable)
        .set({ important: input.important })
        .where(and(eq(ChatRelayPayloadTable.id, input.payloadID), eq(ChatRelayPayloadTable.workspace_id, input.workspaceID)))
        .returning()
        .pipe(Effect.orDie)
      const row = rows[0]
      if (!row) return yield* new PayloadNotFoundError({ payloadID: input.payloadID })
      return fromRow(row)
    })

    return Service.of({ append, list, markImportant })
  }),
)

function fromRow(row: typeof ChatRelayPayloadTable.$inferSelect): Payload {
  return {
    id: row.id,
    workspaceID: Workspace.ID.make(row.workspace_id),
    conversationId: row.conversation_id,
    text: row.text,
    files: row.files,
    index: row.seq,
    important: row.important,
    timeCreated: row.time_created,
  }
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
