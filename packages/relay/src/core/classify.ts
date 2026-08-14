export type DocKind = "requirements" | "architecture" | "plan" | "notes"

export interface DocumentChunk {
  kind: DocKind
  title: string
  body: string
}

const KIND_PATTERNS: readonly [DocKind, RegExp][] = [
  ["requirements", /requirements?|FR-|NFR-|acceptance criteria|user stories/i],
  ["architecture", /architecture|components?|modules?|data model|tables?|diagram|system context/i],
  ["plan", /implementation plan|phase|track|ticket|epic|milestone|delivery|wave/i],
]

const HEADING = /^#{1,2}\s+/

const SAMPLE_LINES = 10

const KIND_TITLES: Record<DocKind, string> = {
  requirements: "Requirements",
  architecture: "Architecture",
  plan: "Implementation Plan",
  notes: "Notes",
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, "gi")) ?? []).length
}

export function classifyDocument(text: string): DocKind {
  let best: DocKind = "notes"
  let bestScore = 0
  for (const [kind, pattern] of KIND_PATTERNS) {
    const score = countMatches(text, pattern)
    if (score > bestScore) {
      best = kind
      bestScore = score
    }
  }
  return best
}

export function extractDocuments(text: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let heading: string | null = null
  let content: string[] = []
  const flush = () => {
    const body = content.join("\n").trim()
    if (body) {
      const sample = heading === null ? body : `${heading}\n${body.split(/\r?\n/).slice(0, SAMPLE_LINES).join("\n")}`
      const kind = classifyDocument(sample)
      chunks.push({ kind, title: heading ?? titleFor(kind, ""), body })
    }
    content = []
    heading = null
  }
  for (const line of text.split(/\r?\n/)) {
    if (HEADING.test(line)) {
      flush()
      heading = line.replace(HEADING, "").trim()
    } else {
      content.push(line)
    }
  }
  flush()
  return chunks
}

export function titleFor(kind: DocKind, fallback: string): string {
  if (kind === "notes") return fallback.trim() || KIND_TITLES.notes
  return KIND_TITLES[kind]
}
