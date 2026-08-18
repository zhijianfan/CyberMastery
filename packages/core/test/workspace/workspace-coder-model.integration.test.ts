import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node])))

describe("workspace coderModel integration", () => {
  it.effect("create exposes coderModel as unset and the row stays null", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-create" })
      expect(info.coderModel).toBeUndefined()
      // Fresh read from the row: still unset.
      const fetched = yield* workspace.get(info.id)
      expect(fetched?.coderModel).toBeUndefined()
    }),
  )

  it.effect("patch persists a concrete selection across get and list", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-set" })
      const updated = yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      expect(updated.coderModel).toBe("anthropic/claude-haiku")

      // Reload from the row.
      const fetched = yield* workspace.get(info.id)
      expect(fetched?.coderModel).toBe("anthropic/claude-haiku")

      // Full info projection through list.
      const listed = yield* workspace.list()
      expect(listed.find((entry) => entry.id === info.id)?.coderModel).toBe("anthropic/claude-haiku")
    }),
  )

  it.effect("explicit null clears the selection", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-null" })
      yield* workspace.update(info.id, { coderModel: "openai/gpt-4o-mini" })
      const cleared = yield* workspace.update(info.id, { coderModel: null })
      expect(cleared.coderModel).toBeUndefined()
      const fetched = yield* workspace.get(info.id)
      expect(fetched?.coderModel).toBeUndefined()
    }),
  )

  it.effect("empty string clears the selection (repository convention)", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-empty" })
      yield* workspace.update(info.id, { coderModel: "openai/gpt-4o-mini" })
      const cleared = yield* workspace.update(info.id, { coderModel: "" })
      expect(cleared.coderModel).toBeUndefined()
    }),
  )

  it.effect("omitted patch leaves coderModel unchanged", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-omit" })
      yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      const renamed = yield* workspace.update(info.id, { name: "cm-omit-renamed" })
      expect(renamed.name).toBe("cm-omit-renamed")
      expect(renamed.coderModel).toBe("anthropic/claude-haiku")
    }),
  )

  it.effect("unrelated fields survive coderModel set and clear", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-fields" })
      yield* workspace.update(info.id, {
        name: "cm-fields-renamed",
        directories: ["/tmp/cm"],
        pluginIDs: ["p1"],
        skillIDs: ["s1"],
        operatingAgent: "operator",
        model: "primary/model",
      })
      const set = yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      expect(set.name).toBe("cm-fields-renamed")
      expect(set.directories).toEqual(["/tmp/cm"])
      expect(set.pluginIDs).toEqual(["p1"])
      expect(set.skillIDs).toEqual(["s1"])
      expect(set.operatingAgent).toBe("operator")
      expect(set.model).toBe("primary/model")
      expect(set.coderModel).toBe("anthropic/claude-haiku")

      const cleared = yield* workspace.update(info.id, { coderModel: null })
      expect(cleared.name).toBe("cm-fields-renamed")
      expect(cleared.operatingAgent).toBe("operator")
      expect(cleared.model).toBe("primary/model")
      expect(cleared.coderModel).toBeUndefined()
    }),
  )

  it.effect("duplicate carries the workspace-wide coderModel", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const info = yield* workspace.create({ name: "cm-dupe" })
      yield* workspace.update(info.id, { coderModel: "anthropic/claude-haiku" })
      const copy = yield* workspace.duplicate(info.id)
      expect(copy.name).toBe("cm-dupe (copy)")
      expect(copy.coderModel).toBe("anthropic/claude-haiku")
      const fetched = yield* workspace.get(copy.id)
      expect(fetched?.coderModel).toBe("anthropic/claude-haiku")
    }),
  )
})
