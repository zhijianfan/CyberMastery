import { expect, test } from "bun:test"
import { Blob } from "node:buffer"
import { createDraftStore } from "./draft-store"

function store(value: unknown) {
  const id = crypto.randomUUID()
  return {
    id,
    drafts: createDraftStore({
      get: async () => JSON.stringify({ revision: 7, draft: { text: "keep", blob: { id, url: "blob:expired" } } }),
      set: async () => {},
      remove: async () => {},
      putBlob: async () => id,
      // Durable storage may contain corrupt values despite the driver's typed contract.
      getBlob: async () => value as Blob | null,
    }),
  }
}

test.each([
  null,
  { size: 5, type: "text/plain" },
  { size: 5, type: "text/plain", arrayBuffer: async () => new ArrayBuffer(5), slice: () => new Blob([]) },
])("discards a persisted URL when blob recovery returns %j", async (value) => {
  const storage = store(value)
  expect(JSON.parse((await storage.drafts.getItem("draft"))!)).toEqual({
    revision: 7,
    draft: { text: "keep", blob: { id: storage.id } },
  })
})

test.each([
  ["DOM Blob", () => new window.Blob(["hello 世界"], { type: "text/plain" })],
  ["DOM File", () => new window.File(["hello 世界"], "notes.txt", { type: "text/plain" })],
  ["native Blob", () => new Blob(["hello 世界"], { type: "text/plain" })],
] as const)("rehydrates valid %s bytes", async (_name, create) => {
  const storage = store(create())
  const document = JSON.parse((await storage.drafts.getItem("draft"))!)
  expect(document.revision).toBe(7)
  expect(document.draft.blob.id).toBe(storage.id)
  expect(document.draft.blob.url).toStartWith("blob:")
  expect(document.draft.blob.url).not.toBe("blob:expired")
  expect(await Bun.fetch(document.draft.blob.url).then((response) => response.text())).toBe("hello 世界")
})

test("propagates a blob storage read failure", async () => {
  const failure = new Error("storage unavailable")
  const storage = createDraftStore({
    get: async () => JSON.stringify({ draft: { blob: { id: "blob-1", url: "blob:expired" } }, revision: 7 }),
    set: async () => {},
    remove: async () => {},
    putBlob: async () => "blob-1",
    getBlob: async () => {
      throw failure
    },
  })
  await expect(storage.getItem("draft")).rejects.toBe(failure)
})
