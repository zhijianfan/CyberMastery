import type { FilePart, Project, UserMessage, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/core/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createQuery, skipToken, useMutation, useQueryClient } from "@tanstack/solid-query"
import {
  batch,
  ErrorBoundary,
  onCleanup,
  Suspense,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  createSignal,
  on,
  onMount,
  type ParentProps,
  untrack,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { debounce } from "@solid-primitives/scheduled"
import { useLocal } from "@/context/local"
import { FileProvider, selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import type { SessionReviewLineComment } from "@opencode-ai/session-ui/session-review"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Select } from "@opencode-ai/ui/select"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode-ai/ui/scroll-view"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@/utils/toast"
import { base64Encode, checksum } from "@opencode-ai/core/util/encode"
import { NewSessionView, SessionHeader } from "@/components/session"
import { ErrorPage } from "@/pages/error"
import { CommentsProvider, useComments } from "@/context/comments"
import { useCommand } from "@/context/command"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { PromptProvider, usePrompt } from "@/context/prompt"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { TerminalProvider, useTerminal } from "@/context/terminal"
import { PromptInput } from "@/components/prompt-input"
import { PromptInputV2Composer, usePromptInputV2Controller } from "@/components/prompt-input-v2"
import { setCursorPosition } from "@/components/prompt-input/editor-dom"
import { promptLength } from "@/components/prompt-input/history"
import {
  createPromptInputController,
  createSessionComposerController,
  createSessionComposerRegionController,
  SessionComposerRegion,
} from "@/pages/session/composer"
import { createOpenReviewFile, createSessionTabs, createSizing, shouldShowFileTree } from "@/pages/session/helpers"
import { MessageTimeline } from "@/pages/session/timeline/message-timeline"
import { createTimelineModel } from "@/pages/session/timeline/model"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { restorePromptModel, syncPromptModel, syncSessionModel } from "@/pages/session/session-model-helpers"
import {
  clampSessionPanelWidth,
  SESSION_PANEL_WIDTH_MIN,
  sessionPanelWidthMax,
} from "@/pages/session/session-panel-width"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { sessionPanelLayout } from "@/pages/session/session-panel-layout"
import { sessionSurfaceDesktop } from "@/pages/session/session-surface-layout"
import { SessionReviewEmptyChangesV2 } from "@opencode-ai/session-ui/v2/session-review-empty-changes-v2"
import { SessionReviewEmptyNoGitV2 } from "@opencode-ai/session-ui/v2/session-review-empty-no-git-v2"
import { SessionReviewV2SidebarToggle } from "@opencode-ai/session-ui/v2/session-review-v2"
import { ReviewPanelV2 } from "@/pages/session/v2/review-panel-v2"
import { createReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import { reviewDiffDirectory, reviewDiffNeedsLoad, reviewRootDirectory } from "@/pages/session/v2/review-diff-kinds"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { TerminalPanelV2 } from "@/pages/session/terminal-panel-v2"
import { useComposerCommands } from "@/pages/session/use-composer-commands"
import { useSessionCommands, type SessionCommandContext } from "@/pages/session/use-session-commands"
import { diffs as list } from "@/utils/diffs"
import { extractPromptFromParts } from "@/utils/prompt"
import { formatServerError, isLocalSessionNotFoundError, isSessionNotFoundError } from "@/utils/server-errors"
import { createSessionOwnership } from "./session/session-ownership"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"
import { messageIdFromHash } from "./session/message-id-from-hash"

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"

import type { SessionSurfaceTarget } from "./canvas/session-target"

// U1 canonical session target (required sessionID), re-exported so this
// module keeps its public name while pointing at the single source of truth.
export type { SessionSurfaceTarget } from "./canvas/session-target"

// The base also hosts the new-session view (NewSessionView below), which
// mounts before any host session exists, so the mount target is widened to an
// explicit sessionID-less variant (directory/workspaceID still apply). A
// canonical target (required sessionID) is always used once a session is
// established (routed page, canvas surface).
export type SessionSurfaceBaseTarget =
  | SessionSurfaceTarget
  | { sessionID?: undefined; directory?: string; workspaceID?: string }

export interface SessionSurfaceRouting {
  hash: () => string | undefined
  href: () => string
  navigate: (to: string, options?: { replace?: boolean }) => void
  openParent?: (parentID: string) => void
}

export interface SessionSurfaceBaseProps {
  target: SessionSurfaceBaseTarget
  surfaceID?: string
  focused?: boolean
  commands?: boolean
  queueEnabled?: boolean
  onFocus?: () => void
  onRequestOpenFullPage?: () => void
  initialPrompt?: string
  onInitialPromptConsumed?: () => void
  routing?: SessionSurfaceRouting
}

const sessionViewState = () => ({
  messageId: undefined as string | undefined,
  mobileTab: "session" as "session" | "changes",
})

function isCurrentSessionNotFoundError(error: unknown, sessionID: string | undefined) {
  if (!sessionID) return false
  return isSessionNotFoundError(error, sessionID) || isLocalSessionNotFoundError(error, sessionID)
}

async function runPromptRollbackMutation<T, R>(input: {
  capturePrompt: () => { current: () => T[]; set: (value: T[]) => void; reset: () => void }
  optimistic: (prompt: { set: (value: T[]) => void; reset: () => void }) => void
  request: () => Promise<R>
  complete: (result: R) => void
  rollback: () => void
  fail: (error: unknown) => void
}) {
  const prompt = input.capturePrompt()
  const previous = prompt.current().slice()
  batch(() => input.optimistic(prompt))
  await input
    .request()
    .then(input.complete)
    .catch((error) => {
      batch(() => {
        input.rollback()
        prompt.set(previous)
      })
      input.fail(error)
    })
}

export function SessionSurfaceBase(props: SessionSurfaceBaseProps) {
  return (
    <SessionProviders>
      <SessionSurfaceContent {...props} />
    </SessionProviders>
  )
}

export function SessionErrorFallback(props: { error: unknown; sessionID?: string; serverKey?: ServerConnection.Key }) {
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()
  const displayServer = createMemo(() => {
    const key = props.serverKey ?? server.key
    const conn = server.list.find((item) => ServerConnection.key(item) === key)
    return conn ? serverName(conn) : key
  })
  const closeTab = () => {
    if (!props.sessionID) return
    tabs.removeSessionTab({ server: props.serverKey ?? server.key, sessionId: props.sessionID })
  }
  if (isCurrentSessionNotFoundError(props.error, props.sessionID)) {
    return (
      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
          <div class="flex flex-col items-center gap-2">
            <div class="text-16-medium text-text max-w-md">{language.t("session.error.notFound")}</div>
            <div class="text-13-regular text-text-weak max-w-md">
              {language.t("session.error.notFound.description")}
            </div>
          </div>
          <Show when={props.sessionID}>
            {(sessionID) => (
              <div class="max-w-full flex flex-col items-center gap-1">
                <div class="max-w-full text-11-regular text-text-faint break-all">{displayServer()}</div>
                <code class="max-w-full rounded-[4px] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-text-base break-all bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)]">
                  {sessionID()}
                </code>
              </div>
            )}
          </Show>
          <ButtonV2 variant="neutral" size="normal" icon="xmark-small" onClick={closeTab}>
            {language.t("session.error.notFound.closeTab")}
          </ButtonV2>
        </div>
      </div>
    )
  }
  return <ErrorPage error={props.error} />
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

export function SessionRouteFrame(props: ParentProps<{ padded?: boolean }>) {
  return (
    <div class="relative size-full overflow-hidden flex flex-col" classList={{ "p-2": props.padded }}>
      {props.children}
    </div>
  )
}

export function SessionPanelFrame(props: ParentProps<{ newLayout: boolean; raised?: boolean }>) {
  return (
    <div
      classList={{
        "flex-1 min-h-0 flex flex-col": true,
        "bg-v2-background-bg-base": props.newLayout,
        "bg-background-stronger": !props.newLayout,
        "rounded-[10px] overflow-hidden": props.newLayout,
        "shadow-[var(--v2-elevation-raised)]": props.newLayout && props.raised,
      }}
    >
      {props.children}
    </div>
  )
}

function SurfaceCommands(props: { actions: SessionCommandContext }) {
  const language = useLanguage()
  const command = useCommand()
  useComposerCommands()
  useSessionCommands(props.actions)
  command.register("session-palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: () => command.trigger("file.open", "palette"),
    },
  ])
  return null
}

function SessionSurfaceContent(props: SessionSurfaceBaseProps) {
  const serverSync = useServerSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const platform = usePlatform()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()

  const sessionID = createMemo(() => props.target.sessionID)
  const focused = createMemo(() => props.focused ?? true)
  const scopedId = (part: string) => (props.surfaceID ? `session-surface-${props.surfaceID}-${part}` : undefined)
  const anchor = (id: string) => (props.surfaceID ? `session-message-${props.surfaceID}-${id}` : `message-${id}`)
  const hashAnchor = (id: string) => `message-${id}`

  const scope = createMemo(() => serverSDK().scope)
  const directory = createMemo(() => props.target.directory ?? sdk().directory)
  const workspaceKey = createMemo(() =>
    SessionStateKey.from(scope(), SessionRouteKey.fromRoute(base64Encode(directory()))),
  )
  const sessionKey = createMemo(() => {
    const key = SessionStateKey.from(scope(), SessionRouteKey.fromRoute(base64Encode(directory()), sessionID()))
    return props.surfaceID ? `${key}\u0000surface\u0000${props.surfaceID}` : key
  })
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))
  const view = createMemo(() => layout.view(sessionKey))
  const reviewMode = () => view().review.mode() ?? "git"
  const reviewFile = () => view().review.file()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const newSessionDesign = createMemo(() => settings.general.newLayoutDesigns())

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (sessionID()) return
      const text = props.initialPrompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      props.onInitialPromptConsumed?.()
    })
  })

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const composer = createSessionComposerController({ sessionID })
  const inputController = createPromptInputController({
    sessionKey,
    sessionID,
    queryOptions: serverSync().queryOptions,
  })

  const sessionPanelKey = createMemo(() =>
    sessionID() ? `${serverSDK().scope}\u0000${sessionID()}${props.surfaceID ? `\u0000surface\u0000${props.surfaceID}` : ""}` : undefined,
  )

  createEffect(
    on(
      sessionID,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }
        if (pending.scope !== serverSDK().scope) return

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== base64Encode(sdk().directory)) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const [panelRowWidth, setPanelRowWidth] = createSignal<number>()
  const viewportDesktop = createMediaQuery("(min-width: 768px)")
  const isDesktop = createMemo(() =>
    sessionSurfaceDesktop({
      embedded: !!props.surfaceID,
      containerWidth: panelRowWidth(),
      viewportDesktop: viewportDesktop(),
    }),
  )
  const size = createSizing()
  const desktopReviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const desktopV2ReviewOpen = createMemo(() => newSessionDesign() && desktopReviewOpen() && !!sessionID())
  const terminalOpen = createMemo(() => view().terminal.opened())
  const desktopTerminalOpen = createMemo(() => isDesktop() && terminalOpen())
  const desktopInlineTerminalOnlyOpen = createMemo(
    () => newSessionDesign() && desktopTerminalOpen() && !desktopV2ReviewOpen(),
  )
  const desktopFileTreeOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: settings.visibility.fileTree(),
        opened: layout.fileTree.opened(),
      }),
  )
  const desktopSessionResizeOpen = createMemo(() =>
    newSessionDesign() ? desktopV2ReviewOpen() || desktopTerminalOpen() : desktopReviewOpen(),
  )
  const desktopSidePanelOpen = createMemo(() => desktopSessionResizeOpen() || desktopFileTreeOpen())
  let panelRow: HTMLDivElement | undefined
  createResizeObserver(
    () => panelRow,
    ({ width }) => setPanelRowWidth(width),
  )
  const splitReview = createMemo(
    () => (newSessionDesign() ? desktopV2ReviewOpen() : desktopReviewOpen()) && layout.review.diffStyle() === "split",
  )
  const sessionPanelAvailable = createMemo(() => {
    const width = panelRowWidth()
    if (width === undefined) return undefined
    return width - (settings.general.newLayoutDesigns() ? 8 : 0)
  })
  const sessionPanelMax = createMemo(() => {
    const available = sessionPanelAvailable()
    if (available === undefined) return 1000
    return sessionPanelWidthMax({ available, split: splitReview() })
  })
  const sessionPanelResizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: layout.session.width(),
      available: sessionPanelAvailable(),
      split: splitReview(),
    }),
  )
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopSessionResizeOpen()) return `${sessionPanelResizedWidth()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && (newSessionDesign() || !desktopReviewOpen()))
  const desktopV2PanelLayout = createMemo(() =>
    sessionPanelLayout({
      review: desktopV2ReviewOpen(),
      terminal: desktopTerminalOpen(),
      files: desktopFileTreeOpen(),
    }),
  )

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const info = createMemo(() => {
    const id = sessionID()
    return id ? sync().session.get(id) : undefined
  })
  const isChildSession = createMemo(() => !!info()?.parentID)
  const canReview = createMemo(() => !!sync().project)
  const reviewTab = createMemo(() => isDesktop())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const timeline = createTimelineModel({ sessionID, revertMessageID })
  const historyLoading = timeline.history.loading
  const historyMore = timeline.history.more
  const lastUserMessage = timeline.lastUserMessage
  const messages = timeline.messages
  const messagesReady = timeline.ready
  const sessionSync = timeline.resource
  const userMessages = timeline.userMessages
  const visibleUserMessages = timeline.visibleUserMessages

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  let restoredModelSession: string | undefined
  createEffect(() => {
    const id = sessionID()
    if (!id || !prompt.ready() || !local.session.ready()) return
    if (restoredModelSession !== id) {
      restoredModelSession = id
      if (restorePromptModel(local, prompt)) return
    }
    syncPromptModel(local, prompt)
  })

  createEffect(
    on(
      () => ({ dir: sdk().directory, id: sessionID() }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    ...sessionViewState(),
    newSessionWorktree: "main",
    deferRender: false,
  })

  createComputed((prev) => {
    const key = sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      const owner = sessionOwnership.capture()
      requestAnimationFrame(() => {
        setTimeout(() => owner.run(() => setStore("deferRender", false)), 0)
      })
    }
    return key
  })

  let reviewFrame: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => {
    const project = sync().project
    return !!project && project.vcs !== "git"
  })
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    const project = sync().project
    const vcs = sync().data.vcs
    if (project?.vcs === "git") list.push("git")
    if (project?.vcs === "git" && vcs?.branch && vcs?.default_branch && vcs.branch !== vcs.default_branch) {
      list.push("branch")
    }
    list.push("turn")
    return list
  })
  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() ||
        (desktopReviewOpen() && (activeTab() === "review" || (newSessionDesign() && !!activeFileTab())))
      : store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    const mode = reviewMode()
    if (mode === "git" || mode === "branch") return mode
  })
  const vcsKey = createMemo(
    () =>
      ["session-vcs", sdk().directory, sync().data.vcs?.branch ?? "", sync().data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync().project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      queryFn: mode
        ? () =>
            sdk()
              .api.vcs.diff({ location: { directory: sdk().directory }, mode: mode === "git" ? "working" : mode })
              .then((result) => result.data)
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = debounce(() => void queryClient.invalidateQueries({ queryKey: vcsKey() }), 100)
  const reviewDiffs = () => {
    if (reviewMode() === "git" || reviewMode() === "branch")
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const activeReviewFile = () => {
    const diffs = reviewDiffs()
    const selected = reviewFile()
    if (selected && diffs.some((diff) => diff.file === selected)) return selected
    return diffs[0]?.file
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (reviewMode() === "git" || reviewMode() === "branch") return !vcsQuery.isPending
    return true
  }
  const loadReviewDiff = async (file: string, version?: number): Promise<VcsFileDiff | undefined> => {
    const mode = vcsMode()
    if (!mode) return
    const root = reviewRootDirectory(sync().project?.worktree ?? sdk().directory)
    const directory = reviewDiffDirectory(root, file)
    const source = reviewDiffs().find((diff) => diff.file === file)
    const valid = (diff: VcsFileDiff | undefined) => {
      if (!diff || !source) return
      if (diff.additions !== source.additions || diff.deletions !== source.deletions) return
      if (reviewDiffNeedsLoad(diff)) return
      return diff
    }
    const request = (scope: string, context?: number) =>
      queryClient
        .fetchQuery({
          queryKey: [serverSDK().scope, ...vcsKey(), mode, "directory", scope, context, version] as const,
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () =>
            sdk()
              .api.vcs.diff({
                location: { directory: scope },
                mode: mode === "git" ? "working" : mode,
                context,
              })
              .then((result) => result.data),
        })
        .then((diffs) => diffs.find((diff) => diff.file === file))

    if (directory !== root) {
      try {
        const scoped = valid(await request(directory))
        if (scoped) return scoped
      } catch (error) {
        console.debug("[session-review] failed to load scoped vcs diff", { mode, file, directory, error })
      }
    }
    try {
      const bounded = valid(await request(root, 3))
      if (bounded) return bounded
    } catch (error) {
      console.debug("[session-review] failed to load bounded vcs diff", { mode, file, root, error })
    }
  }

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync().project
    if (project && sdk().directory !== project.worktree) return sdk().directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  function upsert(next: Project) {
    const list = serverSync().data.project
    sync().set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      serverSync().set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      serverSync().set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    serverSync().set("project", [...list, next])
  }

  const gitMutation = useMutation(() => ({
    mutationFn: () => sdk().client.project.initGit(),
    onSuccess: (x) => {
      if (!x.data) return
      upsert(x.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let revealMessage = (_id: string) => {}
  let scrollToEnd = () => {}
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  createEffect(
    on(
      () => {
        const id = sessionID()
        return [
          sdk().directory,
          id,
          id ? (sync().data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, status, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (status === "idle" && !blocked) return
        const cached = untrack(() => sync().data.todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk().directory !== dir || sessionID() !== id) return
            untrack(() => {
              void sync().session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      sessionKey,
      () => {
        setStore(sessionViewState())
        setUi("pendingMessage", undefined)
      },
      { defer: true },
    ),
  )

  const stopVcs = sdk().event.listen((evt) => {
    const details = evt.details as { type: string; properties?: unknown }
    if (details.type !== "file.watcher.updated" && details.type !== "filesystem.changed") return
    const props =
      typeof details.properties === "object" && details.properties
        ? (details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  createEffect(
    on(
      () => sdk().directory,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!focused()) return

    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    const key = scrollKey(event)
    if (key) {
      if (!scroller || !isScrollKeyTarget(target ?? null, key)) return
      if (scrollKeyOwner(scroller, target ?? null, key) !== scroller) return
      markScrollGesture(scroller)
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked() || isChildSession()) return
      const input = inputRef
      if (!input) return
      input.focus()
      setCursorPosition(input, prompt.cursor() ?? promptLength(prompt.current()))
    }
  }

  createEffect(() => {
    if (!layout.ready()) return
    if (sync().status !== "complete") return
    if (!sync().project) return
    const list = changesOptions()
    const mode = reviewMode()
    if (list.includes(mode)) return
    const next = list[0]
    if (!next) return
    view().review.setMode(next)
  })

  createEffect(
    on(
      () => sync().data.session_status[sessionID() ?? ""]?.type,
      (next, prev) => {
        if (next !== "idle" || prev === undefined || prev === "idle") return
        refreshVcs()
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
  })

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => {
    if (isChildSession()) return
    inputRef?.focus()
  }

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const changesLabel = (option: ChangeMode) => {
    if (option === "git") return language.t("ui.sessionReview.title.git")
    if (option === "branch") return language.t("ui.sessionReview.title.branch")
    return language.t("ui.sessionReview.title.lastTurn")
  }

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    return (
      <Select
        options={changesOptions()}
        current={reviewMode()}
        label={changesLabel}
        onSelect={(option) => option && view().review.setMode(option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const changesTitleV2 = () => {
    if (!canReview()) {
      return null
    }

    return (
      <SelectV2
        appearance="inline"
        options={changesOptions()}
        current={reviewMode()}
        label={changesLabel}
        placement="bottom-start"
        gutter={6}
        onSelect={(option) => option && view().review.setMode(option)}
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const createGit = (input: { emptyClass: string }) => (
    <div class={input.emptyClass}>
      <div class="flex flex-col gap-3">
        <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
        <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
          {language.t("session.review.noVcs.createGit.description")}
        </div>
      </div>
      <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
        {gitMutation.isPending
          ? language.t("session.review.noVcs.createGit.actionLoading")
          : language.t("session.review.noVcs.createGit.action")}
      </Button>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (reviewMode() === "git") return language.t("session.review.noUncommittedChanges")
    if (reviewMode() === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (reviewMode() === "git" || reviewMode() === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (reviewMode() === "turn") {
      if (nogit()) return createGit(input)
      return empty(reviewEmptyText())
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewEmptyV2 = () => {
    if ((reviewMode() === "git" || reviewMode() === "branch") && !reviewReady()) {
      return <div class="px-6 py-4 text-text-weak">{language.t("session.review.loadingChanges")}</div>
    }
    if (reviewMode() === "turn" && nogit()) {
      return <SessionReviewEmptyNoGitV2 pending={gitMutation.isPending} onInitGit={initGit} />
    }
    return <SessionReviewEmptyChangesV2 />
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!store.deferRender}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={(el) => setTree("reviewScroll", el)}
        focusedFile={activeReviewFile()}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewV2State = createReviewPanelV2State()

  const reviewPanelV2Props = () => ({
    get title() {
      return changesTitleV2()
    },
    get empty() {
      return reviewEmptyV2()
    },
    diffs: reviewDiffs,
    diffsReady: reviewReady,
    get diffVersion() {
      return vcsQuery.dataUpdatedAt
    },
    loadDiff: loadReviewDiff,
    get activeFile() {
      return activeReviewFile()
    },
    onSelectFile: focusReviewDiff,
    get diffStyle() {
      return layout.review.diffStyle()
    },
    onDiffStyleChange: layout.review.setDiffStyle,
    state: reviewV2State,
    onLineComment: (comment: SessionReviewLineComment) => addCommentToContext({ ...comment, origin: "review" }),
    onLineCommentUpdate: updateCommentInContext,
    onLineCommentDelete: removeCommentFromContext,
    get lineCommentActions() {
      return reviewCommentActions()
    },
    get comments() {
      return comments.all()
    },
    get focusedComment() {
      return comments.focus()
    },
    onFocusedCommentChange: (focus: { file: string; id: string } | null) => {
      if (!focus) {
        const current = comments.focus()
        if (current && reviewDiffs().some((diff) => diff.file === current.file)) focusReviewDiff(current.file)
      }
      comments.setFocus(focus)
    },
  })

  const reviewPanelV2Rendered = createMemo<boolean>((prev) => prev || !store.deferRender, false)

  const reviewPanelV2 = () => (
    <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
      <Show when={reviewPanelV2Rendered()}>
        <ReviewPanelV2 {...reviewPanelV2Props()} />
      </Show>
    </div>
  )

  const reviewPanel = () => (
    <div
      classList={{
        "flex flex-col h-full overflow-hidden contain-strict": true,
        "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
        "bg-background-stronger": !settings.general.newLayoutDesigns(),
      }}
    >
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = root.querySelector<HTMLElement>(`[id="${id}"]`)
    if (!el) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    view().review.setFile(path)
    setTree("pendingDiff", path)
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk().directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync().status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk().directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "none",
  })
  createEffect(
    on(
      sessionID,
      (id, previous) => {
        if (!id || !previous || id === previous) return
        if (props.routing?.hash() || store.messageId || ui.pendingMessage) return
        autoScroll.resume()
      },
    ),
  )

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.resume()
    scrollToEnd()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  let captureHistoryAnchor = () => {}
  let restoreHistoryAnchor = (_done: boolean) => {}
  const historyRequests = new Set<string>()
  let historyContinuationFrame: number | undefined
  const loadOlder = async () => {
    const owner = sessionOwnership.capture()
    if (historyLoading() || historyRequests.has(owner.key)) return
    historyRequests.add(owner.key)
    const before = timeline.messages().length
    try {
      await timeline.history.loadOlder({
        before: () => owner.run(captureHistoryAnchor),
        after: (done) => owner.run(() => restoreHistoryAnchor(done)),
      })
    } finally {
      historyRequests.delete(owner.key)
    }
    if (!owner.current() || timeline.messages().length <= before) return
    if (!autoScroll.userScrolled() || !scroller || scroller.scrollTop >= 200 || !historyMore()) return
    if (historyContinuationFrame !== undefined) cancelAnimationFrame(historyContinuationFrame)
    historyContinuationFrame = requestAnimationFrame(() => {
      historyContinuationFrame = undefined
      owner.run(onHistoryScroll)
    })
  }
  const onHistoryScroll = () => {
    if (
      historyRequests.has(sessionOwnership.key()) ||
      historyLoading() ||
      !autoScroll.userScrolled() ||
      !scroller ||
      scroller.scrollTop >= 200
    )
      return
    void loadOlder()
  }

  onCleanup(() => {
    if (historyContinuationFrame !== undefined) cancelAnimationFrame(historyContinuationFrame)
  })

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!sessionID() || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (!historyMore()) return

      void loadOlder()
    })
  }

  createEffect(
    on(
      () =>
        [
          sessionID(),
          messagesReady(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (!more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync().data.part[id] ?? [], {
      directory: sdk().directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>, target = sync()) => target.session.remember(next)

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"], target = sync()) => {
    const session = target.session.get(sessionID)
    if (!session) return
    target.session.remember({ ...session, revert: next })
  }

  const busy = (sessionID: string) => sync().data.session_working(sessionID)

  const queueEnabled = createMemo(() => {
    if (props.queueEnabled !== undefined) return props.queueEnabled
    const id = sessionID()
    if (!id) return false
    return busy(id) && !composer.blocked() && !isChildSession()
  })

  const halt = (sessionID: string) =>
    busy(sessionID)
      ? sdk()
          .api.session.interrupt({ sessionID })
          .catch(() => {})
      : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const session = sdk().api.session
      const target = sync()
      const last = target.session.get(input.sessionID)?.revert
      const value = draft(input.messageID)
      await runPromptRollbackMutation({
        capturePrompt: prompt.capture,
        optimistic: (prompt) => {
          roll(input.sessionID, { messageID: input.messageID }, target)
          prompt.set(value)
        },
        request: () => halt(input.sessionID).then(() => session.revert.stage(input)),
        complete: () => undefined,
        rollback: () => roll(input.sessionID, last, target),
        fail,
      })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const targetSessionID = sessionID()
      if (!targetSessionID) return

      const session = sdk().api.session
      const target = sync()
      const index = userMessages().findIndex((item) => item.id === id)
      if (index < 0) return
      const next = userMessages()[index + 1]
      const last = target.session.get(targetSessionID)?.revert

      await runPromptRollbackMutation({
        capturePrompt: prompt.capture,
        optimistic: (promptSession) => {
          roll(targetSessionID, next ? { messageID: next.id } : undefined, target)
          if (next) {
            promptSession.set(draft(next.id))
            return
          }
          promptSession.reset()
        },
        request: () =>
          !next
            ? halt(targetSessionID).then(() => session.revert.clear({ sessionID: targetSessionID }))
            : halt(targetSessionID).then(() =>
                session.revert.stage({ sessionID: targetSessionID, messageID: next.id }).then(() => undefined),
              ),
        complete: () => undefined,
        rollback: () => roll(targetSessionID, last, target),
        fail,
      })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!sessionID() || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    const index = userMessages().findIndex((item) => item.id === id)
    if (index < 0) return []
    return userMessages()
      .slice(index)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const openAttachment = (file: FilePart) => {
    const download = () => {
      const anchor = document.createElement("a")
      anchor.href = file.url
      anchor.download = getFilename(file.filename) || "attachment"
      anchor.click()
    }
    const path = file.filename ?? ""
    const absolute = path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)
    if (platform.revealPath && absolute) {
      void platform.revealPath(path).then(
        (revealed) => {
          if (!revealed) download()
        },
        () => download(),
      )
      return
    }
    download()
  }

  const actions = { revert, openAttachment }

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) scrollToEnd()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = createSurfaceHashScroll(
    {
      sessionKey,
      sessionID,
      messagesReady,
      visibleUserMessages,
      historyMore,
      historyLoading,
      loadMore: (sessionID) => sync().session.history.loadMore(sessionID),
      currentMessageId: () => store.messageId,
      pendingMessage: () => ui.pendingMessage,
      setPendingMessage: (value) => setUi("pendingMessage", value),
      setActiveMessage,
      autoScroll: {
        pause: autoScroll.pause,
        forceScrollToBottom: () => {
          autoScroll.resume()
          scrollToEnd()
        },
      },
      scroller: () => scroller,
      anchor,
      hashAnchor,
      revealMessage: (id) => revealMessage(id),
      scheduleScrollState,
      consumePendingMessage: layout.pendingMessage.consume,
    },
    {
      hash: () => props.routing?.hash(),
      href: () => props.routing?.href() ?? "",
      navigate: (to, options) => props.routing?.navigate?.(to, options),
    },
  )

  createEffect(
    on(
      sessionID,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
  })

  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  const mobileTabs = (compact = false, bottom = false) => (
    <Tabs value={store.mobileTab} class="h-auto">
      <Tabs.List
        classList={{
          "!h-9": compact,
          "[&::after]:!border-b-0 [&::after]:!border-t [&::after]:!border-border-weak-base": bottom,
        }}
      >
        <Tabs.Trigger
          value="session"
          classList={{
            "!w-1/2 !max-w-none": true,
            "!border-b-0 !border-t !border-border-weak-base [&:has([data-selected])]:!border-t-transparent": bottom,
          }}
          classes={{ button: compact ? "w-full !py-2" : "w-full" }}
          onClick={() => setStore("mobileTab", "session")}
        >
          {language.t("session.tab.session")}
        </Tabs.Trigger>
        <Tabs.Trigger
          value="changes"
          classList={{
            "!w-1/2 !max-w-none !border-r-0": true,
            "!border-b-0 !border-t !border-border-weak-base [&:has([data-selected])]:!border-t-transparent": bottom,
          }}
          classes={{ button: compact ? "w-full !py-2" : "w-full" }}
          onClick={() => setStore("mobileTab", "changes")}
        >
          {hasReview()
            ? language.t("session.review.filesChanged", { count: reviewCount() })
            : language.t("session.review.change.other")}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>
  )
  const mobileTabsBottom = createMemo(
    () => !isDesktop() && settings.general.newLayoutDesigns() && settings.general.mobileTitlebarPosition() === "bottom",
  )

  const sessionErrorFallback = (error: unknown, reset: () => void) => {
    createEffect(on(sessionKey, reset, { defer: true }))
    return <SessionErrorFallback error={error} sessionID={sessionID()} />
  }

  const sessionPanelContent = () => (
    <>
      {sessionSync() ?? ""}
      <Show when={!isDesktop() && !!sessionID() && settings.general.newLayoutDesigns() && !mobileTabsBottom()}>
        {mobileTabs(true)}
      </Show>
      <div id={scopedId("messages")} class="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Match when={sessionID() && mobileChanges()}>
            <div id={scopedId("review")} class="contents">
              <div class="relative h-full overflow-hidden">
                {reviewContent({
                  diffStyle: "unified",
                  classes: {
                    root: "pb-8 [&_[data-slot=session-review-list]]:pb-0",
                    header: "px-4 !h-16 !pb-4",
                    container: "px-4",
                  },
                  loadingClass: "px-4 py-4 text-text-weak",
                  emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                })}
              </div>
            </div>
          </Match>
          <Match when={sessionID()}>
            <Show when={messagesReady() ? sessionID() : undefined} keyed>
              {(_id) => (
                <MessageTimeline
                  sessionID={() => _id}
                  actions={actions}
                  scroll={ui.scroll}
                  onResumeScroll={resumeScroll}
                  setScrollRef={setScrollRef}
                  onScheduleScrollState={scheduleScrollState}
                  onAutoScrollHandleScroll={autoScroll.handleScroll}
                  onMarkScrollGesture={markScrollGesture}
                  hasScrollGesture={hasScrollGesture}
                  onUserScroll={markUserScroll}
                  onHistoryScroll={onHistoryScroll}
                  onAutoScrollInteraction={autoScroll.handleInteraction}
                  shouldAnchorBottom={() =>
                    !props.routing?.hash() && !store.messageId && !ui.pendingMessage && !autoScroll.userScrolled()
                  }
                  centered={centered()}
                  setContentRef={(el) => {
                    content = el
                    autoScroll.contentRef(el)

                    const root = scroller
                    if (root) scheduleScrollState(root)
                  }}
                  userMessages={visibleUserMessages()}
                  setHistoryAnchor={(handlers) => {
                    captureHistoryAnchor = handlers.capture
                    restoreHistoryAnchor = handlers.restore
                  }}
                  anchor={anchor}
                  setRevealMessage={(fn) => {
                    revealMessage = fn
                  }}
                  setScrollToEnd={(fn) => {
                    scrollToEnd = fn
                  }}
                />
              )}
            </Show>
          </Match>
          <Match when={true}>
            <NewSessionView worktree={newSessionWorktree()} />
          </Match>
        </Switch>
      </div>

      <Show when={(sessionID() || !newSessionDesign()) && !mobileChanges()}>
        {(_) => {
          const controller = createSessionComposerRegionController({
            state: composer,
            sessionKey,
            sessionID,
            prompt,
            ready: () => !store.deferRender && messagesReady(),
            centered,
            todo: {
              collapsed: () => view().todoCollapsed.get(),
              onToggle: () => view().todoCollapsed.set(!view().todoCollapsed.get()),
            },
            revert: () =>
              rolled().length > 0
                ? {
                    items: rolled(),
                    restoring: restoring(),
                    disabled: reverting(),
                    onRestore: restore,
                  }
                : undefined,
            onResponseSubmit: resumeScroll,
            openParent: () => {
              const id = info()?.parentID
              if (!id) return
              props.routing?.openParent?.(id)
            },
            setPromptRef: (el) => {
              inputRef = el
            },
            setDockRef: (el) => {
              promptDock = el
            },
          })
          return (
            <div id={scopedId("composer")} class="contents">
              <SessionComposerRegion
                controller={controller}
                promptInput={
                  <Show
                    when={newSessionDesign()}
                    fallback={
                      <PromptInput
                        controls={inputController()}
                        ref={(el) => {
                          inputRef = el
                        }}
                        newSessionWorktree={newSessionWorktree()}
                        onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
                        onSubmit={() => {
                          comments.clear()
                          resumeScroll()
                        }}
                        queue={queueEnabled}
                      />
                    }
                  >
                    {(_) => {
                      const controller = usePromptInputV2Controller({
                        get controls() {
                          return inputController()
                        },
                        ref: (el) => {
                          inputRef = el
                        },
                        get newSessionWorktree() {
                          return newSessionWorktree()
                        },
                        onNewSessionWorktreeReset: () => setStore("newSessionWorktree", "main"),
                        onSubmit: () => {
                          comments.clear()
                          resumeScroll()
                        },
                        queue: queueEnabled,
                      })
                      return <PromptInputV2Composer controller={controller} borderUnderlay />
                    }}
                  </Show>
                }
              />
            </div>
          )
        }}
      </Show>
      <Show when={!!sessionID() && mobileTabsBottom()}>{mobileTabs(true, true)}</Show>
    </>
  )

  return (
    <SessionRouteFrame>
      <SessionHeader />
      <Show when={focused() && props.commands !== false}>
        <SurfaceCommands
          actions={{
            navigateMessageByOffset,
            setActiveMessage,
            focusInput,
            review: reviewTab,
            fileBrowser: () => newSessionDesign() && isDesktop() && !!sessionID(),
          }}
        />
      </Show>
      <div
        ref={panelRow}
        class="flex-1 min-h-0 flex flex-col md:flex-row"
        classList={{
          "gap-2 p-2": settings.general.newLayoutDesigns(),
        }}
        onPointerDown={() => props.onFocus?.()}
      >
        <Show when={!isDesktop() && !!sessionID() && !settings.general.newLayoutDesigns()}>{mobileTabs()}</Show>

        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
            "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !ui.reviewSnap && !desktopInlineTerminalOnlyOpen(),
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          {settings.general.newLayoutDesigns() ? (
            <Show when={sessionPanelKey()} keyed>
              {(_) => (
                <SessionPanelFrame newLayout raised={!!sessionID()}>
                  <ErrorBoundary fallback={sessionErrorFallback}>{sessionPanelContent()}</ErrorBoundary>
                </SessionPanelFrame>
              )}
            </Show>
          ) : (
            <SessionPanelFrame newLayout={false} raised={!!sessionID()}>
              {sessionPanelContent()}
            </SessionPanelFrame>
          )}

          <Show when={desktopSessionResizeOpen()}>
            <div onPointerDown={() => size.start()}>
              <ResizeHandle
                classList={{
                  "-end-1": settings.general.newLayoutDesigns(),
                }}
                direction="horizontal"
                size={sessionPanelResizedWidth()}
                min={SESSION_PANEL_WIDTH_MIN}
                max={sessionPanelMax()}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <Show when={!newSessionDesign() && desktopSidePanelOpen()}>
          <div id={scopedId("review")} class="contents">
            <Suspense>
              <SessionSidePanel
                canReview={canReview}
                diffs={reviewDiffs}
                diffsReady={reviewReady}
                empty={reviewEmptyText}
                hasReview={hasReview}
                reviewHasFocusableContent={hasReview}
                reviewCount={reviewCount}
                reviewPanel={reviewPanel}
                activeDiff={activeReviewFile()}
                focusReviewDiff={focusReviewDiff}
                reviewSnap={ui.reviewSnap}
                size={size}
              />
            </Suspense>
          </div>
        </Show>
        <Show when={newSessionDesign()}>
          <Show when={isDesktop() ? desktopV2PanelLayout().visible : terminalOpen()}>
            <div class="min-w-0 h-full flex flex-1 flex-col">
              <Show when={isDesktop() && (desktopV2ReviewOpen() || desktopFileTreeOpen())}>
                <div id={scopedId("review")} class="contents">
                  <div class="min-h-0 flex-1">
                    <Suspense>
                      <SessionSidePanel
                        canReview={canReview}
                        diffs={reviewDiffs}
                        diffsReady={reviewReady}
                        empty={reviewEmptyText}
                        hasReview={hasReview}
                        reviewHasFocusableContent={() => hasReview() || reviewV2State.sidebarOpened()}
                        reviewCount={reviewCount}
                        reviewPanel={reviewPanelV2}
                        reviewSidebarToggle={(disabled) => (
                          <SessionReviewV2SidebarToggle
                            opened={reviewV2State.sidebarOpened()}
                            disabled={disabled}
                            onToggle={reviewV2State.toggleSidebar}
                          />
                        )}
                        fileBrowserState={reviewV2State}
                        activeDiff={activeReviewFile()}
                        focusReviewDiff={focusReviewDiff}
                        reviewSnap={ui.reviewSnap}
                        size={size}
                        stacked={desktopV2PanelLayout().stacked}
                      />
                    </Suspense>
                  </div>
                </div>
              </Show>
              <Show when={desktopV2PanelLayout().stacked}>
                <div class="relative h-2 shrink-0" onPointerDown={() => size.start()}>
                  <ResizeHandle
                    class="!relative !inset-auto !h-full !w-full !transform-none"
                    direction="vertical"
                    size={layout.terminal.height()}
                    min={100}
                    max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                    collapseThreshold={50}
                    onResize={(height) => {
                      size.touch()
                      layout.terminal.resize(height)
                    }}
                    onCollapse={() => view().terminal.close()}
                  />
                </div>
              </Show>
              <Show when={terminalOpen()}>
                <div id={scopedId("terminal")} class="contents">
                  <div
                    classList={{
                      "min-h-0 shrink-0": desktopV2PanelLayout().stacked,
                      "min-h-0 flex-1": !desktopV2PanelLayout().stacked,
                    }}
                  >
                    <TerminalPanelV2 stacked={desktopV2PanelLayout().stacked} />
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={!newSessionDesign()}>
        <div id={scopedId("terminal")} class="contents">
          <TerminalPanel />
        </div>
      </Show>
    </SessionRouteFrame>
  )
}

function createSurfaceHashScroll(
  input: {
    sessionKey: () => string
    sessionID: () => string | undefined
    messagesReady: () => boolean
    visibleUserMessages: () => UserMessage[]
    historyMore: () => boolean
    historyLoading: () => boolean
    loadMore: (sessionID: string) => Promise<void>
    currentMessageId: () => string | undefined
    pendingMessage: () => string | undefined
    setPendingMessage: (value: string | undefined) => void
    setActiveMessage: (message: UserMessage | undefined) => void
    autoScroll: { pause: () => void; forceScrollToBottom: () => void }
    scroller: () => HTMLDivElement | undefined
    anchor: (id: string) => string
    hashAnchor: (id: string) => string
    revealMessage?: (id: string) => void
    scheduleScrollState: (el: HTMLDivElement) => void
    consumePendingMessage: (key: string) => string | undefined
  },
  routing: {
    hash: () => string | undefined
    href: () => string
    navigate: (to: string, options?: { replace?: boolean }) => void
  },
) {
  const visibleUserMessages = createMemo(() => input.visibleUserMessages())
  const messageById = createMemo(() => new Map(visibleUserMessages().map((m) => [m.id, m])))
  let pendingKey = ""
  let clearing = false

  const frames = new Set<number>()
  const queue = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      fn()
    })
    frames.add(id)
  }
  const cancel = () => {
    for (const id of frames) cancelAnimationFrame(id)
    frames.clear()
  }

  const clearMessageHash = () => {
    cancel()
    input.consumePendingMessage(input.sessionKey())
    if (input.pendingMessage()) input.setPendingMessage(undefined)
    if (!routing.hash()) return
    clearing = true
    routing.navigate(routing.href(), { replace: true })
  }

  const updateHash = (id: string) => {
    const hash = `#${input.hashAnchor(id)}`
    if (routing.hash() === hash) return
    clearing = false
    routing.navigate(routing.href() + hash, {
      replace: true,
    })
  }

  const scrollToElement = (el: HTMLElement, behavior: ScrollBehavior) => {
    const root = input.scroller()
    if (!root) return false

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    const top = Math.max(0, a.top - b.top + root.scrollTop - inset)
    root.scrollTo({ top, behavior })
    return true
  }

  const seek = (id: string, behavior: ScrollBehavior, left = 4): boolean => {
    input.revealMessage?.(id)
    const el = document.getElementById(input.anchor(id))
    if (el) return scrollToElement(el, behavior)
    if (left <= 0) return false
    queue(() => {
      seek(id, behavior, left - 1)
    })
    return false
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    cancel()
    if (input.currentMessageId() !== message.id) input.setActiveMessage(message)
    input.revealMessage?.(message.id)

    if (seek(message.id, behavior)) {
      updateHash(message.id)
      return
    }

    updateHash(message.id)
  }

  const applyHash = (behavior: ScrollBehavior) => {
    const value = routing.hash()
    if (!value) {
      input.autoScroll.forceScrollToBottom()
      const el = input.scroller()
      if (el) input.scheduleScrollState(el)
      return
    }

    const hash = value.slice(1)
    const messageId = messageIdFromHash(hash)
    if (messageId) {
      input.autoScroll.pause()
      const msg = messageById().get(messageId)
      if (msg) {
        scrollToMessage(msg, behavior)
        return
      }
      return
    }

    const target = document.getElementById(hash)
    if (target) {
      input.autoScroll.pause()
      scrollToElement(target, behavior)
      return
    }

    input.autoScroll.forceScrollToBottom()
    const el = input.scroller()
    if (el) input.scheduleScrollState(el)
  }

  createEffect(() => {
    const hash = routing.hash()
    if (!hash) clearing = false
    if (!input.sessionID() || !input.messagesReady()) return
    cancel()
    queue(() => applyHash("auto"))
  })

  createEffect(() => {
    if (!input.sessionID() || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId) {
      const key = input.sessionKey()
      if (pendingKey !== key) {
        pendingKey = key
        const next = input.consumePendingMessage(key)
        if (next) {
          input.setPendingMessage(next)
          targetId = next
        }
      }
    }

    if (!targetId && !clearing) {
      const hash = routing.hash()
      if (hash) targetId = messageIdFromHash(hash.slice(1))
    }
    if (!targetId) return

    const pending = input.pendingMessage() === targetId
    const msg = messageById().get(targetId)
    if (!msg) return

    if (pending) input.setPendingMessage(undefined)
    if (input.currentMessageId() === targetId && !pending) return

    input.autoScroll.pause()
    cancel()
    queue(() => scrollToMessage(msg, "auto"))
  })

  createEffect(() => {
    const sessionID = input.sessionID()
    if (!sessionID || !input.messagesReady()) return

    visibleUserMessages()

    let targetId = input.pendingMessage()
    if (!targetId && !clearing) {
      const hash = routing.hash()
      if (hash) targetId = messageIdFromHash(hash.slice(1))
    }
    if (!targetId) return
    if (messageById().has(targetId)) return
    if (!input.historyMore() || input.historyLoading()) return

    void input.loadMore(sessionID)
  })

  onCleanup(cancel)

  return {
    clearMessageHash,
    scrollToMessage,
    applyHash,
  }
}
