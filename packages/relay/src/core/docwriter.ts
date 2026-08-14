import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { DocKind } from "./classify.js"
import type { TranscriptMeta } from "./ingest.js"
import { DEFAULT_ROOTS, isAllowedExtension, resolveContained } from "./paths.js"

export interface Provenance {
  source: TranscriptMeta["source"]
  conversationId: string
  capturedAt: string
  rawTranscript: string
}

export interface DocOutput {
  kind: DocKind
  title: string
  body: string
}

const KIND_FILES: Record<DocKind, string> = {
  requirements: "requirements.md",
  architecture: "architecture.md",
  plan: "implementation-plan.md",
  notes: "notes.md",
}

export function renderDocument(doc: DocOutput, provenance: Provenance): string {
  const lines = [
    "---",
    `source: ${provenance.source}`,
    `conversationId: ${provenance.conversationId}`,
    `capturedAt: ${provenance.capturedAt}`,
    `rawTranscript: ${provenance.rawTranscript}`,
    "---",
    "",
    `# ${doc.title}`,
  ]
  if (doc.body) lines.push("", doc.body)
  return lines.join("\n") + "\n"
}

export function documentPath(domain: string, kind: DocKind): string {
  return `${DEFAULT_ROOTS.specs}/${domain}/${KIND_FILES[kind]}`
}

export async function writeDocument(
  baseDir: string,
  domain: string,
  doc: DocOutput,
  provenance: Provenance,
): Promise<string> {
  const relative = documentPath(domain, doc.kind)
  if (!isAllowedExtension(relative)) throw new Error(`extension not allowed: ${relative}`)
  const target = resolveContained(baseDir, relative)
  const content = renderDocument(doc, provenance)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, "utf8")
  return target
}

export async function writeLedgerRecord(ledgerPath: string, record: Record<string, unknown>): Promise<void> {
  if (!isAllowedExtension(ledgerPath)) throw new Error(`extension not allowed: ${ledgerPath}`)
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
  await fs.appendFile(ledgerPath, JSON.stringify(record) + "\n", "utf8")
}
