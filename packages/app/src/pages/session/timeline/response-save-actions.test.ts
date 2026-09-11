import { expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { responseSavePartID } from "./response-save-actions"

test("response save actions belong only to the last visible text part", () => {
  const parts = [
    { id: "text-first", type: "text", text: "first" },
    { id: "text-ignored", type: "text", text: "ignored", ignored: true },
    { id: "tool", type: "tool" },
    { id: "text-last", type: "text", text: "last" },
  ] as Part[]

  expect(responseSavePartID(parts)).toBe("text-last")
})
