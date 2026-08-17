// Reads the full stdin text when it is piped (non-TTY). Returns undefined
// for interactive terminals so callers can keep the TTY open.
export async function stdinText(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  let body = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) {
    body += chunk
  }
  return body
}
