import type { BlockRuntimeAdapter, BlockDescriptor } from "./types"

type AnyBlockRuntimeAdapter = BlockRuntimeAdapter<BlockDescriptor, unknown, unknown>

export interface BlockRuntimeRegistry {
  register<TDescriptor extends BlockDescriptor, TView, TCommand>(
    functionalityID: TDescriptor["functionalityID"],
    adapter: BlockRuntimeAdapter<TDescriptor, TView, TCommand>,
  ): void
  resolve(functionalityID: string): AnyBlockRuntimeAdapter | undefined
  registered(functionalityID: string): boolean
}

export const createBlockRuntimeRegistry = (): BlockRuntimeRegistry => {
  const adapters = new Map<string, AnyBlockRuntimeAdapter>()

  return {
    register: (functionalityID, adapter) => {
      adapters.set(functionalityID, adapter)
    },
    resolve: (functionalityID) => adapters.get(functionalityID),
    registered: (functionalityID) => adapters.has(functionalityID),
  }
}
