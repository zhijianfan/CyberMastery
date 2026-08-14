import * as path from "node:path"

export const ALLOWED_EXTENSIONS = [".md", ".txt", ".json", ".jsonl"] as const

export const DEFAULT_ROOTS = {
  inbox: "specs/relay/inbox",
  archive: "specs/relay/archive",
  ledger: "specs/relay/index.jsonl",
  specs: "specs",
} as const

export function isAllowedExtension(name: string): boolean {
  const extension = path.extname(name).toLowerCase()
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extension)
}

export function resolveContained(baseDir: string, relative: string): string {
  const segments = relative.split(/[\\/]/)
  if (segments.includes("..")) throw new Error(`path escapes base directory: ${relative}`)
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, relative)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes base directory: ${relative}`)
  }
  return resolved
}

export function isWithinSpecs(target: string, cwd: string): boolean {
  const resolved = path.resolve(target)
  const specsRoot = path.resolve(cwd, DEFAULT_ROOTS.specs)
  return resolved === specsRoot || resolved.startsWith(specsRoot + path.sep)
}
