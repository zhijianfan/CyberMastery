// Assembles self-contained worker briefs: packet + frozen contract + inlined source.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = "D:/OpencodeDev"
const dir = join(root, ".opencode/parallel/block-runtime-v3/tasks")
const contract = readFileSync(join(root, "specs/workspace-canvas/block-runtime-v3-contract.md"), "utf8")

const INLINE = {
  A: [
    "packages/app/src/pages/canvas/runtime/types.ts",
    "packages/app/src/pages/canvas/blocks/chat-relay/types.ts",
    "packages/protocol/src/groups/block-runtime.ts",
  ],
  B: [
    "packages/core/src/workspace/functionality-instance.ts",
    "packages/core/src/workspace/master-agent-events.ts",
    "packages/core/src/workspace/chat-relay-payload.ts",
    "packages/core/src/workspace/chat-relay-session.ts",
  ],
  C: [
    "packages/app/src/pages/canvas/runtime/controller.ts",
    "packages/app/src/pages/canvas/runtime/registry.ts",
    "packages/app/src/pages/canvas/runtime/types.ts",
    "packages/app/src/pages/canvas/runtime/index.ts",
    "packages/app/src/state/block-runtime-store.ts",
    { path: "packages/app/src/pages/canvas/manager.ts", start: 596, end: 660 },
  ],
  D: [
    "packages/app/src/pages/canvas/workspace.tsx",
    "packages/app/src/pages/canvas/runtime/bootstrap.ts",
    "packages/app/src/pages/canvas/runtime/server-transport.ts",
    "packages/app/src/pages/canvas/session-surface-providers.tsx",
    { path: "packages/app/src/pages/canvas/manager.ts", start: 55, end: 120 },
    { path: "packages/app/src/pages/canvas/manager.ts", start: 153, end: 235 },
  ],
  E: [
    "packages/app/src/pages/canvas/manager.ts",
    "packages/protocol/src/groups/workspace.ts",
    "packages/server/src/handlers/workspace.ts",
    "packages/core/src/workspace/service.ts",
    { path: "packages/core/src/workspace/chat-relay-session.ts", start: 1, end: 40 },
  ],
  F: [
    "packages/core/src/workspace/chat-relay-session.ts",
    "packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts",
    "packages/app/src/pages/canvas/master-agent/port.ts",
    "packages/app/src/pages/canvas/master-agent/sdk-port.ts",
    "packages/app/src/pages/canvas/master-agent/block.tsx",
    "packages/app/src/pages/canvas/master-agent/types.ts",
    "packages/app/src/pages/canvas/master-agent/event-reconciliation.ts",
  ],
  G: [
    "packages/app/src/pages/canvas/master-agent.e2e.test.tsx",
    "packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts",
    "packages/app/src/test/block-runtime-events.ts",
    { path: "packages/app/src/context/server-sdk.tsx", start: 375, end: 430 },
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
    const src = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")
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
