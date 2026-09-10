export * as ChatProxy from "./chat-proxy"

import { Schema } from "effect"
import { optional } from "./schema"
import { SessionInput } from "./session-input"
import { Workspace } from "./workspace"

export const ProviderID = Schema.Literal("chatgpt").annotate({ identifier: "ChatProxy.ProviderID" })
export type ProviderID = typeof ProviderID.Type

export const ProviderStatus = Schema.Literals(["disconnected", "opening", "login-required", "ready", "error"]).annotate(
  { identifier: "ChatProxy.ProviderStatus" },
)
export type ProviderStatus = typeof ProviderStatus.Type

export class Provider extends Schema.Class<Provider>("ChatProxy.Provider")({
  id: ProviderID,
  name: Schema.String,
  status: ProviderStatus,
  error: optional(Schema.String),
}) {}

export class Option extends Schema.Class<Option>("ChatProxy.Option")({
  id: Schema.String,
  label: Schema.String,
  disabled: optional(Schema.Boolean),
}) {}

export class Selection extends Schema.Class<Selection>("ChatProxy.Selection")({
  value: optional(Schema.String),
  label: optional(Schema.String),
  options: Schema.Array(Option),
}) {}

export class Controls extends Schema.Class<Controls>("ChatProxy.Controls")({
  model: optional(Selection),
  effort: optional(Selection),
  error: optional(Schema.String),
}) {}

export class Message extends Schema.Class<Message>("ChatProxy.Message")({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  createdAt: Schema.Number,
}) {}

export const RelayStatus = Schema.Literals([
  "disconnected",
  "opening",
  "login-required",
  "idle",
  "thinking",
  "error",
  "closed",
]).annotate({ identifier: "ChatProxy.RelayStatus" })
export type RelayStatus = typeof RelayStatus.Type

export class Relay extends Schema.Class<Relay>("ChatProxy.Relay")({
  providerID: ProviderID,
  workspaceID: Workspace.ID,
  blockID: Schema.String,
  tabID: optional(Schema.String),
  status: RelayStatus,
  messages: Schema.Array(Message),
  url: optional(Schema.String),
  error: optional(Schema.String),
  controls: optional(Controls),
}) {}

export const ResetPayload = Schema.Struct({
  tabID: optional(Schema.String),
}).annotate({ identifier: "ChatProxy.ResetPayload" })
export type ResetPayload = typeof ResetPayload.Type

export const PromptPayload = Schema.Struct({
  tabID: Schema.String,
  messageID: Schema.String,
  text: Schema.String,
  contextAttachments: optional(SessionInput.ContextAttachments),
}).annotate({ identifier: "ChatProxy.PromptPayload" })
export type PromptPayload = typeof PromptPayload.Type

export const OpenRelayPayload = Schema.Struct({
  tabID: Schema.String,
}).annotate({ identifier: "ChatProxy.OpenRelayPayload" })
export type OpenRelayPayload = typeof OpenRelayPayload.Type

export const OptionsPayload = Schema.Struct({
  tabID: Schema.String,
}).annotate({ identifier: "ChatProxy.OptionsPayload" })
export type OptionsPayload = typeof OptionsPayload.Type

export const ConfigurePayload = Schema.Struct({
  tabID: Schema.String,
  model: optional(Schema.String),
  effort: optional(Schema.String),
}).annotate({ identifier: "ChatProxy.ConfigurePayload" })
export type ConfigurePayload = typeof ConfigurePayload.Type
