import { Schema } from "effect"
import { Workspace } from "../src/workspace"

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

probe("info decode coderModel null", () => Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: null }))
probe("info decode coderModel string", () =>
  Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" }),
)
probe("info decode missing", () => Schema.decodeUnknownSync(Workspace.Info)(base))
probe("info decode model null", () => Schema.decodeUnknownSync(Workspace.Info)({ ...base, model: null }))
probe("info encode coderModel null", () => Schema.encodeSync(Workspace.Info)({ ...base, coderModel: null }))
probe("info encode coderModel string", () =>
  Schema.encodeSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" }),
)
probe("info encode coderModel undefined", () => Schema.encodeSync(Workspace.Info)({ ...base, coderModel: undefined }))
