import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { FunctionalityInstance } from "@opencode-ai/core/workspace/functionality-instance"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, WorkspaceService.node, FunctionalityInstance.node])),
)

const config = {
  version: 1,
  directoryBinding: { mode: "workspace-primary" },
  sessionBinding: null,
}

describe("functionality instance repository", () => {
  it.effect("getOrCreate is idempotent and starts at revision 0", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-idem" })

      const firstResult = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })
      expect(firstResult.type).toBe("created")
      const secondResult = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: { ...config, directoryBinding: { mode: "fixed", directory: "/repo" } },
      })
      expect(secondResult.type).toBe("existing")
      const first = firstResult.instance
      const second = secondResult.instance

      // The first caller's configuration wins; the instance is not replaced.
      expect(second.id).toBe(first.id)
      expect(second.revision).toBe(0)
      expect(second.configuration).toEqual(config)
    }),
  )

  it.effect("get hides tombstoned instances; getOrCreate returns the tombstoned row unchanged", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-tombstone" })
      const { instance: created } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })

      const result = yield* instances.tombstone({ instanceID: created.id, expectedRevision: created.revision })
      expect(result.type).toBe("tombstoned")
      expect(yield* instances.get(info.id, "block-a", "builtin:master-agent")).toBeUndefined()

      const { instance: existing } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })
      expect(existing.id).toBe(created.id)
      expect(existing.deletedAt).not.toBeNull()
    }),
  )

  it.effect("compare-and-swap bumps the revision and replaces the configuration", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-cas" })
      const { instance: created } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })

      const next = { ...config, directoryBinding: { mode: "fixed", directory: "/srv/agent" } }
      const result = yield* instances.compareAndSwapConfiguration({
        instanceID: created.id,
        expectedRevision: created.revision,
        nextConfiguration: next,
      })
      expect(result.type).toBe("updated")
      if (result.type !== "updated") return
      expect(result.instance.revision).toBe(created.revision + 1)
      expect(result.instance.configuration).toEqual(next)
      expect(result.instance.deletedAt).toBeNull()

      const loaded = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      expect(loaded?.revision).toBe(created.revision + 1)
      expect(loaded?.configuration).toEqual(next)
    }),
  )

  it.effect("stale CAS reports conflict with the current instance and changes nothing", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-stale" })
      const { instance: created } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })
      yield* instances.compareAndSwapConfiguration({
        instanceID: created.id,
        expectedRevision: created.revision,
        nextConfiguration: { ...config, directoryBinding: { mode: "fixed", directory: "/a" } },
      })

      const stale = yield* instances.compareAndSwapConfiguration({
        instanceID: created.id,
        expectedRevision: created.revision,
        nextConfiguration: { ...config, directoryBinding: { mode: "fixed", directory: "/b" } },
      })
      expect(stale.type).toBe("conflict")
      if (stale.type !== "conflict") return
      // The conflict carries the winner's live row, not the stale one.
      expect(stale.current.revision).toBe(created.revision + 1)
      expect(stale.current.configuration).toEqual({ ...config, directoryBinding: { mode: "fixed", directory: "/a" } })
      expect(stale.current.deletedAt).toBeNull()
    }),
  )

  it.effect("CAS on a missing instance fails with InstanceNotFoundError", () =>
    Effect.gen(function* () {
      const instances = yield* FunctionalityInstance.Service
      const error = yield* instances
        .compareAndSwapConfiguration({
          instanceID: "missing-instance",
          expectedRevision: 0,
          nextConfiguration: config,
        })
        .pipe(Effect.flip)
      expect(error._tag).toBe("FunctionalityInstance.InstanceNotFoundError")
    }),
  )

  it.effect("tombstone is revision-guarded and refuses stale revisions", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-guard" })
      const { instance: created } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })
      yield* instances.compareAndSwapConfiguration({
        instanceID: created.id,
        expectedRevision: created.revision,
        nextConfiguration: { ...config, directoryBinding: { mode: "fixed", directory: "/a" } },
      })

      const stale = yield* instances.tombstone({ instanceID: created.id, expectedRevision: created.revision })
      expect(stale.type).toBe("conflict")
      if (stale.type !== "conflict") return
      expect(stale.current.revision).toBe(created.revision + 1)
      // Still live: a stale tombstone cannot hide a concurrent transition.
      expect(yield* instances.get(info.id, "block-a", "builtin:master-agent")).toBeDefined()

      const fresh = yield* instances.tombstone({ instanceID: created.id, expectedRevision: stale.current.revision })
      expect(fresh.type).toBe("tombstoned")
      expect(yield* instances.get(info.id, "block-a", "builtin:master-agent")).toBeUndefined()
    }),
  )

  it.effect("tombstone on a missing instance fails with InstanceNotFoundError", () =>
    Effect.gen(function* () {
      const instances = yield* FunctionalityInstance.Service
      const error = yield* instances.tombstone({ instanceID: "missing-instance", expectedRevision: 0 }).pipe(Effect.flip)
      expect(error._tag).toBe("FunctionalityInstance.InstanceNotFoundError")
    }),
  )

  it.effect("CAS resurrects a tombstoned instance", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-resurrect" })
      const { instance: created } = yield* instances.getOrCreate({
        workspaceID: info.id,
        blockID: "block-a",
        functionalityID: "builtin:master-agent",
        configuration: config,
      })
      yield* instances.tombstone({ instanceID: created.id, expectedRevision: created.revision })

      const result = yield* instances.compareAndSwapConfiguration({
        instanceID: created.id,
        expectedRevision: created.revision,
        nextConfiguration: { ...config, directoryBinding: { mode: "fixed", directory: "/again" } },
      })
      expect(result.type).toBe("updated")
      if (result.type !== "updated") return
      expect(result.instance.deletedAt).toBeNull()
      expect(result.instance.revision).toBe(created.revision + 1)
      const loaded = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      expect(loaded?.id).toBe(created.id)
      expect(loaded?.configuration).toEqual({ ...config, directoryBinding: { mode: "fixed", directory: "/again" } })
    }),
  )

  it.effect("concurrent getOrCreate converges on a single instance", () =>
    Effect.gen(function* () {
      const workspace = yield* WorkspaceService.Service
      const instances = yield* FunctionalityInstance.Service
      const info = yield* workspace.create({ name: "fi-race" })

      const fiberA = yield* instances
        .getOrCreate({
          workspaceID: info.id,
          blockID: "block-a",
          functionalityID: "builtin:master-agent",
          configuration: config,
        })
        .pipe(Effect.forkChild)
      const fiberB = yield* instances
        .getOrCreate({
          workspaceID: info.id,
          blockID: "block-a",
          functionalityID: "builtin:master-agent",
          configuration: { ...config, directoryBinding: { mode: "fixed", directory: "/b" } },
        })
        .pipe(Effect.forkChild)
      const [a, b] = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)])

      expect(a.instance.id).toBe(b.instance.id)
      expect(a.instance.revision).toBe(0)
      const loaded = yield* instances.get(info.id, "block-a", "builtin:master-agent")
      expect(loaded?.id).toBe(a.instance.id)
    }),
  )
})
