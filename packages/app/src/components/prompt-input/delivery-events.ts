export type PromptDeliveryEvent = {
  status: "sending" | "failed"
  directory: string
  sessionID: string
  messageID: string
  message: string
  error?: string
}

const listeners = new Set<(event: PromptDeliveryEvent) => void>()

export function emitPromptDelivery(event: PromptDeliveryEvent) {
  listeners.forEach((listener) => listener(event))
}

export function subscribePromptDelivery(listener: (event: PromptDeliveryEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
