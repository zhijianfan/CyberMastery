import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { ChatProxyService } from "../src/chat-proxy"

test("model controls require Settings connection without starting the browser worker", async () => {
  expect(await ChatProxyService.status("disconnected-controls-user")).toMatchObject({ status: "disconnected" })
  await expect(
    ChatProxyService.options("disconnected-controls-user", "wrk_controls", "relay-a", "tab-a"),
  ).rejects.toThrow("Connect ChatGPT in Settings")
  await expect(
    ChatProxyService.configure("disconnected-controls-user", "wrk_controls", "relay-a", "tab-a", "gpt-5", "high"),
  ).rejects.toThrow("Connect ChatGPT in Settings")
  expect(await ChatProxyService.status("disconnected-controls-user")).toMatchObject({ status: "disconnected" })
})

test("server-owned cleanup is a no-op while the browser worker is stopped", async () => {
  await expect(ChatProxyService.close("disconnected-cleanup-user", "wrk_cleanup", "relay-a")).resolves.toBeUndefined()
  await expect(ChatProxyService.closeWorkspace("disconnected-cleanup-user", "wrk_cleanup")).resolves.toBeUndefined()
  expect(await ChatProxyService.status("disconnected-cleanup-user")).toMatchObject({ status: "disconnected" })
})

test("server-owned cleanup reconnects to a configured persistent worker", async () => {
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\opencode-chat-proxy-service-${randomUUID()}`
      : path.join(tmpdir(), `opencode-chat-proxy-service-${randomUUID()}.sock`)
  const calls: unknown[] = []
  const sockets = new Set<import("node:net").Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    createInterface({ input: socket }).on("line", (line) => {
      const request = JSON.parse(line)
      calls.push(request)
      socket.write(`${JSON.stringify({ id: request.id, ok: true, value: {} })}\n`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, resolve)
  })
  const previous = process.env.OPENCODE_CHAT_PROXY_SOCKET
  process.env.OPENCODE_CHAT_PROXY_SOCKET = endpoint
  try {
    await ChatProxyService.close("cleanup-user", "wrk_cleanup", "relay-a")
    await ChatProxyService.closeWorkspace("cleanup-user", "wrk_cleanup")
    expect(calls).toEqual([
      expect.objectContaining({
        method: "close",
        user: "cleanup-user",
        workspaceID: "wrk_cleanup",
        blockID: "relay-a",
      }),
      expect.objectContaining({ method: "closeWorkspace", user: "cleanup-user", workspaceID: "wrk_cleanup" }),
    ])
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CHAT_PROXY_SOCKET
    else process.env.OPENCODE_CHAT_PROXY_SOCKET = previous
    sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
