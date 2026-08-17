import { readFile } from "node:fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await readFile(process.env.MODELS_DEV_API_JSON, "utf8")
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
console.log("Loaded models.dev snapshot")
