import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260826071420_session-runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`runtime\` text DEFAULT 'legacy' NOT NULL;`)
      yield* tx.run(`
        UPDATE session
        SET runtime = CASE
          WHEN (
            EXISTS (SELECT 1 FROM message WHERE message.session_id = session.id)
            OR EXISTS (SELECT 1 FROM part WHERE part.session_id = session.id)
          ) AND (
            EXISTS (SELECT 1 FROM session_input WHERE session_input.session_id = session.id)
            OR EXISTS (SELECT 1 FROM session_message WHERE session_message.session_id = session.id)
            OR EXISTS (SELECT 1 FROM session_context_epoch WHERE session_context_epoch.session_id = session.id)
          ) THEN 'mixed'
          WHEN (
            EXISTS (SELECT 1 FROM session_input WHERE session_input.session_id = session.id)
            OR EXISTS (SELECT 1 FROM session_message WHERE session_message.session_id = session.id)
            OR EXISTS (SELECT 1 FROM session_context_epoch WHERE session_context_epoch.session_id = session.id)
          ) THEN 'v2'
          ELSE 'legacy'
        END
      `)
    })
  },
} satisfies DatabaseMigration.Migration
