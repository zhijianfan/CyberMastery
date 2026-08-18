// Shared types for the account-authenticated chat providers. A provider
// authenticates a chat account via OAuth (no browser crawler) and sends
// messages through the platform's API; the relay consumes the captured reply.

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

export interface ChatSession {
  readonly conversationId: string | undefined
  readonly parentMessageId: string | undefined
  readonly url: string
  /**
   * Streams the assistant reply deltas. The iteration ends when the reply is
   * complete (or the stream stalls past the timeout); hard failures throw.
   */
  send(prompt: string): AsyncIterable<string>
  /** The most recently captured turn, if any. */
  turn(): Turn | undefined
  dispose(): Promise<void>
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
