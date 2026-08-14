import type { Dirent } from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { writeLedgerRecord } from "./docwriter.js"
import { DEFAULT_ROOTS, isAllowedExtension, resolveContained } from "./paths.js"

export interface OrganizeResult {
  processed: string[]
  archived: string[]
  skipped: string[]
}

const INBOX_EXTENSION = ".md"

export async function organizeInbox(opts: {
  baseDir: string
  inboxDir?: string
  archiveDir?: string
}): Promise<OrganizeResult> {
  const inbox = resolveContained(opts.baseDir, opts.inboxDir ?? DEFAULT_ROOTS.inbox)
  const archive = resolveContained(opts.baseDir, opts.archiveDir ?? DEFAULT_ROOTS.archive)
  const result: OrganizeResult = { processed: [], archived: [], skipped: [] }
  let entries: Dirent[]
  try {
    entries = await fs.readdir(inbox, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
    throw error
  }
  await fs.mkdir(archive, { recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const source = path.join(inbox, entry.name)
    if (!entry.name.toLowerCase().endsWith(INBOX_EXTENSION) || !isAllowedExtension(entry.name)) {
      result.skipped.push(entry.name)
      continue
    }
    const base = entry.name.slice(0, -INBOX_EXTENSION.length)
    const target = resolveContained(archive, `${base}-${Date.now()}.md`)
    await fs.rename(source, target)
    result.processed.push(entry.name)
    result.archived.push(target)
  }
  return result
}

export async function appendLedger(opts: {
  baseDir: string
  record: Record<string, unknown>
}): Promise<void> {
  const ledger = resolveContained(opts.baseDir, DEFAULT_ROOTS.ledger)
  await writeLedgerRecord(ledger, opts.record)
}
