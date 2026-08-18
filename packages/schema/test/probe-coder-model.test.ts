import { Schema } from "effect"
import { optional } from "../src/schema"
import { Workspace } from "../src/workspace"

const decode = Schema.decodeUnknownSync(Workspace.Info)
const encode = Schema.encodeSync(Workspace.Info)

const base = {
  id: "wrk_probe01",
  name: "probe",
  style: "s",
  directories: [],
  pluginIDs: [],
  skillIDs: [],
  git: [],
  time: { created: 0, updated: 0 },
}

const probe = (label: string, fn: () => unknown) => {
  try {
    console.log(label + ":", JSON.stringify(fn()))
  } catch (e) {
    console.log(label + " ERROR:", e.constructor.name + ": " + e.message.split("\n")[0])
  }
}

probe("info decode coderModel null", () => decode({ ...base, coderModel: null }))
probe("info decode coderModel string", () => decode({ ...base, coderModel: "anthropic/claude-sonnet-4" }))
probe("info decode missing", () => decode(base))
probe("info decode model null", () => decode({ ...base, model: null }))
probe("info encode coderModel null", () => encode({ ...base, coderModel: null }))
probe("info encode coderModel string", () => encode({ ...base, coderModel: "anthropic/claude-sonnet-4" }))
probe("info encode coderModel undefined", () => encode({ ...base, coderModel: undefined }))
probe("info encode model null", () => encode({ ...base, model: null }))
probe("info encode model undefined", () => encode({ ...base, model: undefined }))
