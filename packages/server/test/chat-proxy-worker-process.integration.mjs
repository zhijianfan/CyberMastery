import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import readline from "node:readline"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("worker line protocol reports status and shuts down when stdin closes", async () => {
  const worker = spawn(process.execPath, [fileURLToPath(new URL("../src/chat-proxy-worker.mjs", import.meta.url))], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output = readline.createInterface({ input: worker.stdout })
  const reply = new Promise((resolve) => output.once("line", (line) => resolve(JSON.parse(line))))

  worker.stdin.write(`${JSON.stringify({ id: "request-1", method: "status", user: "process-user" })}\n`)
  assert.deepEqual(await reply, {
    id: "request-1",
    ok: true,
    value: { id: "chatgpt", name: "ChatGPT", status: "disconnected" },
  })
  worker.stdin.end()

  const exitCode = await new Promise((resolve, reject) => {
    worker.once("error", reject)
    worker.once("exit", resolve)
  })
  assert.equal(exitCode, 0)
})

test("worker socket accepts replacement backend connections until supervisor shutdown", async (context) => {
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\opencode-chat-proxy-process-${randomUUID()}`
      : path.join(tmpdir(), `opencode-chat-proxy-process-${randomUUID()}.sock`)
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/chat-proxy-worker.mjs", import.meta.url)), "--socket", endpoint],
    { stdio: ["ignore", "ignore", "pipe"] },
  )
  context.after(() => {
    if (worker.exitCode === null) worker.kill()
  })
  await waitForServer(endpoint)

  assert.equal((await rawRequest(endpoint, '{"id":"broken"')).ok, false)
  assert.equal(worker.exitCode, null)

  assert.deepEqual(await request(endpoint, "request-1"), {
    id: "request-1",
    ok: true,
    value: { id: "chatgpt", name: "ChatGPT", status: "disconnected" },
  })
  assert.deepEqual(await request(endpoint, "request-2"), {
    id: "request-2",
    ok: true,
    value: { id: "chatgpt", name: "ChatGPT", status: "disconnected" },
  })
  assert.deepEqual(await request(endpoint, "shutdown", "shutdown"), {
    id: "shutdown",
    ok: true,
    value: {},
  })

  worker.kill()
  await new Promise((resolve, reject) => {
    worker.once("error", reject)
    worker.once("exit", resolve)
  })
})

function request(endpoint, id, method = "status") {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    const output = readline.createInterface({ input: socket })
    socket.once("error", reject)
    output.once("line", (line) => {
      socket.end()
      resolve(JSON.parse(line))
    })
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, method, user: "process-user" })}\n`))
  })
}

function rawRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    const output = readline.createInterface({ input: socket })
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error("Worker did not respond to malformed JSON"))
    }, 2_000)
    socket.once("error", reject)
    output.once("line", (line) => {
      clearTimeout(timeout)
      socket.end()
      resolve(JSON.parse(line))
    })
    output.once("close", () => {
      clearTimeout(timeout)
      reject(new Error("Worker closed before responding to malformed JSON"))
    })
    socket.once("connect", () => socket.write(`${body}\n`))
  })
}

async function waitForServer(endpoint) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection(endpoint)
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Worker socket did not start")
}
