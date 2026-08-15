export type OperatingLayerKey = "workspace" | "block" | "operational" | "custom"

export interface OperatingLayer {
  layer: OperatingLayerKey
  text: string
}

export interface OperatingExchange {
  index: number
  role: "user" | "assistant"
  text: string
  at: number
}

export const OPERATING_CONTEXT_LIMIT = 24

const BLOCK_CONTEXT =
  "This block is the workspace's OperatingChatSession. Every exchange is recorded into the " +
  "HistoricalContextStack and answered by the workspace's configured OperatingAgent model."

export function defaultOperatingLayers(): OperatingLayer[] {
  return [
    { layer: "workspace", text: "" },
    { layer: "block", text: BLOCK_CONTEXT },
    { layer: "operational", text: "" },
    { layer: "custom", text: "" },
  ]
}

export function compactSummary(exchanges: readonly OperatingExchange[], at: number): OperatingExchange {
  const body = exchanges.map((exchange) => `${exchange.role}: ${exchange.text}`).join(" ")
  return {
    index: exchanges[0]?.index ?? 0,
    role: "assistant",
    at,
    text: `[compacted] ${body}`,
  }
}

export function appendExchange(
  history: readonly OperatingExchange[],
  exchange: { role: "user" | "assistant"; text: string; at?: number },
  limit: number = OPERATING_CONTEXT_LIMIT,
): OperatingExchange[] {
  const entry: OperatingExchange = {
    index: (history.at(-1)?.index ?? 0) + 1,
    role: exchange.role,
    text: exchange.text,
    at: exchange.at ?? Date.now(),
  }
  if (history.length < limit) return [...history, entry]
  const drop = 2
  return [compactSummary(history.slice(0, drop), entry.at), ...history.slice(drop), entry]
}
