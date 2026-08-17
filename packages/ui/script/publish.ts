#!/usr/bin/env node

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { pack } from "./pack"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const pkg = (await JSON.parse(await readFile("package.json", "utf8"))) as { name: string; version: string }
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

try {
  await $`bun run typecheck`
  await $`bun run test`
  await pack()
  await $`npm publish ${tarball} --access public --tag ${Script.channel}`
} finally {
  await rm(tarball, { force: true })
}
