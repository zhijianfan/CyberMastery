export interface ChatProvider {
  readonly id: "chatgpt" | "claude" | string
  prefersApi(): boolean
  openSession(): Promise<ChatSession>
}

export interface ChatSession {
  readonly conversationId: string
  readonly url: string
  send(prompt: string): AsyncIterable<string>
  captureTurn(opts?: CaptureOptions): Promise<Turn>
  dispose(): Promise<void>
}

export interface CaptureOptions {
  timeoutMs: number
  quietMs: number
}

export interface DownloadableFile {
  name: string
  url: string
}

// A single captured response: the plain-text body plus every downloadable
// file it references, stored together as one payload.
export interface ChatResponsePayload {
  text: string
  files: DownloadableFile[]
}

export interface Turn extends ChatResponsePayload {
  role: "user" | "assistant"
  startedAt: number
  finishedAt: number | null
}

export interface InboxFile {
  source: "chatgpt" | "claude" | "api" | "manual"
  conversationId: string
  turn: number
  capturedAt: string
  complete: boolean
  body: string
}

export function renderInboxFile(file: InboxFile): string {
  const lines = [
    "---",
    `source: ${file.source}`,
    `conversationId: ${file.conversationId}`,
    `turn: ${file.turn}`,
    `capturedAt: ${file.capturedAt}`,
    `complete: ${file.complete}`,
    "---",
    "",
    `# Turn ${file.turn}`,
  ]
  if (file.body.trim()) lines.push("", file.body)
  return lines.join("\n") + "\n"
}
