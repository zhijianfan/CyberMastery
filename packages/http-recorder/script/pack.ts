#!/usr/bin/env node
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)

const dir = fileURLToPath(new URL("..", import.meta.url))

export const pack = async () => {
  process.chdir(dir)
  await execFileAsync("bun", ["run", "build"], { stdio: "inherit" })
  const original = await readFile("package.json", "utf8")
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package.json is validated by the package schema and build checks.
  const pkg = JSON.parse(original) as {
    readonly version: string
    exports: Record<string, string | { readonly import: string; readonly types: string }>
  }

  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key === "./internal") {
      delete pkg.exports[key]
      continue
    }
    if (typeof value !== "string") continue
    const file = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    pkg.exports[key] = { import: `${file}.js`, types: `${file}.d.ts` }
  }
  await writeFile("package.json", JSON.stringify(pkg, null, 2))
  try {
    await execFileAsync("bun", ["pm", "pack"], { stdio: "inherit" })
    return fileURLToPath(new URL(`../opencode-ai-http-recorder-${pkg.version}.tgz`, import.meta.url))
  } finally {
    await writeFile("package.json", original)
  }
}

if (import.meta.main) await pack()
