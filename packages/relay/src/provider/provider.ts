import type { ChatCredentials, DeviceLogin } from "./oauth.js"
import type { ChatSession } from "./types.js"

// A chat provider for one platform: account authentication (OAuth, not a
// browser crawler) plus API message exchange. To support a new platform,
// implement this interface and register it in the server's provider picker.
export interface ChatProvider {
  readonly id: string
  /** Human link for the provider's chat surface (used as the fallback url). */
  readonly homeUrl: string

  /** Load the stored account credentials, if any. */
  restoreCredentials(): Promise<ChatCredentials | undefined>
  saveCredentials(credentials: ChatCredentials): Promise<void>
  clearCredentials(): Promise<void>

  /** Exchange a stored refresh token for fresh credentials. */
  refreshCredentials(credentials: ChatCredentials): Promise<ChatCredentials>

  /** Begin the account authorization flow. */
  startLogin(): Promise<DeviceLogin>

  /**
   * Open an API chat session authenticated with the given credentials. The
   * onRefresh callback refreshes and persists the credentials when the access
   * token expires mid-session; the session retries once with the fresh token.
   */
  openChat(options: {
    credentials: ChatCredentials
    onRefresh: (credentials: ChatCredentials) => Promise<ChatCredentials>
    context?: { conversationId?: string; parentMessageId?: string }
  }): Promise<ChatSession>
}
