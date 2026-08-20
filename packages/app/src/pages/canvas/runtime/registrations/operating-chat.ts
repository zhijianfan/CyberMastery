import {
  appendExchange,
  defaultOperatingLayers,
  type OperatingExchange,
  type OperatingLayer,
} from "../../editor/operating-context"

// The packet inlines `tail` as part of the operating-context domain logic, but
// the canonical `./editor/operating-context` does not export it. Local stand-in:
// the operational layer holds the tail (last line) of the recorded text.
export function tail(text: string): string {
  return text.split(/\r?\n/).at(-1) ?? text
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

// Local mirrors of the S0 frozen contract. The packet does not name the
// canonical runtime module; these keep the registration self-contained and
// structurally compatible with the frozen `BlockRuntimeRegistration`.
interface BlockLocalViewStore {
  read<T>(blockID: string): T | undefined
  write(blockID: string, value: Record<string, unknown>): void
}

interface BlockRuntimeServices {
  localView: BlockLocalViewStore
}

type BlockRuntimeMode = "native" | "projected" | "local" | "static"

interface BlockRuntimeRegistration<TResolved, TView, TCommand> {
  functionalityID: string
  mode: BlockRuntimeMode
  resolve(input: {
    workspaceID: string
    block: { id: string; functionalityID: string }
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<TResolved>
  select(input: {
    resolved: TResolved
    projection: unknown
    localView: unknown
  }): TView
  dispatch?(input: {
    resolved: TResolved
    command: TCommand
    services: BlockRuntimeServices
    signal: AbortSignal
  }): Promise<void>
  dispose?(resolved: TResolved): void
}

export const operatingChatRuntimeRegistration = {
  functionalityID: "builtin:operating-chat",
  mode: "local",
  async resolve(input: {
    workspaceID: string
    block: OperatingChatBlockDescriptor
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
} satisfies BlockRuntimeRegistration<
  OperatingChatResolved,
  OperatingChatView,
  OperatingChatCommand
>