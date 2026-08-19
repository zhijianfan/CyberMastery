import { ChatRelayRuntimeAdapter } from "../blocks/chat-relay/runtime"
import { createBlockRuntimeRegistry } from "./registry"
import { createServerBlockRuntimeContext, type ServerSDKGetter } from "./server-transport"

// Dev opt-in bootstrap for the Block Runtime v2 path. Called once from the
// canvas mount when VITE_CYBERMASTER_BLOCK_RUNTIME_V2=true:
// - registers the ChatRelay adapter in the runtime registry,
// - injects the real server-backed context (snapshot + SSE) into the seams
//   the ChatRelay view reads (__CHAT_RELAY_RUNTIME_CONTEXT__,
//   __CHAT_RELAY_RUNTIME_V2__).
// Legacy path remains the default when the flag is unset.
export const enableChatRelayBlockRuntime = (sdk: ServerSDKGetter) => {
  const registry = createBlockRuntimeRegistry()
  registry.register("builtin:chat-relay", ChatRelayRuntimeAdapter as never)
  const context = createServerBlockRuntimeContext(sdk)
  const globals = globalThis as {
    __CHAT_RELAY_RUNTIME_CONTEXT__?: unknown
    __CHAT_RELAY_RUNTIME_V2__?: unknown
  }
  globals.__CHAT_RELAY_RUNTIME_CONTEXT__ = context
  globals.__CHAT_RELAY_RUNTIME_V2__ = true
  return () => {
    delete globals.__CHAT_RELAY_RUNTIME_CONTEXT__
    delete globals.__CHAT_RELAY_RUNTIME_V2__
  }
}
