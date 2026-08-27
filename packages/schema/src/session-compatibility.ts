export * as SessionCompatibility from "./session-compatibility"

import { SessionV1 } from "./session-v1"

export const LegacyPartFamilies = [
  "text",
  "file",
  "agent",
  "reasoning",
  "tool",
  "step-start",
  "step-finish",
] as const

export type LegacyPartFamily = (typeof LegacyPartFamilies)[number]

export interface LegacyPartIDInput {
  readonly messageID: string
  readonly ordinal: number
  readonly family: LegacyPartFamily
  readonly key: string
}

const familyCode: Record<LegacyPartFamily, string> = {
  text: "t",
  file: "f",
  agent: "a",
  reasoning: "r",
  tool: "o",
  "step-start": "s",
  "step-finish": "e",
}

const maxArrayIndex = 2 ** 32 - 2
const encoder = new TextEncoder()

/**
 * Creates a stable, source-order-readable PartID for legacy projections.
 * The digest covers the complete tuple, so the readable prefix is never an
 * encoding of a caller-controlled source ID.
 */
export async function legacyPartID(input: LegacyPartIDInput): Promise<SessionV1.PartID> {
  if (
    !Number.isSafeInteger(input.ordinal) ||
    input.ordinal < 0 ||
    input.ordinal > maxArrayIndex ||
    String(input.ordinal) !== String(Math.trunc(input.ordinal))
  ) {
    throw new RangeError("legacyPartID ordinal must be a non-negative JavaScript array index")
  }

  const ordinal = String(input.ordinal)
  const ordinalKey = String(ordinal.length).padStart(2, "0") + ordinal
  const bytes = encodeTuple(["opencode/session/legacy-part/v1", input.messageID, ordinal, input.family, input.key])
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  const binary = Array.from(digest, (byte) => String.fromCharCode(byte)).join("")
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
  return SessionV1.PartID.make(`prt_${ordinalKey}_${familyCode[input.family]}_${encoded}`)
}

function encodeTuple(values: readonly string[]) {
  const chunks = values.map((value) => encoder.encode(value))
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + 8 + chunk.length, 0))
  const view = new DataView(result.buffer)
  let offset = 0
  for (const chunk of chunks) {
    view.setBigUint64(offset, BigInt(chunk.length))
    offset += 8
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
