import type { RuntimeProjectionPatch } from "./contracts"

type RuntimeResourceStatus =
  | "resolving"
  | "ready"
  | "stale"
  | "error"
  | "unavailable"
  | "permission-denied"

type RuntimeResourceEntry = {
  status: RuntimeResourceStatus
  value: unknown
  revision: number
  retainCount: number
  invalidationQueued: boolean
  invalidateHandlers: Set<() => void>
}

type RuntimeResourceSnapshot = {
  status: RuntimeResourceStatus
  value: unknown
  revision: number
}

type UnknownRecord = Record<string, unknown>

const isObject = (value: unknown): value is UnknownRecord => value !== null && typeof value === "object"

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const normalizeIndex = (segment: string): number | string => {
  const asNumber = Number(segment)
  return Number.isInteger(asNumber) && `${asNumber}` === segment ? asNumber : segment
}

const cloneContainer = (value: unknown) => {
  if (Array.isArray(value)) {
    return [...value]
  }
  if (isObject(value)) {
    return { ...value }
  }

  return {}
}

const getPathValue = (value: unknown, path: string[]): unknown => {
  if (path.length === 0) {
    return value
  }

  if (!isObject(value)) {
    return undefined
  }

  let current: unknown = value
  for (const segment of path) {
    const key = normalizeIndex(segment)
    if (Array.isArray(current)) {
      if (typeof key === "number") {
        current = current[key]
      } else {
        current = current[key as never]
      }
    } else if (isObject(current)) {
      current = current[key as string]
    } else {
      return undefined
    }

    if (current === undefined) {
      return undefined
    }
  }

  return current
}

const setPathValue = (value: unknown, path: string[], nextValue: unknown): unknown => {
  if (path.length === 0) {
    return nextValue
  }

  const [head, ...rest] = path
  const key = normalizeIndex(head)
  const current = cloneContainer(value)
  const next = getPathValue(current, [head])
  const updated = setPathValue(next, rest, nextValue)

  if (Array.isArray(current)) {
    const copy = current as unknown[]
    if (typeof key === "number") {
      copy[key] = updated
      return copy
    }

    copy[key as never] = updated
    return copy
  }

  const copy = current as UnknownRecord
  copy[key as string] = updated
  return copy
}

const removePathValue = (value: unknown, path: string[]): unknown => {
  if (path.length === 0) {
    return undefined
  }

  const [head, ...rest] = path
  const key = normalizeIndex(head)
  const current = cloneContainer(value)

  if (rest.length === 0) {
    if (Array.isArray(current)) {
      if (typeof key === "number") {
        const copy = current as unknown[]
        copy.splice(key, 1)
        return copy
      }
    } else {
      const copy = current as UnknownRecord
      delete copy[key as string]
    }

    return current
  }

  if (Array.isArray(current) && typeof key !== "number") {
    return value
  }

  if (Array.isArray(current)) {
    const array = current as unknown[]
    const child = array[key as number]
    array[key as number] = removePathValue(child, rest)
    return array
  }

  const copy = current as UnknownRecord
  const child = copy[key as string]
  copy[key as string] = removePathValue(child, rest)
  return copy
}

const parseRevision = (patch: RuntimeProjectionPatch): number | undefined => {
  if (!isObject(patch)) {
    return undefined
  }

  return isNumber((patch as UnknownRecord).revision) ? ((patch as UnknownRecord).revision as number) : undefined
}

const parseOperation = (patch: RuntimeProjectionPatch): "replace" | "merge" | "append" | "remove" => {
  if (!isObject(patch)) {
    return "replace"
  }

  const data = patch as UnknownRecord
  if (typeof data.type === "string") {
    if (data.type === "replace" || data.type === "merge" || data.type === "append" || data.type === "remove") {
      return data.type
    }
  }

  if (typeof data.op === "string") {
    if (data.op === "replace" || data.op === "merge" || data.op === "append" || data.op === "remove") {
      return data.op
    }
  }

  if ("replace" in data) {
    return "replace"
  }
  if ("merge" in data) {
    return "merge"
  }
  if ("append" in data) {
    return "append"
  }

  return "remove"
}

const getPatchPath = (patch: RuntimeProjectionPatch): string[] => {
  if (!isObject(patch)) {
    return []
  }

  const value = (patch as UnknownRecord).path
  if (typeof value !== "string") {
    return []
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? [] : trimmed.split(".")
}

const getPatchPayload = (patch: RuntimeProjectionPatch) => {
  const data = patch as UnknownRecord
  if (data === undefined || data === null) {
    return undefined
  }

  if ("value" in data) {
    return data.value
  }
  if ("replace" in data) {
    return data.replace
  }
  if ("merge" in data) {
    return data.merge
  }
  if ("append" in data) {
    return data.append
  }
  if ("items" in data) {
    return data.items
  }
  if ("remove" in data) {
    return data.remove
  }
  if ("data" in data) {
    return data.data
  }
  if ("payload" in data) {
    return data.payload
  }

  return undefined
}

const applyMerge = (base: unknown, payload: unknown) => {
  if (!isObject(base) || !isObject(payload) || Array.isArray(base) || Array.isArray(payload)) {
    return payload
  }

  return { ...base, ...payload }
}

const applyAppend = (base: unknown, payload: unknown) => {
  if (!Array.isArray(base)) {
    return [base, ...(Array.isArray(payload) ? payload : [payload])]
  }

  return [...base, ...(Array.isArray(payload) ? payload : [payload])]
}

const defaultEntry = (): RuntimeResourceEntry => ({
  status: "unavailable",
  value: undefined,
  revision: 0,
  retainCount: 0,
  invalidationQueued: false,
  invalidateHandlers: new Set(),
})

export const createRuntimeResourceStore = () => {
  const entries = new Map<string, RuntimeResourceEntry>()

  const getEntry = (key: string) => {
    const entry = entries.get(key)
    if (entry !== undefined) {
      return entry
    }

    const created = defaultEntry()
    entries.set(key, created)
    return created
  }

  const get = (key: string): RuntimeResourceSnapshot => {
    const entry = entries.get(key)
    if (entry === undefined) {
      return {
        status: "unavailable",
        value: undefined,
        revision: 0,
      }
    }

    return {
      status: entry.status,
      value: entry.value,
      revision: entry.revision,
    }
  }

  const upsert = (key: string, value: unknown, revision?: number) => {
    const entry = getEntry(key)
    entry.value = value
    if (revision !== undefined) {
      entry.revision = revision
    }
    entry.status = "ready"
  }

  const patch = (key: string, patchValue: RuntimeProjectionPatch) => {
    const entry = getEntry(key)
    const revision = parseRevision(patchValue)

    if (revision !== undefined && revision <= entry.revision) {
      return
    }

    const path = getPatchPath(patchValue)
    const operation = parseOperation(patchValue)
    const payload = getPatchPayload(patchValue)
    const target = getPathValue(entry.value, path)
    let nextValue: unknown

    if (operation === "replace") {
      nextValue = payload
    } else if (operation === "merge") {
      nextValue = applyMerge(target, payload)
    } else if (operation === "append") {
      nextValue = applyAppend(target, payload)
    } else {
      entry.value = removePathValue(entry.value, path)
    }

    if (operation !== "remove") {
      entry.value = path.length === 0 ? nextValue : setPathValue(entry.value, path, nextValue)
    }
    entry.status = "ready"
    if (revision !== undefined) {
      entry.revision = revision
    }
  }

  const setStatus = (key: string, status: RuntimeResourceStatus) => {
    const entry = getEntry(key)
    entry.status = status
  }

  const markStale = (key: string) => {
    const entry = getEntry(key)
    entry.status = "stale"
  }

  const invalidate = (key: string) => {
    const entry = getEntry(key)
    if (entry.invalidationQueued) {
      return
    }

    entry.invalidationQueued = true
    queueMicrotask(() => {
      const current = entries.get(key)
      if (current === undefined) {
        return
      }

      current.invalidationQueued = false
      for (const handler of current.invalidateHandlers) {
        handler()
      }
    })
  }

  const onInvalidate = (key: string, handler: () => void) => {
    const entry = getEntry(key)
    entry.invalidateHandlers.add(handler)
  }

  const retain = (key: string) => {
    const entry = getEntry(key)
    entry.retainCount = entry.retainCount + 1
  }

  const release = (key: string) => {
    const entry = entries.get(key)
    if (entry === undefined) {
      return
    }

    entry.retainCount = Math.max(0, entry.retainCount - 1)
    if (entry.retainCount === 0) {
      entries.delete(key)
    }
  }

  const dispose = () => {
    entries.clear()
  }

  return {
    upsert,
    patch,
    get,
    setStatus,
    markStale,
    invalidate,
    onInvalidate,
    retain,
    release,
    dispose,
  }
}
