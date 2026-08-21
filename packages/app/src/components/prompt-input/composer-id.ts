import { uuid } from "@/utils/uuid"

export function createCtxPackComposerIdentity(prefix: string) {
  const fallback = `composer-${uuid()}`
  return (sessionID: string | undefined): string =>
    sessionID ? `${prefix}-${sessionID}` : `${prefix}-${fallback}`
}
