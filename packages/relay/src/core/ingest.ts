export interface TranscriptMeta {
  source: "chatgpt" | "claude" | "api" | "manual"
  conversationId: string
  turn: number
  capturedAt: string
  complete: boolean
}

export interface Transcript {
  meta: TranscriptMeta
  body: string
}

const SOURCES = ["chatgpt", "claude", "api", "manual"] as const

const TURN_HEADING = /^#{1,2}\s+Turn\s+\d+/i

const FENCED_BLOCK = /```[\s\S]*?```/g

const INLINE_CODE = /`([^`]*)`/g

function isSource(value: string): value is TranscriptMeta["source"] {
  return (SOURCES as readonly string[]).includes(value)
}

function parseFrontmatter(text: string): { fields: Map<string, string>; body: string } {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return { fields: new Map(), body: text }
  let end = -1
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() === "---") {
      end = index
      break
    }
  }
  if (end === -1) return { fields: new Map(), body: text }
  const fields = new Map<string, string>()
  for (let index = 1; index < end; index++) {
    const match = /^\s*([^:#\s][^:]*?)\s*:\s*(.*)$/.exec(lines[index] ?? "")
    if (match) fields.set(match[1]!.trim().toLowerCase(), match[2]!.trim())
  }
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "")
  return { fields, body }
}

export function parseTranscript(text: string): Transcript {
  const { fields, body } = parseFrontmatter(text)
  const source = fields.get("source")
  const turn = Number(fields.get("turn"))
  const capturedAt = fields.get("capturedat")
  const complete = fields.get("complete")
  return {
    meta: {
      source: source && isSource(source) ? source : "manual",
      conversationId: fields.get("conversationid") ?? "unknown",
      turn: Number.isInteger(turn) && turn > 0 ? turn : 1,
      capturedAt: capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? capturedAt : new Date().toISOString(),
      complete: complete === undefined ? true : complete !== "false",
    },
    body,
  }
}

export function splitTurns(body: string): { heading: string; content: string }[] {
  const chunks: { heading: string; content: string }[] = []
  let heading = ""
  let content: string[] = []
  const flush = () => {
    const text = content.join("\n").trim()
    if (text) chunks.push({ heading, content: text })
    content = []
  }
  for (const line of body.split(/\r?\n/)) {
    if (TURN_HEADING.test(line.trim())) {
      flush()
      heading = line.trim()
    } else {
      content.push(line)
    }
  }
  flush()
  return chunks
}

export function markdownToText(markdown: string): string {
  return markdown.replace(FENCED_BLOCK, "").replace(INLINE_CODE, "$1")
}
