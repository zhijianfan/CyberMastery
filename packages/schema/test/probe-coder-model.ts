import { Schema } from "effect"
import { Workspace } from "../src/workspace"

const base = {
  id: "wrk_test01",
  name: "n",
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

probe("decode null", () => Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: null }))
probe("decode string", () => Schema.decodeUnknownSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" }))
probe("decode missing", () => Schema.decodeUnknownSync(Workspace.Info)(base))
probe("decode model null", () => Schema.decodeUnknownSync(Workspace.Info)({ ...base, model: null }))
probe("encode null", () => Schema.encodeSync(Workspace.Info)({ ...base, coderModel: null }))
probe("encode string", () => Schema.encodeSync(Workspace.Info)({ ...base, coderModel: "anthropic/claude-sonnet-4" }))
probe("encode undefined", () => Schema.encodeSync(Workspace.Info)({ ...base, coderModel: undefined }))
