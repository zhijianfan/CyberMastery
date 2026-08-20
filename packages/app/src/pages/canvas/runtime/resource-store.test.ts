import { describe, expect, test } from "bun:test"

import { createRuntimeResourceStore } from "./resource-store"

import type { RuntimeProjectionPatch } from "./contracts"

const asPatch = (patch: Record<string, unknown>) => {
  return patch as RuntimeProjectionPatch
}

describe("createRuntimeResourceStore", () => {
  test("replace/merge/append/remove patches are applied correctly", () => {
    const store = createRuntimeResourceStore()

    store.upsert("replace", { from: "seed" }, 1)
    store.patch(
      "replace",
      asPatch({
        op: "replace",
        revision: 2,
        value: { from: "next" },
      }),
    )
    expect(store.get("replace").value).toEqual({ from: "next" })
    expect(store.get("replace").revision).toBe(2)

    store.upsert("merge", { one: 1, nested: { a: 1 } }, 1)
    store.patch(
      "merge",
      asPatch({
        op: "merge",
        revision: 2,
        value: { two: 2 },
      }),
    )
    expect(store.get("merge").value).toEqual({ one: 1, nested: { a: 1 }, two: 2 })

    store.upsert("append", [1, 2], 1)
    store.patch(
      "append",
      asPatch({
        op: "append",
        revision: 2,
        value: [3, 4],
      }),
    )
    expect(store.get("append").value).toEqual([1, 2, 3, 4])

    store.upsert("remove", { keep: "ok", removeMe: 1 }, 1)
    store.patch(
      "remove",
      asPatch({
        op: "remove",
        revision: 2,
        path: "removeMe",
      }),
    )
    expect(store.get("remove").value).toEqual({ keep: "ok" })
  })

  test("patch revision less than or equal to stored revision is ignored", () => {
    const store = createRuntimeResourceStore()
    store.upsert("rev", { value: 1 }, 5)

    store.patch(
      "rev",
      asPatch({
        op: "replace",
        revision: 5,
        value: { value: 2 },
      }),
    )
    expect(store.get("rev").value).toEqual({ value: 1 })

    store.patch(
      "rev",
      asPatch({
        op: "replace",
        revision: 4,
        value: { value: 3 },
      }),
    )
    expect(store.get("rev").value).toEqual({ value: 1 })

    store.patch(
      "rev",
      asPatch({
        op: "replace",
        revision: 6,
        value: { value: 4 },
      }),
    )
    expect(store.get("rev").value).toEqual({ value: 4 })
  })

  test("invalidation is coalesced into one callback per microtask burst", async () => {
    const store = createRuntimeResourceStore()
    let calls = 0

    store.onInvalidate("burst", () => {
      calls += 1
    })

    store.invalidate("burst")
    store.invalidate("burst")
    store.invalidate("burst")

    await Promise.resolve()

    expect(calls).toBe(1)
  })

  test("release to zero removes runtime entry and dispose clears all entries", async () => {
    const store = createRuntimeResourceStore()
    store.upsert("retain", { value: 1 }, 1)
    store.retain("retain")
    store.retain("retain")
    expect(store.get("retain").value).toEqual({ value: 1 })

    store.release("retain")
    store.release("retain")

    expect(store.get("retain").status).toBe("unavailable")

    store.retain("still-present")
    expect(store.get("still-present").status).toBe("unavailable")
    store.retain("still-present")
    store.release("still-present")
    store.release("still-present")

    store.dispose()
    expect(store.get("still-present").status).toBe("unavailable")
  })
})
