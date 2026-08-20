// Canonical v3 registration table. M wires these into the BlockRuntimeHost;
// gated by BLOCK_RUNTIME_V3 (canvas/flag.ts) — flipped only after the full
// integration pass, so the live canvas keeps the legacy paths until then.
import type { BlockRuntimeRegistration } from "../contracts"
import { ChatRelayRuntimeAdapter } from "../../blocks/chat-relay/runtime"
import { masterAgentRuntimeRegistration } from "../../master-agent/runtime-registration"
import { operatingChatRuntimeRegistration } from "./operating-chat"
import { builtinStaticRegistrations } from "./static-blocks"

export const BLOCK_REGISTRATIONS: Record<string, BlockRuntimeRegistration<unknown, unknown, unknown>> = {
  "builtin:chat-relay": ChatRelayRuntimeAdapter as BlockRuntimeRegistration<unknown, unknown, unknown>,
  "builtin:master-agent": masterAgentRuntimeRegistration as BlockRuntimeRegistration<unknown, unknown, unknown>,
  "builtin:operating-chat": operatingChatRuntimeRegistration as BlockRuntimeRegistration<unknown, unknown, unknown>,
  ...builtinStaticRegistrations,
}

export function registrationFor(functionalityID: string): BlockRuntimeRegistration<unknown, unknown, unknown> | undefined {
  return BLOCK_REGISTRATIONS[functionalityID]
}
