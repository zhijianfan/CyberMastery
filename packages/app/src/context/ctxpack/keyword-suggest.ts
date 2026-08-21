/**
 * CtxPack keyword suggestions (U1).
 *
 * Deterministic, offline-only suggestion of keywords for a CtxPack draft
 * given the create-dialog title and the captured fragments. No network, no
 * model: tokens are ranked by title-first, then fragment frequency.
 */
import type { CapturedCtxPackFragment } from "./selection"

const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}._:\-]*/gu

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out",
  "has", "his", "its", "that", "this", "with", "from", "have", "will", "your", "they", "them", "then", "than",
  "what", "when", "where", "which", "while", "who", "why", "how", "into", "over", "under", "again", "about",
  "above", "after", "before", "between", "during", "other", "some", "such", "only", "very", "just", "more", "most",
  "been", "being", "does", "doing", "done", "each", "every", "few", "many", "much", "must", "same", "should",
  "could", "would", "there", "their",
])

function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? []
}

function isShortToken(token: string): boolean {
  return [...token].length < 3
}

function hasDigitOrSymbol(token: string): boolean {
  return /[\d._:\-]/.test(token)
}

/**
 * Suggests at most 8 keywords: title tokens first (first-seen order), then
 * fragment tokens ranked by frequency across fragments (count desc,
 * first-seen asc). Dedupe is case-insensitive; the first display form wins.
 */
export function suggestCtxPackKeywords(input: { title: string; fragments: readonly CapturedCtxPackFragment[] }): string[] {
  const { title, fragments } = input

  const seen = new Set<string>()
  const ranked: string[] = []

  const consider = (token: string): boolean => {
    const key = token.toLowerCase()
    if (seen.has(key)) return false
    if (isShortToken(token) && !hasDigitOrSymbol(token)) return false
    if (STOP_WORDS.has(key)) return false
    seen.add(key)
    ranked.push(token)
    return true
  }

  for (const token of tokenize(title)) consider(token)

  // Fragment tokens: count across all fragments, first-seen position for ties.
  const frequency = new Map<string, { count: number; firstSeen: number; form: string }>()
  let index = 0
  for (const fragment of fragments) {
    for (const token of tokenize(fragment.text)) {
      const key = token.toLowerCase()
      if (!seen.has(key) && !(isShortToken(token) && !hasDigitOrSymbol(token)) && !STOP_WORDS.has(key)) {
        const entry = frequency.get(key)
        if (entry) entry.count += 1
        else frequency.set(key, { count: 1, firstSeen: index, form: token })
      }
      index += 1
    }
  }

  const byFrequency = [...frequency.values()].sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen)
  for (const entry of byFrequency) {
    if (ranked.length >= 8) break
    consider(entry.form)
  }

  return ranked.slice(0, 8)
}
