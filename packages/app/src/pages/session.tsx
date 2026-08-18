import { createEffect, createMemo, ErrorBoundary, Show, type ParentProps } from "solid-js"
import { useLocation, useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { useServerSync } from "@/context/server-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { ModelsProvider } from "@/context/models"
import { useTabs } from "@/context/tabs"
import { useSettings } from "@/context/settings"
import { useNotification } from "@/context/notification"
import type { ServerConnection } from "@/context/server"
import { useSettingsCommand } from "@/components/settings-dialog"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import { ErrorPage } from "@/pages/error"
import { createSessionLineage } from "@/pages/session/session-lineage"
import { useUsageExceededDialogs } from "@/pages/session/usage-exceeded-dialogs"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import {
  SessionErrorFallback,
  SessionPanelFrame,
  SessionRouteFrame,
  SessionSurfaceBase,
} from "@/pages/session-surface-base"

// Routed adapter over the route-independent surface. Owns every piece of route
// state (params, search, hash navigation, parent-session links) and renders the
// same surface the route rendered before the extraction.
export function SessionPage() {
  const params = useParams<{ id?: string; serverKey?: string }>()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const sdk = useSDK()

  return (
    <>
      <RoutedSurfaceDialogs />
      <SessionSurfaceBase
        target={{ sessionID: params.id }}
        initialPrompt={searchParams.prompt}
        onInitialPromptConsumed={() => setSearchParams({ ...searchParams, prompt: undefined })}
        routing={{
          hash: () => location.hash,
          href: () => location.pathname + location.search,
          navigate,
          openParent: (parentID) => {
            navigate(
              params.serverKey
                ? sessionHref(requireServerKey(params.serverKey), parentID)
                : legacySessionHref(sdk().directory, parentID),
            )
          },
        }}
      />
    </>
  )
}

function RoutedSurfaceDialogs() {
  useUsageExceededDialogs()
  return null
}

// Rendered under app.tsx's TargetSessionRoute, which owns the per-server keyed
// remount around the server-scoped providers. Nothing here may key on the
// session ID: session tabs on the same server share this route instance, and
// workspace-scoped state (terminal, directory providers) lives below.
export function TargetSessionRouteContent() {
  const params = useParams<{ serverKey: string; id: string }>()
  const serverSync = useServerSync()
  const directory = createMemo(() => serverSync().session.lineage.peek(params.id)?.session.directory)
  return (
    // Settings must keep the target-server SDK, sync, and models context and remain registered
    // when session content falls back to the route error boundary.
    <TargetServerScopedProviders directory={directory} sessionID={() => params.id}>
      <TargetSessionSettingsCommand />
      <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)} padded>
        <ResolvedTargetSessionRoute />
      </SessionRouteErrorBoundary>
    </TargetServerScopedProviders>
  )
}

function TargetSessionSettingsCommand() {
  useSettingsCommand()
  return null
}

export function SessionRouteErrorBoundary(
  props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key; padded?: boolean }>,
) {
  const settings = useSettings()
  return (
    <ErrorBoundary
      fallback={(error) =>
        settings.general.newLayoutDesigns() ? (
          <SessionRouteFrame padded={props.padded}>
            <SessionPanelFrame newLayout raised={!!props.sessionID}>
              <SessionErrorFallback error={error} sessionID={props.sessionID} serverKey={props.serverKey} />
            </SessionPanelFrame>
          </SessionRouteFrame>
        ) : (
          <ErrorPage error={error} />
        )
      }
    >
      {props.children}
    </ErrorBoundary>
  )
}

function ResolvedTargetSessionRoute() {
  const params = useParams<{ serverKey: string; id: string }>()
  const tabs = useTabs()
  const sync = useServerSync()
  const serverKey = createMemo(() => requireServerKey(params.serverKey))
  const current = createSessionLineage(
    () => params.id,
    () => sync().session.lineage,
  )
  const directory = createMemo(() => current()?.session.directory)
  const targetDirectory = () => directory()!

  createEffect(() => {
    const session = current()
    if (!session) return
    tabs.addSessionTab({
      server: serverKey(),
      sessionId: session.root.id,
    })
  })

  return (
    // Non-keyed: closes only while the target's directory is unknown (uncached
    // lineage mid-resolution), which tears down the workspace subtree including
    // the terminal. Same-workspace tab switches keep it open because warm
    // targets resolve synchronously from the sync cache.
    <Show when={directory()}>
      <SDKProvider directory={targetDirectory}>
        <DirectoryDataProvider directory={targetDirectory} server={serverKey}>
          <TargetSessionPage />
        </DirectoryDataProvider>
      </SDKProvider>
    </Show>
  )
}

// Owns the workspace-identity remount. Must not include the session ID in the
// key: SessionPage handles session changes reactively, and remounting here
// destroys workspace-scoped state (terminal PTYs, file/prompt providers).
function TargetSessionPage() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  return (
    <Show when={`${serverSDK().scope}\0${sdk().directory}`} keyed>
      <SessionPage />
    </Show>
  )
}

function TargetServerScopedProviders(
  props: ParentProps<{ directory?: () => string | undefined; sessionID?: () => string | undefined }>,
) {
  return (
    <>
      <MarkSessionNotificationsViewed sessionID={props.sessionID} />
      <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
    </>
  )
}

function MarkSessionNotificationsViewed(props: { sessionID?: () => string | undefined }) {
  const notification = useNotification()
  createEffect(() => {
    const sessionID = props.sessionID?.()
    if (!notification.ready() || !sessionID) return
    if (notification.session.unseenCount(sessionID) === 0) return
    notification.session.markViewed(sessionID)
  })
  return null
}
