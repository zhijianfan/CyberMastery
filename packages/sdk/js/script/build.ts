#!/usr/bin/env node
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, rm, writeFile } from "node:fs/promises"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const execFileAsync = promisify(execFile)
const opencode = path.resolve(dir, "../../opencode")
const rootNodeModules = path.resolve(dir, "../../../node_modules")
const prettierBin = path.join(rootNodeModules, "prettier/bin/prettier.cjs")
const tscBin = path.join(rootNodeModules, "typescript/bin/tsc")

// The opencode CLI still executes its TS entrypoint through bun because it
// uses tsconfig path aliases; the runtime code itself is Node-compatible.
const { stdout } = await execFileAsync("bun", ["run", "--conditions=browser", "./src/index.ts", "generate"], {
  cwd: opencode,
  maxBuffer: 100 * 1024 * 1024,
})
await writeFile(path.join(dir, "openapi.json"), stdout)

const document = JSON.parse(await readFile("./openapi.json", "utf8")) as {
  components?: { schemas?: Record<string, unknown> }
  [key: string]: unknown
}
const schemas = document.components?.schemas
if (schemas) {
  const reachable = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length)
        if (reachable.has(name)) continue
        reachable.add(name)
        visit(schemas[name])
      } else {
        visit(child)
      }
    }
  }
  visit({ ...document, components: { ...document.components, schemas: undefined } })
  for (const name of Object.keys(schemas)) {
    if (/^SessionNext\w+1$/.test(name) && !reachable.has(name)) delete schemas[name]
  }
  await writeFile("./openapi.json", JSON.stringify(document))
}

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

const generatedTypes = await readFile("./src/v2/gen/types.gen.ts", "utf8")
if (/export type SessionNext\w+1 =/.test(generatedTypes)) {
  throw new Error("Session history generated duplicate Session event variants")
}
const historyTypesPatched = generatedTypes.replace(
  /(export type V2SessionHistoryData = \{[\s\S]*?query\?: \{\s*limit\?: )string([;,]\s*after\?: )string/,
  "$1number$2number",
)
if (historyTypesPatched === generatedTypes) {
  throw new Error("Session history numeric query patch did not apply")
}
await writeFile("./src/v2/gen/types.gen.ts", historyTypesPatched)

const generatedSdk = await readFile("./src/v2/gen/sdk.gen.ts", "utf8")
const historySdkPatched = generatedSdk.replace(
  /(Get session history[\s\S]*?parameters: \{\s*sessionID: string[;,]\s*limit\?: )string([;,]\s*after\?: )string/,
  "$1number$2number",
)
if (historySdkPatched === generatedSdk) {
  throw new Error("Session history numeric SDK patch did not apply")
}
await writeFile("./src/v2/gen/sdk.gen.ts", historySdkPatched)

// Patch a @hey-api/openapi-ts codegen bug: SseFn incorrectly passes the
// endpoint's TError into the second generic of ServerSentEventsResult, which
// is the AsyncGenerator's TReturn slot. Iterator return values have nothing
// to do with HTTP errors, and any consumer that calls `.return()` or returns
// from a mock generator gets type-checked against the wrong shape. Drop the
// arg so TReturn defaults to void.
const sseTypesPath = "./src/v2/gen/client/types.gen.ts"
const sseTypesSource = await readFile(sseTypesPath, "utf8")
const sseTypesPatched = sseTypesSource.replace(
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)
if (sseTypesPatched === sseTypesSource) {
  throw new Error(`SseFn patch did not apply; @hey-api/openapi-ts output may have changed (${sseTypesPath})`)
}
await writeFile(sseTypesPath, sseTypesPatched)

await execFileAsync(process.execPath, [prettierBin, "--write", "src/gen"], { cwd: dir })
await execFileAsync(process.execPath, [prettierBin, "--write", "src/v2"], { cwd: dir })
await rm(path.join(dir, "dist"), { recursive: true, force: true })
await execFileAsync(process.execPath, [tscBin], { cwd: dir })
await rm(path.join(dir, "openapi.json"), { force: true })
