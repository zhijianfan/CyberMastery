import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260922100434_canvas-tab-archive-order",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`canvas_tab_archive_created_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`canvas_tab_archive_order_idx\` ON \`canvas_tab\` (\`workspace_id\`,\`kind\`,"time_created" desc,"id" desc);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
