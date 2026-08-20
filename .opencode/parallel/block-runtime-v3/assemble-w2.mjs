// Assembles Wave-2 briefs: packet + contract + inlined source.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = "D:/OpencodeDev"
const dir = join(root, ".opencode/parallel/block-runtime-v3/tasks")
const contract = readFileSync(join(root, "specs/workspace-canvas/block-runtime-v3-contract.md"), "utf8")

const INLINE = {
  H: [
    "packages/app/src/pages/canvas/blocks/chat-relay/view.tsx",
    "packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts",
    "packages/app/src/pages/canvas/blocks/chat-relay/types.ts",
    "packages/app/src/pages/canvas/blocks/chat-relay/index.ts",
    "packages/app/src/pages/canvas/runtime/block-runtime-host.tsx",
    "packages/app/src/pages/canvas/runtime/provider.tsx",
    "packages/app/src/pages/canvas/runtime/server-transport.ts",
    "packages/app/src/pages/canvas/runtime/adapters/session-binding.ts",
    "packages/app/src/pages/canvas/runtime/HANDOFF-D.md",
  ],
  I: [
    "packages/app/src/pages/canvas/master-agent/block.tsx",
    "packages/app/src/pages/canvas/master-agent/block-shell.tsx",
    "packages/app/src/pages/canvas/master-agent/types.ts",
    "packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts",
    "packages/app/src/pages/canvas/master-agent/port.ts",
    "packages/app/src/pages/canvas/master-agent/sdk-port.ts",
    "packages/app/src/pages/canvas/master-agent/event-reconciliation.ts",
    "packages/app/src/pages/canvas/master-agent/functionality.ts",
    "packages/app/src/pages/canvas/runtime/adapters/session-binding.ts",
    "packages/app/src/pages/canvas/runtime/HANDOFF-D.md",
    { path: "packages/app/src/pages/canvas/workspace.tsx", start: 1450, end: 1500 },
  ],
  J: [
    { path: "packages/app/src/pages/canvas/workspace.tsx", start: 2145, end: 2262 },
    "packages/app/src/pages/canvas/editor/operating-context.ts",
  ],
  K: [
    { path: "packages/app/src/pages/canvas/workspace.tsx", start: 165, end: 400 },
    { path: "packages/app/src/pages/canvas/workspace.tsx", start: 1688, end: 1890 },
  ],
  L: [
    "packages/app/src/pages/canvas/diagnostics.ts",
    { path: "packages/app/src/pages/canvas/workspace.tsx", start: 455, end: 500 },
  ],
}

const esc = (s) => s.replace(/`/g, "\\`")

for (const [id, files] of Object.entries(INLINE)) {
  const packet = readFileSync(join(dir, `${id}.packet.md`), "utf8")
  const parts = [packet]
  parts.push("\n\n---\n\n## Authoritative contracts (frozen by S0 — follow EXACTLY)\n\n" + contract)
  parts.push("\n\n---\n\n## Inlined source — your ONLY other context\n\n")
  for (const item of files) {
    const path = typeof item === "string" ? item : item.path
    let src
    try {
      src = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")
    } catch {
      parts.push(`### \`${path}\` — NOT ON DISK (skip; note in handoff)\n\n`)
      continue
    }
    let body = src
    let label = `${path} (${src.split("\n").length} lines)`
    if (typeof item !== "string") {
      const lines = src.split("\n")
      body = lines.slice(item.start - 1, item.end).join("\n")
      label = `${path}:${item.start}-${item.end}`
    }
    const fence = path.endsWith(".tsx") ? "tsx" : "ts"
    parts.push(`### \`${label}\`\n\n\`\`\`${fence}\n${esc(body)}\n\`\`\`\n`)
  }
  writeFileSync(join(dir, `${id}.md`), parts.join("\n"))
  console.log(id, (parts.join("\n").length / 1024).toFixed(0) + "KB")
}
