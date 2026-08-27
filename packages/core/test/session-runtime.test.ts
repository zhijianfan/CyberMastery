import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionRuntime } from "@opencode-ai/core/session/runtime"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

describe("SessionRuntime", () => {
  it.effect("classifies projected child evidence exactly", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const suffix = Math.random().toString(36).slice(2)
      const projectID = ProjectV2.ID.make(`prj_runtime_${suffix}`)
      const legacyOnly = SessionSchema.ID.make(`ses_runtime_legacy_${suffix}`)
      const v2Only = SessionSchema.ID.make(`ses_runtime_v2_${suffix}`)
      const mixed = SessionSchema.ID.make(`ses_runtime_mixed_${suffix}`)
      const empty = SessionSchema.ID.make(`ses_runtime_empty_${suffix}`)
      yield* db.run(
        sql`INSERT INTO project (id, worktree, vcs, sandboxes, time_created, time_updated) VALUES (${projectID}, '/project', NULL, '[]', 0, 0)`,
      )
      for (const sessionID of [legacyOnly, v2Only, mixed, empty]) {
        yield* db.run(
          sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${sessionID}, ${projectID}, ${sessionID}, '/project', 'test', 'test', 0, 0)`,
        )
      }
      yield* db.run(sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${"msg_" + suffix}, ${legacyOnly}, 0, 0, '{}')`)
      yield* db.run(sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (${"msg_v2_" + suffix}, ${v2Only}, 'user', 1, 0, 0, '{}')`)
      yield* db.run(sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, time_created) VALUES (${"msg_input_" + suffix}, ${v2Only}, '{}', 'steer', 1, 0)`)
      yield* db.run(sql`INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES (${mixed}, 'baseline', '{}', 1)`)
      yield* db.run(sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${"prt_" + suffix}, ${"msg_" + suffix}, ${legacyOnly}, 0, 0, '{}')`)
      yield* db.run(sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${"msg_mixed_legacy_" + suffix}, ${mixed}, 0, 0, '{}')`)
      yield* db.run(sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (${"msg_mixed_" + suffix}, ${mixed}, 'user', 1, 0, 0, '{}')`)

      expect(yield* SessionRuntime.classify(db, legacyOnly)).toBe("legacy")
      expect(yield* SessionRuntime.classify(db, v2Only)).toBe("v2")
      expect(yield* SessionRuntime.classify(db, mixed)).toBe("mixed")
      expect(yield* SessionRuntime.classify(db, empty)).toBe("legacy")
    }),
  )

  it.effect("requires the stored runtime without exposing content", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessionID = SessionSchema.ID.make(`ses_runtime_require_${Math.random().toString(36).slice(2)}`)
      const projectID = ProjectV2.ID.make(`prj_runtime_require_${Math.random().toString(36).slice(2)}`)
      yield* db.run(sql`INSERT INTO project (id, worktree, vcs, sandboxes, time_created, time_updated) VALUES (${projectID}, '/project', NULL, '[]', 0, 0)`)
      yield* db.run(sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, runtime) VALUES (${sessionID}, ${projectID}, ${sessionID}, '/project', 'test', 'test', 0, 0, 'legacy')`)

      const error = yield* SessionRuntime.require(sessionID, "v2", db).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "SessionRuntime.ConflictError", sessionID, expected: "v2", actual: "legacy" })
      expect(Object.keys(error)).toEqual(expect.arrayContaining(["_tag", "sessionID", "expected", "actual"]))
    }),
  )
})
