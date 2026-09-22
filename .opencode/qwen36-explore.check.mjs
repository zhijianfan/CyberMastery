import assert from "node:assert/strict"
import plugin from "./plugins/qwen36-explore.js"

const message = { role: "user", agent: "qwen36", sessionID: "task-a", id: "brief-a",
  model: { providerID: "ollama", modelID: "qwen3.6:32k" } }
const original = { info: message, parts: [{ type: "text", text: "Find the loader and report exact source lines." }] }
const titles = ["Task identity", "Authorized scope and prohibitions", "Deliverable contract",
  "Completed coverage with observed evidence IDs", "Pending coverage", "Contradictions, errors and uncertainty",
  "Next permitted step"]
const summary = { info: { role: "assistant", summary: true, finish: "stop" },
  parts: [{ type: "text", text: titles.join("\n") + "\nTASK_ID: task-a/brief-a" }] }
let stored = [original, summary]
const hooks = await plugin({ directory: "D:\\CyberMastery", client: {
  session: { messages: async () => ({ data: stored }) },
} })

await hooks["chat.params"]({ sessionID: "task-a", message })
const read = { args: { filePath: "source.ts", limit: 2000 } }
await hooks["tool.execute.before"]({ sessionID: "task-a", tool: "read" }, read)
assert.equal(read.args.limit, 120)
const output = { output: Array.from({ length: 120 }, (_, i) => `${i + 1}: ${"source ".repeat(40)}`).join("\n"),
  metadata: { preview: "unbounded", display: {} }, attachments: [{ text: "unbounded" }] }
await hooks["tool.execute.after"]({ sessionID: "task-a", tool: "read" }, output)
assert.ok(Buffer.byteLength(output.output) <= 6000)
assert.match(output.output, /Q36 TRUNCATED/)
assert.equal(output.attachments, undefined)
assert.equal(output.metadata.preview, undefined)

const compacting = { context: [] }
await hooks["experimental.session.compacting"]({ sessionID: "task-a" }, compacting)
assert.match(compacting.prompt, /task-a\/brief-a/)
assert.match(compacting.prompt, /Find the loader/)
assert.ok(titles.every((title) => compacting.prompt.includes(title)))
await hooks["experimental.compaction.autocontinue"]({ sessionID: "task-a", message }, { enabled: true })

const resume = { info: { ...message, id: "continue-a" }, parts: [{ type: "text", synthetic: true,
  metadata: { compaction_continue: true }, text: "Continue or ask for clarification." }] }
const transformed = { messages: [structuredClone(summary), structuredClone(resume)] }
await hooks["experimental.chat.messages.transform"]({}, transformed)
assert.match(transformed.messages[1].parts[0].text, /Find the loader/)
assert.doesNotMatch(transformed.messages[1].parts[0].text, /ask for clarification/)
const normal = { messages: [original] }
const unchanged = structuredClone(normal)
await hooks["experimental.chat.messages.transform"]({}, normal)
assert.deepEqual(normal, unchanged)

for (const broken of [
  { ...summary, info: { ...summary.info, finish: "length" } },
  { ...summary, parts: [{ type: "text", text: "" }] },
  { ...summary, parts: [{ type: "text", text: "workerKey" }] },
  { ...summary, parts: [{ type: "text", text: titles.join("\n") + "\nTASK_ID: another-task/brief" }] },
]) {
  stored = [original, broken]
  const followup = { enabled: true }
  await assert.rejects(hooks["experimental.compaction.autocontinue"]({ sessionID: "task-a", message }, followup), /Q36 BLOCKED/)
  assert.equal(followup.enabled, false)
  await assert.rejects(hooks["experimental.chat.messages.transform"]({}, { messages: [broken, resume] }), /Q36 BLOCKED/)
}
stored = [summary]
await assert.rejects(hooks["experimental.compaction.autocontinue"]({ sessionID: "task-a", message }, { enabled: true }), /original brief/)

const other = { ...message, agent: "build" }
await hooks["chat.params"]({ sessionID: "other", message: other })
const otherRead = { args: { limit: 2000 } }
await hooks["tool.execute.before"]({ sessionID: "other", tool: "read" }, otherRead)
assert.equal(otherRead.args.limit, 2000)
const otherResume = { messages: [{ ...resume, info: other }] }
const before = structuredClone(otherResume)
await hooks["experimental.chat.messages.transform"]({}, otherResume)
assert.deepEqual(otherResume, before)
await hooks.dispose()
console.log("PASS: read/output bounds, original task recovery, checkpoint rejection, and unrelated-agent isolation")
