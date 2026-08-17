#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import fs from "node:fs"
import path from "node:path"
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) return console.log(`already published ${name}@${version}`)
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

function walkSync(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkSync(full))
    else results.push(full)
  }
  return results
}

const binaries: Record<string, string> = {}
for (const filepath of walkSync("dist")) {
  if (path.basename(filepath) !== "package.json") continue
  if (path.relative("dist", filepath).split(path.sep).length !== 2) continue
  const item = JSON.parse(await readFile(filepath, "utf8"))
  binaries[item.name] = item.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./bin/lildax.cjs ./dist/${pkg.name}/bin/lildax`
await writeFile(
  `./dist/${pkg.name}/package.json`,
  JSON.stringify(
    {
      name: pkg.name,
      bin: { lildax: "./bin/lildax" },
      version,
      license: pkg.license,
      repository: { type: "git", url: "git+https://github.com/anomalyco/opencode.git" },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

await Promise.all(
  Object.entries(binaries).map(([name, version]) =>
    publish(`./dist/${name.replace("@opencode-ai/", "")}`, name, version),
  ),
)
await publish(`./dist/${pkg.name}`, pkg.name, version)
