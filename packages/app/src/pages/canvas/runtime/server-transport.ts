import type { ServerSDK } from "@/context/server-sdk"
import type { Accessor } from "solid-js"
import type { ChatRelayRuntimeContext } from "../blocks/chat-relay/runtime"
import type { ChatRelayCommand, RuntimeEventEnvelope, RuntimeResourceBinding, RuntimeSnapshot, RuntimeResourceState } from "../blocks/chat-relay/types"

export type ServerSDKGetter = Accessor<ServerSDK>

// Real BlockRuntimeContext over the OpenCode-native block-runtime endpoints
// (POST /api/block-runtime/snapshot + GET /api/block-runtime/event SSE).
// Command dispatch to the Track C server adapter (OpencodeChat) is the
// documented integration follow-up; the legacy path stays the default until
// then (see H's fallback policy).
export const createServerBlockRuntimeContext = (sdk: ServerSDKGetter): ChatRelayRuntimeContext => ({
  async snapshot(bindings: RuntimeResourceBinding[] = []) {
    const result = await sdk().client.v2.blockRuntime.snapshot({ bindings }, { throwOnError: true })
    return { cursor: result.data.cursor, state: result.data.state as RuntimeResourceState } satisfies RuntimeSnapshot<RuntimeResourceState>
  },
  subscribe(bindings: RuntimeResourceBinding[], cursor: string, onEvent: (event: RuntimeEventEnvelope) => void) {
    let cancelled = false
    void (async () => {
      try {
        const iterable = await sdk().client.v2.blockRuntime.subscribe({ bindings, cursor })
        for await (const event of iterable.stream) {
          if (cancelled) break
          onEvent(event as RuntimeEventEnvelope)
        }
      } catch {
        // stream closed/aborted — the view keeps its last snapshot
      }
    })()
    return () => {
      cancelled = true
    }
  },
  async sendCommand(command: ChatRelayCommand) {
    throw new Error(
      `sendCommand(${command.type}): command dispatch routes through the Track C OpencodeChat adapter — integration follow-up; use the legacy path for sends`,
    )
  },
})
