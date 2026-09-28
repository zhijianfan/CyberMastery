import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"
import { pathToFileURL } from "url"
import { Repository } from "@opencode-ai/core/repository"

const exec = promisify(execFile)

export async function gitRemote(root: string) {
  const origin = path.join(root, "origin.git")
  const source = path.join(root, "source")
  const remote = gitFileURL(origin)
  await git(root, "init", "--bare", origin)
  await git(root, "init", source)
  await git(source, "config", "user.email", "test@example.com")
  await git(source, "config", "user.name", "Test")
  await fs.writeFile(path.join(source, "README.md"), "one\n")
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", "initial")
  await git(source, "branch", "-M", "main")
  await git(source, "remote", "add", "origin", remote)
  await git(source, "push", "-u", "origin", "main")
  await git(root, "--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main")
  return {
    root,
    source,
    remote,
    reference: { ...Repository.parseRemote("owner/repo"), remote },
  }
}

export async function commit(source: string, content: string, message: string) {
  await fs.writeFile(path.join(source, "README.md"), content)
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", message)
  await git(source, "push")
}

export async function branch(source: string, name: string, content: string) {
  await git(source, "checkout", "-b", name)
  await fs.writeFile(path.join(source, "README.md"), content)
  await git(source, "add", "README.md")
  await git(source, "commit", "-m", name)
  await git(source, "push", "-u", "origin", name)
}

export async function git(cwd: string, ...args: string[]) {
  await exec("git", args, { cwd })
}

function gitFileURL(directory: string) {
  const url = pathToFileURL(directory).href
  if (process.platform !== "win32") return url
  return url.replace(/^file:\/\/\//, "file://")
}
