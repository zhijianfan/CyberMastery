import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260820062449_burly_gressill",
  up() {
    return Effect.void
  },
} satisfies DatabaseMigration.Migration
