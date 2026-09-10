import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { showToast } from "@/utils/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createEffect, createMemo, type Accessor, type Component, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
import { DialogCustomProvider } from "../dialog-custom-provider"
import { disconnectProvider } from "../provider-disconnect"
import { chatRelayError } from "@/pages/canvas/blocks/chat-relay/types"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

const PROVIDER_ICON_SIZE = 16

export const SettingsProvidersV2: Component<{
  directory: Accessor<string | undefined>
  onBack?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const providers = useProviders(() => undefined)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })
  const [chatRelay, setChatRelay] = createStore<{
    provider?: {
      id: "chatgpt"
      name: string
      status: "disconnected" | "opening" | "login-required" | "ready" | "error"
      error?: string
    }
    action?: "connect" | "open" | "refresh"
    error?: string
    attempted?: boolean
  }>({})

  let chatRelayServer: ReturnType<typeof serverSdk> | undefined
  let chatRelayGeneration = 0
  let disposed = false
  const refreshChatRelay = async (action: "connect" | "open" | "refresh" = "refresh") => {
    if (disposed || chatRelay.action) return
    const sdk = serverSdk()
    const generation = chatRelayGeneration
    setChatRelay({ action, error: undefined, attempted: true })
    const request =
      action === "connect"
        ? sdk.client.v2.chatProxy.connect({ throwOnError: true })
        : action === "open"
          ? sdk.client.v2.chatProxy.open({ throwOnError: true })
          : sdk.client.v2.chatProxy.status({ throwOnError: true })
    await request
      .then((response) => {
        if (disposed || generation !== chatRelayGeneration || chatRelayServer !== sdk) return
        setChatRelay("provider", response.data)
      })
      .catch((error: unknown) => {
        if (disposed || generation !== chatRelayGeneration || chatRelayServer !== sdk) return
        setChatRelay("error", chatRelayError(error))
      })
    if (disposed || generation !== chatRelayGeneration || chatRelayServer !== sdk) return
    setChatRelay("action", undefined)
  }

  let chatRelayPoll: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const sdk = serverSdk()
    const action = chatRelay.action
    if (chatRelayServer !== sdk) {
      chatRelayServer = sdk
      chatRelayGeneration += 1
      setChatRelay({ provider: undefined, action: undefined, error: undefined, attempted: false })
    }
    if (!chatRelay.provider && !action && !chatRelay.attempted && !chatRelay.error)
      queueMicrotask(() => void refreshChatRelay())
    clearTimeout(chatRelayPoll)
    chatRelayPoll = undefined
    if (action) return
    if (chatRelay.provider?.status !== "opening" && chatRelay.provider?.status !== "login-required") return
    chatRelayPoll = setTimeout(() => void refreshChatRelay(), 1000)
  })
  onCleanup(() => {
    disposed = true
    chatRelayGeneration += 1
    clearTimeout(chatRelayPoll)
  })

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider controller={providerConnect} />)
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) =>
    protocol() === "v1"
      ? source(item) !== "env"
      : serverSync().data.provider.connection?.get(item.id)?.type === "credential" && !isConfigCustom(item.id)

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    if (protocol() !== "v1") return
    const before = serverSync().data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    serverSync().set("config", "disabled_providers", next)

    await serverSync()
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        serverSync().set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    const currentProtocol = protocol()
    if (!currentProtocol) return
    if (currentProtocol === "v1" && isConfigCustom(providerID)) {
      await serverSdk()
        .client.auth.remove({ providerID })
        .catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await disconnectProvider({
      protocol: currentProtocol,
      providerID,
      connection: serverSync().data.provider.connection?.get(providerID),
      removeCredential: (credentialID) => serverSdk().api.credential.remove({ credentialID }),
      removeLegacy: (id) => serverSdk().client.auth.remove({ providerID: id }),
      disposeLegacy: () => serverSdk().client.global.dispose(),
    })
      .then(async (disconnected) => {
        if (!disconnected) return
        if (currentProtocol === "v2")
          await serverSync()
            .refreshProviders()
            .catch(() => undefined)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.providers.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers">
        <div class="settings-v2-section" data-component="chat-relay-handoff-section">
          <h3 class="settings-v2-section-title">{language.t("settings.providers.chatRelay.title")}</h3>
          <SettingsListV2>
            <div class="settings-v2-provider-row">
              <div class="settings-v2-provider-copy">
                <div class="settings-v2-provider-main">
                  <span class="settings-v2-provider-name">{language.t("settings.providers.chatRelay.provider")}</span>
                  <Show when={chatRelay.provider}>
                    {(provider) => <Tag>{language.t(`settings.providers.chatRelay.status.${provider().status}`)}</Tag>}
                  </Show>
                </div>
                <p class="settings-v2-provider-description">{language.t("settings.providers.chatRelay.description")}</p>
                <Show
                  when={chatRelay.provider?.status === "opening" || chatRelay.provider?.status === "login-required"}
                >
                  <p class="settings-v2-provider-description">
                    {language.t("settings.providers.chatRelay.loginInstruction")}
                  </p>
                </Show>
                <Show when={chatRelay.error ?? chatRelay.provider?.error}>
                  {(error) => <p class="settings-v2-provider-description text-critical-base">{error()}</p>}
                </Show>
              </div>
              <div class="settings-v2-provider-main">
                <Show
                  when={chatRelay.provider?.status === "opening" || chatRelay.provider?.status === "login-required"}
                >
                  <ButtonV2
                    size="normal"
                    variant="ghost-muted"
                    data-action="settings-chat-relay-refresh"
                    disabled={!!chatRelay.action}
                    onClick={() => void refreshChatRelay()}
                  >
                    {language.t("settings.providers.chatRelay.refresh")}
                  </ButtonV2>
                </Show>
                <Show
                  when={chatRelay.provider && chatRelay.provider.status !== "disconnected"}
                  fallback={
                    <ButtonV2
                      size="normal"
                      variant="neutral"
                      data-action={chatRelay.error ? "settings-chat-relay-retry" : "settings-chat-relay-connect"}
                      disabled={!!chatRelay.action}
                      onClick={() => void refreshChatRelay(chatRelay.error ? "refresh" : "connect")}
                    >
                      {language.t(
                        chatRelay.action
                          ? "settings.providers.chatRelay.working"
                          : chatRelay.error
                            ? "settings.providers.chatRelay.retry"
                            : "settings.providers.chatRelay.connect",
                      )}
                    </ButtonV2>
                  }
                >
                  <ButtonV2
                    size="normal"
                    variant="neutral"
                    data-action="settings-chat-relay-open"
                    disabled={!!chatRelay.action}
                    onClick={() => void refreshChatRelay("open")}
                  >
                    {language.t(
                      chatRelay.action ? "settings.providers.chatRelay.working" : "settings.providers.chatRelay.open",
                    )}
                  </ButtonV2>
                </Show>
              </div>
            </div>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section" data-component="connected-providers-section">
          <h3 class="settings-v2-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsListV2>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="settings-v2-provider-empty">{language.t("settings.providers.connected.empty")}</div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="settings-v2-provider-row group">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name truncate">{item.name}</span>
                        <Tag>{type(item)}</Tag>
                      </div>
                    </div>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="settings-v2-provider-env-hint">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void disconnect(item.id, item.name)}>
                        {language.t("common.disconnect")}
                      </ButtonV2>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.providers.section.popular")}</h3>
          <SettingsListV2>
            <For each={popular()}>
              {(item) => (
                <div class="settings-v2-provider-row">
                  <div class="settings-v2-provider-lead">
                    <ProviderIcon
                      id={item.id}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-v2-provider-icon shrink-0"
                    />
                    <div class="settings-v2-provider-copy">
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name">{item.name}</span>
                        <Show when={item.id === "opencode" || item.id === "opencode-go"}>
                          <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-v2-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                  </div>
                  <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                    {language.t("common.connect")}
                  </ButtonV2>
                </div>
              )}
            </For>

            <Show when={protocol() === "v1"}>
              <div class="settings-v2-provider-row" data-component="custom-provider-section">
                <div class="settings-v2-provider-lead">
                  <ProviderIcon
                    id="synthetic"
                    width={PROVIDER_ICON_SIZE}
                    height={PROVIDER_ICON_SIZE}
                    class="settings-v2-provider-icon shrink-0"
                  />
                  <div class="settings-v2-provider-copy">
                    <div class="settings-v2-provider-main">
                      <span class="settings-v2-provider-name">{language.t("provider.custom.title")}</span>
                      <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                    </div>
                    <p class="settings-v2-provider-description">
                      {language.t("settings.providers.custom.description")}
                    </p>
                  </div>
                </div>
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  icon="plus"
                  onClick={() => {
                    dialog.show(() => <DialogCustomProvider onBack={dialog.close} />)
                  }}
                >
                  {language.t("common.connect")}
                </ButtonV2>
              </div>
            </Show>
          </SettingsListV2>

          <button type="button" class="settings-v2-providers-view-all" onClick={() => connect()}>
            {language.t("dialog.provider.viewAll")}
          </button>
        </div>
      </div>
    </>
  )
}
