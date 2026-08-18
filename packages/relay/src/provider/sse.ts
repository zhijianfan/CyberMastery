// Minimal Server-Sent Events parser for the ChatGPT backend-api stream.
// Events are separated by blank lines; multi-line `data:` fields are joined
// with newlines per the SSE spec. `event:`/`id:` fields are ignored — the
// conversation stream only carries data.

export async function* parseEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = dataFromBlock(block)
        if (data !== undefined) yield data
        boundary = buffer.indexOf("\n\n")
      }
    }
    const tail = buffer.trim()
    if (tail) {
      const data = dataFromBlock(tail)
      if (data !== undefined) yield data
    }
  } finally {
    reader.releaseLock()
  }
}

function dataFromBlock(block: string): string | undefined {
  const lines = block.split("\n")
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
  }
  return dataLines.length > 0 ? dataLines.join("\n") : undefined
}
