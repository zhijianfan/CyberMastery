import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821_ctxpack",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`
        CREATE TABLE ctx_pack (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          sensitivity TEXT NOT NULL,
          revision INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          estimated_tokens INTEGER NOT NULL,
          attached_count INTEGER NOT NULL DEFAULT 0,
          last_attached_at INTEGER NULL,
          create_idempotency_key TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_deleted INTEGER NULL,
          UNIQUE(workspace_id, created_by_user_id, create_idempotency_key)
        )
      `)
      yield* tx.run(sql`CREATE INDEX ctx_pack_workspace_created ON ctx_pack (workspace_id, time_created DESC, id DESC)`)
      yield* tx.run(sql`CREATE INDEX ctx_pack_workspace_updated ON ctx_pack (workspace_id, time_updated DESC, id DESC)`)
      yield* tx.run(sql`CREATE INDEX ctx_pack_workspace_usage ON ctx_pack (workspace_id, attached_count DESC, id DESC)`)
      yield* tx.run(sql`CREATE INDEX ctx_pack_workspace_last_used ON ctx_pack (workspace_id, last_attached_at DESC, id DESC)`)
      yield* tx.run(sql`
        CREATE TABLE ctx_pack_fragment (
          id TEXT PRIMARY KEY,
          ctx_pack_id TEXT NOT NULL REFERENCES ctx_pack(id),
          ordinal INTEGER NOT NULL,
          text_content TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          estimated_tokens INTEGER NOT NULL,
          source_workspace_id TEXT NOT NULL,
          source_block_id TEXT NOT NULL,
          source_functionality_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_direction TEXT NOT NULL,
          source_timestamp INTEGER NULL,
          captured_at INTEGER NOT NULL,
          entity_ref_json TEXT NULL,
          source_label TEXT NULL,
          source_metadata_json TEXT NOT NULL,
          source_sensitivity TEXT NOT NULL,
          UNIQUE(ctx_pack_id, ordinal)
        )
      `)
      yield* tx.run(sql`CREATE INDEX ctx_pack_fragment_pack ON ctx_pack_fragment (ctx_pack_id, ordinal)`)
      yield* tx.run(
        sql`CREATE INDEX ctx_pack_fragment_source_block ON ctx_pack_fragment (source_workspace_id, source_block_id, ctx_pack_id)`,
      )
      yield* tx.run(
        sql`CREATE INDEX ctx_pack_fragment_source_functionality ON ctx_pack_fragment (source_workspace_id, source_functionality_id, ctx_pack_id)`,
      )
      yield* tx.run(sql`CREATE INDEX ctx_pack_fragment_source_kind ON ctx_pack_fragment (source_workspace_id, source_kind, ctx_pack_id)`)
      yield* tx.run(sql`
        CREATE TABLE ctx_pack_keyword (
          ctx_pack_id TEXT NOT NULL REFERENCES ctx_pack(id),
          ordinal INTEGER NOT NULL,
          keyword_display TEXT NOT NULL,
          keyword_normalized TEXT NOT NULL,
          PRIMARY KEY(ctx_pack_id, keyword_normalized)
        )
      `)
      yield* tx.run(sql`CREATE INDEX ctx_pack_keyword_lookup ON ctx_pack_keyword (keyword_normalized, ctx_pack_id)`)
      yield* tx.run(
        sql`CREATE VIRTUAL TABLE ctx_pack_fts USING fts5(ctx_pack_id UNINDEXED, workspace_id UNINDEXED, title, keywords, content, tokenize = 'unicode61 remove_diacritics 2')`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
