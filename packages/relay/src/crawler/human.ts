const LCG_MODULUS = 0x100000000
const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223

export function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS
    return state / LCG_MODULUS
  }
}

export function jitter(base: number, spread: number, random: () => number = Math.random): number {
  const noise = random() + random() + random() - 1.5
  return Math.max(20, base + noise * spread)
}

const MAX_CHUNK = 40

const PUNCTUATION = new Set([",", ".", "!", "?", ":", ";"])

export function clauseChunks(text: string): string[] {
  const chunks: string[] = []
  let current = ""
  let previous = ""
  for (const char of text) {
    if (char !== " " && char !== "\n") {
      const boundary = PUNCTUATION.has(previous) && char === " " && current.length > 0
      if (current.length + 1 > MAX_CHUNK || boundary) {
        chunks.push(current)
        current = ""
      }
      current += char
      previous = char
    } else {
      if (current.length + 1 > MAX_CHUNK && current.length > 0) {
        chunks.push(current)
        current = ""
      }
      current += char
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function typeDelaySequence(text: string, base = 45, spread = 25): number[] {
  const random = lcg(0xc0ffee)
  const delays: number[] = []
  for (let index = 0; index < text.length; index++) {
    delays.push(jitter(base, spread, random))
  }
  return delays
}

export function pausePlan(turns: number, secondsPerTurn = 4): number[] {
  const random = lcg(0xbeef)
  const base = secondsPerTurn * 1000
  const pauses: number[] = []
  for (let index = 1; index < turns; index++) {
    pauses.push(Math.max(1000, jitter(base, base / 2, random)))
  }
  return pauses
}
