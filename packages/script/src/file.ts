import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

// Node-compatible stand-in for Bun.file(): a lazy file reference with the
// same surface the scripts use (.text, .json, .write, .exists, .name, .stat).
export class FileRef {
  constructor(public path: string) {}

  get name() {
    return path.basename(this.path)
  }

  async text() {
    return readFile(this.path, "utf8")
  }

  async json<T>() {
    return JSON.parse(await this.text()) as T
  }

  async write(content: string | Uint8Array) {
    await writeFile(this.path, content)
  }

  async exists() {
    return readFile(this.path)
      .then(() => true)
      .catch(() => false)
  }

  async stat() {
    const info = await stat(this.path)
    return { isDirectory: () => info.isDirectory() }
  }
}

export function file(path: string) {
  return new FileRef(path)
}
