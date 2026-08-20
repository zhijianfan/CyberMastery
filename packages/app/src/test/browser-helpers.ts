export const CANVAS_DESCRIPTOR_STORAGE_KEY = "opencode-canvas-v1"
export const CANVAS_LOCAL_VIEW_STORAGE_KEY = "opencode.canvas.local-view.v1"
export const CANVAS_WORKSPACE_ID_STORAGE_KEY = "opencode.canvas.workspaceID.v1"

export interface CanvasDescriptorState {
  camera: { x: number; y: number; scale: number }
  editing: boolean
  blocks: Array<Record<string, unknown>>
}

export interface CanvasMountInput {
  children?: unknown
  blocks: Array<Record<string, unknown>>
  storageKey?: string
  descriptor?: { x?: number; y?: number; scale?: number; editing?: boolean }
}

export function seedCanvasDescriptor(
  blocks: Array<Record<string, unknown>>,
  key = CANVAS_DESCRIPTOR_STORAGE_KEY,
  options: { x?: number; y?: number; scale?: number; editing?: boolean } = {},
) {
  const payload: CanvasDescriptorState = {
    camera: { x: options.x ?? 0, y: options.y ?? 0, scale: options.scale ?? 1 },
    editing: options.editing ?? true,
    blocks,
  }
  localStorage.setItem(key, JSON.stringify(payload))
}

export function readCanvasDescriptor(key = CANVAS_DESCRIPTOR_STORAGE_KEY): CanvasDescriptorState | undefined {
  const raw = localStorage.getItem(key)
  if (!raw) return
  return JSON.parse(raw) as CanvasDescriptorState
}

export function readCanvasLocalViewState(key = CANVAS_LOCAL_VIEW_STORAGE_KEY) {
  const raw = localStorage.getItem(key)
  if (!raw) return undefined
  return JSON.parse(raw) as Record<string, unknown>
}

export function mountCanvasWithDescriptors(render: (children: unknown) => HTMLElement, input: CanvasMountInput) {
  const { blocks, storageKey = CANVAS_DESCRIPTOR_STORAGE_KEY, children = undefined, descriptor } = input
  seedCanvasDescriptor(blocks, storageKey, descriptor)
  return render(children)
}

export function flushMicrotasks() {
  return new Promise<void>((resolve) => queueMicrotask(resolve))
}

export function flushAnimationFrame() {
  if (typeof requestAnimationFrame !== "function") {
    return flushMicrotasks()
  }
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

export async function flushRenderScheduler(iterations = 2) {
  for (let index = 0; index < iterations; index += 1) {
    await flushMicrotasks()
    await flushAnimationFrame()
  }
}

export async function waitFor(
  check: () => boolean,
  options: { timeoutMs?: number; label?: string; iterations?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 2000
  const iterations = options.iterations ?? 40
  const start = Date.now()

  for (let index = 0; index < iterations; index += 1) {
    if (check()) return
    if (Date.now() - start > timeoutMs) break
    await flushRenderScheduler()
  }

  throw new Error(`timed out waiting for condition: ${options.label ?? "unknown"}`)
}

export function countPromptRequests<TArgs extends readonly unknown[]>(handler: (...args: TArgs) => Promise<unknown>) {
  let count = 0
  const calls: TArgs[] = []

  return {
    async wrapped(...args: TArgs) {
      count += 1
      calls.push(args)
      return handler(...args)
    },
    count: () => count,
    calls: () => calls,
    clear() {
      count = 0
      calls.length = 0
    },
  }
}
