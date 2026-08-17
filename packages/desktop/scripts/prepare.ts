#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { Script } from "@opencode-ai/script"

await import("./prebuild")

const pkg = await JSON.parse(await readFile("./package.json", "utf8"))
pkg.version = Script.version
await writeFile("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)
