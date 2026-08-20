// Builds the WORKSPACE-COMPENDIUM.md — single-file workspace domain reference.
// Design docs + full source, line-numbered code fences, TOC.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = "D:/OpencodeDev"
const out = join(root, ".opencode/parallel/block-runtime/WORKSPACE-COMPENDIUM.md")

const DOCS = [
  "specs/workspace-canvas/requirements.md",
  "specs/workspace-canvas/architecture.md",
  "specs/workspace-canvas/UIDesign.md",
  "specs/workspace-canvas/functionality-subsystem-management-architecture.md",
  "specs/workspace-canvas/block-runtime-observability.md",
  ".opencode/parallel/block-runtime/MANIFEST.md",
  ".opencode/parallel/block-runtime/P0.md",
  ".opencode/parallel/block-runtime/PIPELINE.md",
]

const BACKEND = [
  "packages/schema/src/workspace.ts",
  "packages/core/src/workspace/sql.ts",
  "packages/core/src/workspace/service.ts",
  "packages/core/src/workspace/functionality-instance.ts",
  "packages/core/src/workspace/chat-relay-session.ts",
  "packages/core/src/workspace/chat-relay-payload.ts",
  "packages/core/src/workspace/master-agent.ts",
  "packages/core/src/workspace/master-agent-events.ts",
  "packages/core/src/workspace/coder-model-codec.ts",
  "packages/core/src/workspace/default-layout.ts",
  "packages/protocol/src/groups/workspace.ts",
  "packages/protocol/src/groups/master-agent.ts",
  "packages/protocol/src/groups/chat-relay.ts",
  "packages/protocol/src/groups/block-runtime.ts",
  "packages/server/src/handlers/workspace.ts",
  "packages/server/src/handlers/workspace-master-agent.ts",
  "packages/server/src/handlers/workspace-master-agent-access.ts",
  "packages/server/src/handlers/chat-relay-session.ts",
  "packages/server/src/handlers/chat-relay-session-access.ts",
  "packages/server/src/handlers/block-runtime.ts",
  "packages/server/src/runtime/resource-snapshot.ts",
  "packages/server/src/runtime/block-runtime-gateway.ts",
  "packages/server/src/runtime/adapters/opencode-chat.ts",
  "packages/server/src/runtime/adapters/native-runtime-services.ts",
  "packages/server/src/routes.ts",
  "packages/opencode/src/server/routes/instance/httpapi/server.ts",
]

const FRONTEND = [
  "packages/app/src/pages/canvas/manager.ts",
  "packages/app/src/pages/canvas/workspace.tsx",
  "packages/app/src/pages/canvas/permissions.ts",
  "packages/app/src/pages/canvas/session-target.tsx",
  "packages/app/src/pages/canvas/session-scope.tsx",
  "packages/app/src/pages/canvas/session-surface.tsx",
  "packages/app/src/pages/canvas/session-surface-providers.tsx",
  "packages/app/src/pages/canvas/diagnostics.ts",
  "packages/app/src/pages/canvas/blocks/chat-relay/index.ts",
  "packages/app/src/pages/canvas/blocks/chat-relay/types.ts",
  "packages/app/src/pages/canvas/blocks/chat-relay/runtime.ts",
  "packages/app/src/pages/canvas/blocks/chat-relay/view.tsx",
  "packages/app/src/pages/canvas/master-agent/types.ts",
  "packages/app/src/pages/canvas/master-agent/block.tsx",
  "packages/app/src/pages/canvas/master-agent/block-shell.tsx",
  "packages/app/src/pages/canvas/master-agent/coder-controller.ts",
  "packages/app/src/pages/canvas/master-agent/coder-selector.tsx",
  "packages/app/src/pages/canvas/master-agent/event-reconciliation.ts",
  "packages/app/src/pages/canvas/master-agent/functionality.ts",
  "packages/app/src/pages/canvas/master-agent/lifecycle-controller.ts",
  "packages/app/src/pages/canvas/master-agent/port.ts",
  "packages/app/src/pages/canvas/master-agent/sdk-port.ts",
  "packages/app/src/pages/canvas/master-agent/session-options.ts",
  "packages/app/src/pages/canvas/master-agent/status-view.tsx",
  "packages/app/src/pages/canvas/runtime/types.ts",
  "packages/app/src/pages/canvas/runtime/registry.ts",
  "packages/app/src/pages/canvas/runtime/controller.ts",
  "packages/app/src/pages/canvas/runtime/index.ts",
  "packages/app/src/pages/canvas/runtime/server-transport.ts",
  "packages/app/src/pages/canvas/runtime/bootstrap.ts",
  "packages/app/src/state/block-runtime-store.ts",
]

const lines = []
const push = (s = "") => lines.push(s)

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`")

push("# WORKSPACE DOMAIN — DESIGN REQUIREMENTS, ARCHITECTURE & FULL SOURCE COMPENDIUM")
push()
push(`> Generated 2026-08-19 by Cybermaster from the working tree at \`D:/OpencodeDev\` (branch feature/CyberMaster, uncommitted).`)
push(`> One self-contained reference: design requirements → architecture → backend source → frontend source. Code blocks are line-numbered so cross-references read as \`path:line\`.`)
push()
push("## 1. Design Requirements & Architecture Documents")
push()
DOCS.forEach((path, i) => {
  push(`### 1.${i + 1} \`${path}\``)
  push()
  push(readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n"))
  push()
})

push("## 2. Backend Source (core / protocol / server / opencode app)")
push()
BACKEND.forEach((path) => {
  if (!existsSync(join(root, path))) {
    push(`### \`${path}\` — MISSING (skipped)`)
    push()
    return
  }
  const src = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")
  push(`### \`${path}\` (${src.split("\n").length} lines)`)
  push()
  push("```ts")
  src.split("\n").forEach((line, i) => push(`${String(i + 1).padStart(4)}| ${line}`))
  push("```")
  push()
})

push("## 3. Frontend Source (canvas)")
push()
FRONTEND.forEach((path) => {
  if (!existsSync(join(root, path))) {
    push(`### \`${path}\` — MISSING (skipped)`)
    push()
    return
  }
  const src = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")
  push(`### \`${path}\` (${src.split("\n").length} lines)`)
  push()
  const fence = path.endsWith(".tsx") ? "tsx" : "ts"
  push(`\`\`\`${fence}`)
  src.split("\n").forEach((line, i) => push(`${String(i + 1).padStart(4)}| ${line}`))
  push("```")
  push()
})

push("## 4. Feature Flag")
push()
push("`packages/core/src/flag/flag.ts` — the block runtime is gated by `CYBERMASTER_BLOCK_RUNTIME_V2` (server-side). App-side the legacy path is the default; the runtime path activates via `VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true` wiring in `runtime/bootstrap.ts` + `view.tsx` `parseRuntimeV2()`.")
push()

writeFileSync(out, lines.join("\n"))
console.log("WROTE", out, (lines.join("\n").length / 1024).toFixed(0) + "KB", lines.length, "lines")
