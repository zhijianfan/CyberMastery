// Canonical v3 registration table used by the live canvas host.
import type { BlockRuntimeRegistration } from "../contracts"
import { ChatRelayRuntimeAdapter } from "../../blocks/chat-relay/runtime"
import { ctxPackBrowserRegistration } from "../../blocks/ctxpack-browser/adapter"
import { masterAgentRuntimeRegistration } from "../../master-agent/runtime-registration"
import { operatingChatRuntimeRegistration } from "./operating-chat"
import { builtinStaticRegistrations } from "./static-blocks"

export const BLOCK_REGISTRATIONS: Record<string, BlockRuntimeRegistration<unknown, unknown, unknown>> = {
  "builtin:chat-relay": ChatRelayRuntimeAdapter as BlockRuntimeRegistration<unknown, unknown, unknown>,
  "builtin:ctxpack-browser": ctxPackBrowserRegistration as BlockRuntimeRegistration<unknown, unknown, unknown>,
  "builtin:master-agent": masterAgentRuntimeRegistration as BlockRuntimeRegistration<unknown, unknown, unknown>,
  "builtin:operating-chat-session": operatingChatRuntimeRegistration as BlockRuntimeRegistration<
    unknown,
    unknown,
    unknown
  >,
  ...builtinStaticRegistrations,
}

export function registrationFor(
  functionalityID: string,
): BlockRuntimeRegistration<unknown, unknown, unknown> | undefined {
  return BLOCK_REGISTRATIONS[functionalityID]
}
