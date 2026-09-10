#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"
import { copyFile, cp, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

const chatRelayModule = fileURLToPath(import.meta.resolve("@opencode-ai/server/chat-proxy"))
const chatRelayRequire = createRequire(chatRelayModule)
const playwrightPackage = chatRelayRequire.resolve("playwright/package.json")
await mkdir("./dist/node/node_modules", { recursive: true })
await Promise.all([
  copyFile(path.join(path.dirname(chatRelayModule), "chat-proxy-worker.mjs"), "./dist/node/chat-proxy-worker.mjs"),
  cp(path.dirname(playwrightPackage), "./dist/node/node_modules/playwright", { recursive: true }),
  cp(
    path.dirname(createRequire(playwrightPackage).resolve("playwright-core/package.json")),
    "./dist/node/node_modules/playwright-core",
    { recursive: true },
  ),
])

console.log("Build complete")
