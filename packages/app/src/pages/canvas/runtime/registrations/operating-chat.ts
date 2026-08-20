import {
  appendExchange,
  defaultOperatingLayers,
  type OperatingExchange,
  type OperatingLayer,
} from "../../editor/operating-context"
import type {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
} from "../contracts"

// The canonical `./editor/operating-context` does not export a tail helper.
// Single source of truth for the operating layer's "tail" of the recorded
// text — matches the live workspace UI semantics (whitespace-compacted,
// truncated preview). workspace.tsx imports this instead of a local copy.
export function tail(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact
}

export type OperatingChatBlockDescriptor = {
  id: string
  functionalityID: "builtin:operating-chat"
}

export interface OperatingChatView {
  history: OperatingExchange[]
  layers: OperatingLayer[]
}

export type OperatingChatCommand =
  | { type: "append-exchange"; role: "user" | "assistant"; text: string }
  | { type: "set-custom-layer"; text: string }

interface OperatingChatLocalView {
  history?: OperatingExchange[]
  layers?: OperatingLayer[]
}

interface OperatingChatResolved {
  blockID: string
  state: OperatingChatLocalView
  dispose: () => void
}

export const operatingChatRuntimeRegistration: BlockRuntimeRegistration<
  OperatingChatResolved,
  OperatingChatView,
  OperatingChatCommand
> = {
  functionalityID: "builtin:operating-chat",
  mode: "local",
  async resolve(input: {
    workspaceID: string
    block: CanvasBlockDescriptor
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<OperatingChatResolved> {
    const state =
      input.services.localView.read<OperatingChatLocalView>(input.block.id) ?? {
        history: [],
        layers: defaultOperatingLayers(),
      }
    let disposed = false
    return {
      blockID: input.block.id,
      state,
      dispose() {
        if (disposed) return
        disposed = true
      },
    }
  },
  select(input: {
    resolved: OperatingChatResolved
    projection: unknown
    localView: unknown
  }): OperatingChatView {
    const stored =
      input.resolved.state ?? (input.localView as OperatingChatLocalView | undefined)
    return {
      history: stored.history ?? [],
      layers: stored.layers ?? defaultOperatingLayers(),
    }
  },
  async dispatch(input: {
    resolved: OperatingChatResolved
    command: OperatingChatCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<void> {
    const { resolved, command, services } = input
    switch (command.type) {
      case "append-exchange": {
        const history = appendExchange(resolved.state.history ?? [], {
          role: command.role,
          text: command.text,
        })
        const layers = (resolved.state.layers ?? defaultOperatingLayers()).map((layer) =>
          layer.layer === "operational" ? { ...layer, text: tail(command.text) } : layer,
        )
        resolved.state = { history, layers }
        services.localView.write(resolved.blockID, { history })
        services.localView.write(resolved.blockID, { layers })
        return
      }
      case "set-custom-layer": {
        const layers = (resolved.state.layers ?? defaultOperatingLayers()).map((item) =>
          item.layer === "custom" ? { ...item, text: command.text } : item,
        )
        resolved.state = { ...resolved.state, layers }
        services.localView.write(resolved.blockID, { layers })
        return
      }
    }
  },
}
