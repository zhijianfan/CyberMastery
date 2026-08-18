import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { extractDocuments } from "./core/classify.js"
import { writeDocument } from "./core/docwriter.js"
import { parseTranscript } from "./core/ingest.js"
import { appendLedger, organizeInbox } from "./core/organize.js"
import { resolveContained } from "./core/paths.js"
import { createChatGPTProvider } from "./provider/chatgpt.js"
import { runPlan } from "./provider/runplan.js"

interface ParsedArgs {
  command: string | null
  positional: string[]
  flags: Map<string, string>
}

const VALUE_FLAGS = new Set(["base", "domain", "credentials", "inbox"])

const USAGE = `relay — turn AI chat transcripts into stored specs

usage:
  relay login [--credentials <file>]
      authorize a ChatGPT account through opencode's device OAuth flow
  relay chat <idea> [--credentials <file>] [--inbox <dir>] [--base <dir>]
      run a ChatGPT session through the default plan into the inbox
  relay ingest <file|dir> [--domain <name>] [--base <dir>]
      parse transcripts into specs/<domain>/<kind>.md, update ledger, archive
  relay organize [--base <dir>]
      archive inbox transcripts, append ledger records, print counts
  relay status [--base <dir>]
      show inbox/archive/ledger paths, counts, last 5 ledger records
  relay --help
      show this usage text

options:
  --base <dir>         workspace root for specs/ (default: cwd)
  --domain <name>      output domain for ingest (default: relay)
  --credentials <file> stored account credentials (default: ~/.relay/chatgpt/credentials.json)
  --inbox <dir>        inbox override for chat (default: <base>/specs/relay/inbox)
`

const out = (text: string): void => {
  process.stdout.write(text)
}

class UsageError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string>()
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") return { command: null, positional, flags }
    if (arg.startsWith("--")) {
      const name = arg.slice(2)
      const eq = name.indexOf("=")
      if (eq !== -1) {
        flags.set(name.slice(0, eq), name.slice(eq + 1))
      } else if (VALUE_FLAGS.has(name)) {
        const value = argv[i + 1]
        if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for --${name}`)
        flags.set(name, value)
        i++
      } else {
        flags.set(name, "true")
      }
    } else {
      positional.push(arg)
    }
    i++
  }
  return { command: positional[0] ?? null, positional, flags }
}

function guard(rootDir: string, target: string): string {
  const resolved = resolveContained(rootDir, target)
  if (!resolved) throw new Error(`path escapes specs/: ${target}`)
  return resolved
}

function credentialsPath(args: ParsedArgs): string {
  return args.flags.get("credentials") ?? join(homedir(), ".relay", "chatgpt", "credentials.json")
}

async function listTranscripts(target: string): Promise<string[]> {
  const info = await stat(target)
  if (info.isDirectory()) {
    return (await readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(target, entry.name))
      .sort()
  }
  if (info.isFile()) {
    if (!target.endsWith(".md")) throw new UsageError(`not a .md transcript: ${target}`)
    return [target]
  }
  throw new UsageError(`not a file or directory: ${target}`)
}

async function ingestFile(baseDir: string, domain: string, file: string): Promise<void> {
  const transcript = await parseTranscript(await readFile(file, "utf8"))
  const docs = extractDocuments(transcript.body)
  if (docs.length === 0) return out(`skip ${basename(file)}: nothing to extract\n`)
  const provenance = {
    source: transcript.meta.source,
    conversationId: transcript.meta.conversationId,
    capturedAt: transcript.meta.capturedAt,
    rawTranscript: ["specs", "relay", "archive", basename(file)].join("/"),
  }
  for (const doc of docs) {
    const docPath = await writeDocument(baseDir, domain, doc, provenance)
    await appendLedger({
      baseDir,
      record: {
        kind: doc.kind,
        domain,
        path: docPath,
        conversationId: transcript.meta.conversationId,
        source: transcript.meta.source,
        capturedAt: transcript.meta.capturedAt,
      },
    })
    out(`wrote ${docPath}\n`)
  }
}

async function runIngest(args: ParsedArgs): Promise<void> {
  const target = args.positional[1]
  if (!target) throw new UsageError("ingest requires a <file|dir> argument")
  const baseDir = args.flags.get("base") ?? process.cwd()
  const domain = args.flags.get("domain") ?? "relay"
  guard(join(baseDir, "specs"), domain)
  const files = await listTranscripts(target)
  if (files.length === 0) return out(`no .md transcripts found in ${target}\n`)
  for (const file of files) await ingestFile(baseDir, domain, file)
  const organized = await organizeInbox({ baseDir })
  out(
    `archived ${organized.archived.length} transcript(s), skipped ${organized.skipped.length} non-transcript file(s)\n`,
  )
}

async function runOrganize(args: ParsedArgs): Promise<void> {
  const baseDir = args.flags.get("base") ?? process.cwd()
  const result = await organizeInbox({ baseDir })
  for (const target of result.archived) {
    await appendLedger({
      baseDir,
      record: { kind: "archive", path: target, archivedAt: new Date().toISOString() },
    })
  }
  out(
    `archived ${result.archived.length} transcript(s), skipped ${result.skipped.length} file(s), ` +
      `${result.archived.length} ledger record(s)\n`,
  )
}

async function runLogin(args: ParsedArgs): Promise<void> {
  const provider = createChatGPTProvider({ credentialsPath: credentialsPath(args) })
  const flow = await provider.startLogin()
  out(`open ${flow.verificationUrl} and enter code: ${flow.userCode}\n`)
  out("waiting for authorization…\n")
  while (true) {
    const result = await flow.poll()
    if (result.type === "pending") {
      await sleep(flow.pollIntervalMs + 3000)
      continue
    }
    if (result.type === "denied") throw new Error("login denied or failed")
    await provider.saveCredentials(result.credentials)
    out(`login complete${result.credentials.accountId ? ` (account ${result.credentials.accountId})` : ""}\n`)
    return
  }
}

async function runChat(args: ParsedArgs): Promise<void> {
  const idea = args.positional[1]
  if (!idea) throw new UsageError("chat requires an <idea> argument")
  const baseDir = args.flags.get("base") ?? process.cwd()
  const inboxDir = args.flags.get("inbox") ?? join(baseDir, "specs", "relay", "inbox")
  guard(join(baseDir, "specs"), inboxDir)

  const provider = createChatGPTProvider({ credentialsPath: credentialsPath(args) })
  const credentials = await provider.restoreCredentials()
  if (!credentials) throw new Error("no stored credentials — run `relay login` first")

  const session = await provider.openChat({
    credentials,
    onRefresh: async (current) => {
      const refreshed = await provider.refreshCredentials(current)
      await provider.saveCredentials(refreshed)
      return refreshed
    },
  })
  try {
    const written = await runPlan({ session, idea, inboxDir })
    for (const file of written) out(`wrote ${file}\n`)
    out(`conversationId: ${session.conversationId ?? "unknown"}\n`)
  } finally {
    await session.dispose()
  }
}

async function countFiles(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).length
  } catch {
    return 0
  }
}

async function readLines(file: string): Promise<string[]> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter((line) => line.trim() !== "")
  } catch {
    return []
  }
}

async function runStatus(args: ParsedArgs): Promise<void> {
  const baseDir = args.flags.get("base") ?? process.cwd()
  const relayRoot = join(baseDir, "specs", "relay")
  const inboxDir = join(relayRoot, "inbox")
  const archiveDir = join(relayRoot, "archive")
  const ledgerPath = join(relayRoot, "index.jsonl")
  const lines = await readLines(ledgerPath)
  out(
    `base:    ${baseDir}\n` +
      `inbox:   ${inboxDir} (${await countFiles(inboxDir)} files)\n` +
      `archive: ${archiveDir} (${await countFiles(archiveDir)} files)\n` +
      `ledger:  ${ledgerPath} (${lines.length} records)\n`,
  )
  if (lines.length > 0) {
    out("last ledger records:\n")
    for (const line of lines.slice(-5)) out(`  ${line}\n`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  switch (args.command) {
    case null:
      return out(USAGE)
    case "login":
      return await runLogin(args)
    case "chat":
      return await runChat(args)
    case "ingest":
      return await runIngest(args)
    case "organize":
      return await runOrganize(args)
    case "status":
      return await runStatus(args)
    default:
      out(`relay: unknown command '${args.command}'\n\n${USAGE}`)
      process.exitCode = 1
      return
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  out(`relay: ${message}\n`)
  process.exitCode = 1
})
