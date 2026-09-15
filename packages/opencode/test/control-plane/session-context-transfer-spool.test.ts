import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  SessionContextTransferSpool,
  SyncTransferConflict,
  canonical,
  digest,
} from "../../src/control-plane/session-context-transfer-spool"

const record = {
  kind: "event" as const,
  aggregateID: "session-1",
  sourceSeq: 0,
  sequence: 0,
  identity: "event-1",
  value: {
    id: "event-1",
    aggregateID: "session-1",
    seq: 0,
    type: "session.created",
    data: {},
  },
}

describe("session context transfer spool", () => {
  test("encrypts records and makes equal begin and append retries no-ops", async () => {
    await using tmp = await tmpdir()
    const spool = await SessionContextTransferSpool.make({ root: path.join(tmp.path, "spool") })
    const input = {
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-1",
      sourceSnapshotToken: "snapshot-1",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: Date.now() + 60_000,
    }
    const [first, concurrentBegin] = await Promise.all([spool.begin(input), spool.begin(input)])
    expect(concurrentBegin).toEqual(first)
    expect(await spool.begin(input)).toEqual(first)

    const page = { records: [record] }
    const pageHash = digest(canonical(page))
    const appended = await Promise.all([
      spool.append({ handle: first.handle, pageIndex: 0, pageHash, page }),
      spool.append({ handle: first.handle, pageIndex: 0, pageHash, page }),
    ])
    expect(appended).toEqual([{ nextPageIndex: 1 }, { nextPageIndex: 1 }])

    const files = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: path.join(tmp.path, "spool"), absolute: true }))
    expect(files).toHaveLength(1)
    expect(await Bun.file(files[0]!).text()).not.toContain("session.created")
    expect(await Bun.file(files[0]!).text()).not.toContain("session-1")

    await expect(
      spool.append({
        handle: first.handle,
        pageIndex: 0,
        pageHash: digest("conflict"),
        page,
      }),
    ).rejects.toBeInstanceOf(SyncTransferConflict)
  })

  test("reassembles canonical base64 chunks and keeps a completion receipt", async () => {
    await using tmp = await tmpdir()
    const spool = await SessionContextTransferSpool.make({ root: path.join(tmp.path, "spool") })
    const value = record.value
    const bytes = Buffer.from(canonical(value))
    const begin = await spool.begin({
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-1",
      sourceSnapshotToken: "snapshot-1",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: Date.now() + 60_000,
    })
    const parts = [bytes.subarray(0, 8), bytes.subarray(8)]

    for (const [pageIndex, data] of parts.entries()) {
      const page = {
        records: [
          {
            kind: "chunk" as const,
            recordKind: "event" as const,
            aggregateID: "session-1",
            sourceSeq: 0,
            sequence: 0,
            identity: "event-1",
            chunkIndex: pageIndex,
            chunkCount: parts.length,
            byteLength: bytes.byteLength,
            contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            data: data.toString("base64"),
          },
        ],
      }
      await spool.append({
        handle: begin.handle,
        pageIndex,
        pageHash: digest(canonical(page)),
        page,
      })
    }

    const ready = await spool.finalize({
      handle: begin.handle,
      expectedPageCount: 2,
      manifestDigest: digest(canonical([])),
    })
    expect(ready.status).toBe("ready")
    if (ready.status !== "ready") throw new Error("expected ready transfer")
    expect(ready.bundles[0]?.events).toEqual([value])
    await spool.complete(begin.handle, ready.receipt)
    expect(
      await spool.finalize({
        handle: begin.handle,
        expectedPageCount: 2,
        manifestDigest: digest(canonical([])),
      }),
    ).toEqual({ status: "complete", receipt: ready.receipt })
  })

  test("sweeps orphaned payloads on startup and enforces the active count", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "spool")
    await Bun.write(path.join(root, "orphan"), "private")
    const spool = await SessionContextTransferSpool.make({ root, maxActiveTransfers: 1 })
    expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root }))).toEqual([])
    await spool.begin({
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-1",
      sourceSnapshotToken: "snapshot-1",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: Date.now() + 60_000,
    })
    await expect(
      spool.begin({
        workspaceID: "workspace-1",
        directory: tmp.path,
        clientTransferID: "client-2",
        sourceSnapshotToken: "snapshot-2",
        highWater: { "session-2": 0 },
        manifestDigest: digest(canonical([])),
        expiresAt: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({ _tag: "SyncTransferBusy" })
  })

  test("expires idle transfers and deletes oversized partial spools", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "spool")
    let now = 0
    const spool = await SessionContextTransferSpool.make({ root, now: () => now })
    const begin = await spool.begin({
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-1",
      sourceSnapshotToken: "snapshot-1",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: 60 * 60 * 1000,
    })
    now = 5 * 60 * 1000 + 1
    const page = { records: [record] }
    await expect(
      spool.append({ handle: begin.handle, pageIndex: 0, pageHash: digest(canonical(page)), page }),
    ).rejects.toMatchObject({ _tag: "SyncTransferExpired" })
    expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root }))).toEqual([])

    const limited = await SessionContextTransferSpool.make({ root, maxTransferBytes: 32 })
    const next = await limited.begin({
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-2",
      sourceSnapshotToken: "snapshot-2",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: Date.now() + 60_000,
    })
    await expect(
      limited.append({ handle: next.handle, pageIndex: 0, pageHash: digest(canonical(page)), page }),
    ).rejects.toMatchObject({ _tag: "SyncTransferTooLarge" })
    expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root }))).toEqual([])
  })

  test("rejects authenticated-spool tampering and deletes the payload", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "spool")
    const spool = await SessionContextTransferSpool.make({ root })
    const begin = await spool.begin({
      workspaceID: "workspace-1",
      directory: tmp.path,
      clientTransferID: "client-1",
      sourceSnapshotToken: "snapshot-1",
      highWater: { "session-1": 0 },
      manifestDigest: digest(canonical([])),
      expiresAt: Date.now() + 60_000,
    })
    const page = { records: [record] }
    await spool.append({ handle: begin.handle, pageIndex: 0, pageHash: digest(canonical(page)), page })
    const [file] = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root, absolute: true }))
    const encrypted = JSON.parse(await Bun.file(file!).text()) as { nonce: string; tag: string; data: string }
    encrypted.data = `${encrypted.data[0] === "A" ? "B" : "A"}${encrypted.data.slice(1)}`
    await Bun.write(file!, JSON.stringify(encrypted))
    await expect(
      spool.finalize({ handle: begin.handle, expectedPageCount: 1, manifestDigest: digest(canonical([])) }),
    ).rejects.toBeInstanceOf(SyncTransferConflict)
    expect(await Array.fromAsync(new Bun.Glob("*").scan({ cwd: root }))).toEqual([])
  })
})
