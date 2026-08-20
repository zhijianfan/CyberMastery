// Canvas diagnostics for the block-runtime-v3 host boundary. Reports the NEW
// runtime state (per-block registration mode + workspace) instead of the old
// per-adapter registry. JSON-able and non-throwing.

export type RegistrationMode = "native" | "local" | "none"

export interface CanvasBlockDiagnostics {
  blockID: string
  functionalityID: string
  registrationMode: RegistrationMode
  hostStatus?: string
  localViewKeys: string[]
}

export interface CanvasWorkspaceDiagnostics {
  id?: string
  epoch: number
  connected: boolean
  dirty: boolean
}

export interface CanvasDiagnosticsSource {
  blocks: () => Array<{
    id: string
    type: string
  }>
  functionalityIDFor: (type: string) => string
  registrationModeFor: (blockID: string, functionalityID: string) => RegistrationMode
  hostStatusFor?: (blockID: string) => string | undefined
  localViewKeysFor?: (blockID: string) => string[]
  workspace: {
    id?: () => string | undefined
    epoch: () => number
    connected: () => boolean
    dirty: () => boolean
  }
}

export interface CanvasDiagnostics {
  workspace: CanvasWorkspaceDiagnostics
  blocks: CanvasBlockDiagnostics[]
}

export function collectCanvasDiagnostics(source?: CanvasDiagnosticsSource): CanvasDiagnostics {
  // No-args fallback: read the canvas integration globals (mounted by
  // workspace.tsx) so the dev overlay keeps working without a source.
  if (!source) {
    const state = (globalThis as {
      __CANVAS_INTEGRATION_STATE__?: {
        blocks: Array<{ id: string; type: string }>
      }
    }).__CANVAS_INTEGRATION_STATE__

    const blocks = state?.blocks ?? []
    return {
      workspace: { epoch: 0, connected: false, dirty: false },
      blocks: blocks.map((block) => ({
        blockID: block.id,
        functionalityID: block.type,
        registrationMode: "none",
        localViewKeys: [],
      })),
    }
  }

  return {
    workspace: {
      id: source.workspace.id?.(),
      epoch: source.workspace.epoch(),
      connected: source.workspace.connected(),
      dirty: source.workspace.dirty(),
    },
    blocks: source.blocks().map((block) => {
      const functionalityID = source.functionalityIDFor(block.type)
      return {
        blockID: block.id,
        functionalityID,
        registrationMode: source.registrationModeFor(block.id, functionalityID),
        hostStatus: source.hostStatusFor?.(block.id),
        localViewKeys: source.localViewKeysFor?.(block.id) ?? [],
      }
    }),
  }
}

export function renderCanvasDiagnostics(diagnostics: CanvasDiagnostics | undefined = collectCanvasDiagnostics()): string {
  if (!import.meta.env.DEV) return ""
  const workspace = diagnostics.workspace
  const lines = [
    `workspace: ${workspace.id ?? "(local)"} epoch=${workspace.epoch} connected=${workspace.connected} dirty=${workspace.dirty}`,
    `blocks (${diagnostics.blocks.length}):`,
  ]
  for (const block of diagnostics.blocks) {
    lines.push(
      `  ${block.blockID} [${block.functionalityID}] mode=${block.registrationMode}` +
        `${block.hostStatus ? ` status=${block.hostStatus}` : ""}` +
        `${block.localViewKeys.length ? ` view={${block.localViewKeys.join(",")}}` : ""}`,
    )
  }
  return lines.join("\n")
}
