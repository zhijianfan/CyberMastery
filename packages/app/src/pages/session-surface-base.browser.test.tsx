import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { render } from "solid-js/web"
import { createComponent, type JSX } from "solid-js"
import h from "solid-js/h"

let SessionSurfaceBase: typeof import("./session-surface-base").SessionSurfaceBase

const noop = () => {}

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  if (typeof tag === "string") return h(tag as never, props as never, ...children)
  const next = { ...(props ?? {}) }
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0]
    next.children = typeof value === "function" ? value : () => value
  }
  return createComponent(tag as never, next)
}

;(globalThis as unknown as { React: unknown; Fragment_8vg9x3sq: unknown }).React = { createElement }
;(globalThis as unknown as { Fragment_8vg9x3sq: unknown }).Fragment_8vg9x3sq = (props: { children?: unknown }) => props.children

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))

  mock.module("@tanstack/solid-query", () => ({
    createQuery: () => ({ isPending: false, isFetched: true, data: [], dataUpdatedAt: 0 }),
    useMutation: () => ({ isPending: false, mutate: noop, mutateAsync: () => Promise.resolve(undefined) }),
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve(), fetchQuery: () => Promise.resolve([]) }),
    skipToken: Symbol("skipToken"),
  }))

  mock.module("@solid-primitives/media", () => ({ createMediaQuery: () => () => true }))

  mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ active: false, show: noop }) }))
  mock.module("@opencode-ai/ui/resize-handle", () => ({ ResizeHandle: () => null }))
  mock.module("@opencode-ai/ui/select", () => ({ Select: () => null }))
  mock.module("@opencode-ai/ui/v2/select-v2", () => ({ SelectV2: () => null }))
  mock.module("@opencode-ai/ui/scroll-view", () => ({
    isScrollKeyTarget: () => false,
    scrollKey: () => undefined,
    scrollKeyOwner: () => undefined,
  }))
  mock.module("@opencode-ai/ui/tabs", () => {
    const Tabs = (props: { children?: unknown }) => <div data-mobile-tabs />
    return { Tabs: Object.assign(Tabs, { List: () => null, Trigger: () => null }) }
  })
  mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: () => null }))
  mock.module("@opencode-ai/ui/button", () => ({ Button: () => null }))
  mock.module("@opencode-ai/ui/hooks", () => ({
    createAutoScroll: () => ({
      userScrolled: () => false,
      resume: noop,
      pause: noop,
      handleScroll: noop,
      handleInteraction: noop,
      scrollRef: noop,
      contentRef: noop,
    }),
  }))
  mock.module("@opencode-ai/session-ui/pierre/selection-bridge", () => ({ previewSelectedLines: () => undefined }))

  mock.module("@/utils/toast", () => ({ showToast: noop }))
  mock.module("@/utils/diffs", () => ({ diffs: () => [] }))
  mock.module("@/utils/prompt", () => ({ extractPromptFromParts: () => [] }))
  mock.module("@/utils/server-errors", () => ({
    formatServerError: (error: unknown) => String(error),
    isLocalSessionNotFoundError: () => false,
    isSessionNotFoundError: () => false,
  }))

  mock.module("@/context/local", () => ({ useLocal: () => ({ session: { ready: () => true, reset: noop } }) }))
  mock.module("@/context/file", () => ({
    FileProvider: (props: { children?: unknown }) => props.children,
    selectionFromLines: (selection: unknown) => selection,
    useFile: () => ({
      get: () => undefined,
      pathFromTab: () => undefined,
      tab: (tab: string) => tab,
      load: () => Promise.resolve(),
      tree: { refresh: () => Promise.resolve(), list: () => Promise.resolve() },
      searchFilesAndDirectories: () => Promise.resolve([]),
    }),
  }))
  mock.module("@/context/comments", () => ({
    CommentsProvider: (props: { children?: unknown }) => props.children,
    useComments: () => ({
      all: () => [],
      focus: () => null,
      setFocus: noop,
      add: () => ({ id: "comment-1" }),
      update: noop,
      remove: noop,
      clear: noop,
    }),
  }))
  mock.module("@/context/command", () => ({ useCommand: () => ({ register: noop, trigger: noop }) }))
  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({ queryOptions: {}, set: noop, data: { project: [] } }),
  }))
  mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      ready: () => true,
      tabs: () => ({
        tabs: () => ({ all: [] as string[], active: undefined }),
        active: () => undefined,
        all: () => [],
        setActive: noop,
        setAll: noop,
        open: () => {},
        close: noop,
      }),
      view: () => ({
        review: {
          mode: () => "turn",
          file: () => undefined,
          openPath: noop,
          setFile: noop,
          setMode: noop,
        },
        reviewPanel: { opened: () => true, open: noop, toggle: noop },
        terminal: { opened: () => false, open: noop, close: noop },
        todoCollapsed: { get: () => true, set: noop },
        setScroll: noop,
      }),
      fileTree: { opened: () => true, width: () => 0, tab: () => "changes", setTab: noop },
      review: { diffStyle: () => "split", setDiffStyle: noop },
      session: { width: () => 600, resize: noop },
      terminal: { height: () => 200, resize: noop },
      handoff: { tabs: () => undefined, clearTabs: noop },
      pendingMessage: { consume: () => undefined },
    }),
  }))
  mock.module("@/context/prompt", () => ({
    PromptProvider: (props: { children?: unknown }) => props.children,
    usePrompt: () => ({
      ready: () => true,
      set: noop,
      capture: () => ({ current: () => [], set: noop, reset: noop }),
      cursor: () => 0,
      context: { add: noop, updateComment: noop, removeComment: noop },
    }),
  }))
  mock.module("@/context/platform", () => ({ usePlatform: () => ({ platform: "web", revealPath: undefined }) }))
  mock.module("@/context/sdk", () => ({
    useSDK: () => () => ({
      directory: "/repo",
      event: { listen: () => () => {}, on: () => () => {} },
      api: {
        session: {
          interrupt: () => Promise.resolve(),
          revert: { stage: () => Promise.resolve(), clear: () => Promise.resolve() },
        },
        vcs: { diff: () => Promise.resolve({ data: [] }) },
      },
      client: { project: { initGit: () => Promise.resolve({ data: undefined }) } },
    }),
  }))
  mock.module("@/context/server-sdk", () => ({ useServerSDK: () => () => ({ scope: "local" }) }))
  mock.module("@/context/server", () => ({
    ServerConnection: { key: (item: unknown) => String(item ?? "key") },
    serverName: (conn: unknown) => String(conn),
    useServer: () => ({ key: "local", list: [] }),
  }))
  mock.module("@/context/settings", () => ({
    useSettings: () => ({
      general: { newLayoutDesigns: () => false, mobileTitlebarPosition: () => "top" },
      visibility: { fileTree: () => true },
    }),
  }))
  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      status: "complete",
      project: undefined,
      session: {
        get: () => undefined,
        remember: noop,
        history: { loadMore: () => Promise.resolve(), loading: () => false, more: () => false },
        todo: () => Promise.resolve(),
      },
      set: noop,
      data: { vcs: {}, session_status: {}, part: {}, message: {}, todo: {}, session_working: () => false },
    }),
  }))
  mock.module("@/context/tabs", () => ({ useTabs: () => ({ removeSessionTab: noop }) }))
  mock.module("@/context/terminal", () => ({
    TerminalProvider: (props: { children?: unknown }) => props.children,
    useTerminal: () => ({ all: () => [], active: () => undefined }),
  }))

  mock.module("@/components/session", () => ({
    SessionHeader: () => null,
    NewSessionView: (props: { worktree?: string }) => <div data-new-session-view data-worktree={props.worktree} />,
  }))
  mock.module("@/pages/error", () => ({ ErrorPage: () => null }))
  mock.module("@/components/prompt-input", () => ({ PromptInput: () => <div data-prompt-input /> }))
  mock.module("@/components/prompt-input-v2", () => ({
    PromptInputV2Composer: () => null,
    usePromptInputV2Controller: () => ({}),
  }))
  mock.module("@/components/prompt-input/editor-dom", () => ({ setCursorPosition: noop }))
  mock.module("@/components/prompt-input/history", () => ({ promptLength: () => 0 }))
  mock.module("@/pages/session/composer", () => ({
    createPromptInputController: () => () => ({}),
    createSessionComposerController: () => ({ blocked: () => false, dock: () => false, closing: () => false }),
    createSessionComposerRegionController: (input: {
      state: unknown
      centered: unknown
      todo: unknown
      revert: unknown
      onResponseSubmit: unknown
      openParent: unknown
      setPromptRef: unknown
      setDockRef: unknown
    }) => ({
      state: input.state,
      centered: input.centered,
      todo: input.todo,
      revert: input.revert,
      onResponseSubmit: input.onResponseSubmit,
      openParent: input.openParent,
      setPromptRef: input.setPromptRef,
      setDockRef: input.setDockRef,
      parentID: () => undefined,
      child: () => false,
      showComposer: () => true,
      handoffPrompt: () => undefined,
      promptReady: () => true,
      dock: () => false,
      dockProgress: () => 0,
      dockHeight: () => 78,
      lift: () => 36,
      setDockBodyRef: noop,
    }),
    SessionComposerRegion: () => <div data-session-composer-region />,
  }))
  mock.module("@/pages/session/helpers", () => ({
    createOpenReviewFile: () => () => {},
    createSessionTabs: () => ({ activeTab: () => undefined, activeFileTab: () => undefined }),
    createSizing: () => ({ active: () => false, start: noop, touch: noop }),
    shouldShowFileTree: (input: { visible: boolean; opened: boolean }) => input.opened && input.visible,
  }))
  mock.module("@/pages/session/timeline/message-timeline", () => ({
    MessageTimeline: () => <div data-message-timeline />,
  }))
  mock.module("@/pages/session/timeline/model", () => ({
    createTimelineModel: () => ({
      history: { loadOlder: () => Promise.resolve(), loading: () => false, more: () => false },
      lastUserMessage: () => undefined,
      messages: () => [],
      ready: () => true,
      resource: () => undefined,
      userMessages: () => [],
      visibleUserMessages: () => [],
    }),
  }))
  mock.module("@/pages/session/review-tab", () => ({ SessionReviewTab: () => null }))
  mock.module("@/pages/session/session-model-helpers", () => ({
    restorePromptModel: () => false,
    syncPromptModel: noop,
    syncSessionModel: noop,
  }))
  mock.module("@/pages/session/session-panel-width", () => ({
    clampSessionPanelWidth: (input: { width: number }) => input.width,
    SESSION_PANEL_WIDTH_MIN: 200,
    sessionPanelWidthMax: () => 1000,
  }))
  mock.module("@/pages/session/session-surface-layout", () => ({ sessionSurfaceDesktop: () => true }))
  mock.module("@/pages/session/session-side-panel", () => ({ SessionSidePanel: () => null }))
  mock.module("@/pages/session/session-panel-layout", () => ({ sessionPanelLayout: () => ({ visible: false, stacked: false }) }))
  mock.module("@/pages/session/terminal-panel", () => ({ TerminalPanel: () => null }))
  mock.module("@/pages/session/terminal-panel-v2", () => ({ TerminalPanelV2: () => null }))
  mock.module("@/pages/session/use-composer-commands", () => ({ useComposerCommands: noop }))
  mock.module("@/pages/session/use-session-commands", () => ({ useSessionCommands: noop }))
  mock.module("@/pages/session/v2/review-panel-v2", () => ({ ReviewPanelV2: () => null }))
  mock.module("@/pages/session/v2/review-panel-v2-state", () => ({
    createReviewPanelV2State: () => ({ sidebarOpened: () => false, toggleSidebar: noop }),
  }))
  mock.module("@/pages/session/v2/review-diff-kinds", () => ({
    reviewDiffDirectory: (_root: string, file: string) => file,
    reviewDiffNeedsLoad: () => false,
    reviewRootDirectory: (dir: string) => dir,
  }))
  mock.module("@opencode-ai/session-ui/v2/session-review-empty-changes-v2", () => ({
    SessionReviewEmptyChangesV2: () => null,
  }))
  mock.module("@opencode-ai/session-ui/v2/session-review-empty-no-git-v2", () => ({
    SessionReviewEmptyNoGitV2: () => null,
  }))
  mock.module("@opencode-ai/session-ui/v2/session-review-v2", () => ({ SessionReviewV2SidebarToggle: () => null }))

  SessionSurfaceBase = (await import("./session-surface-base")).SessionSurfaceBase
})

const disposers: (() => void)[] = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  document.body.innerHTML = ""
})

function mount(ui: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(ui, host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
  return host
}

describe("SessionSurfaceBase", () => {
  test("renders the messages and composer shell for the explicit target without route params", () => {
    mount(() => <SessionSurfaceBase target={{ sessionID: "sess-1" }} />)

    expect(document.querySelector("[data-message-timeline]")).toBeTruthy()
    expect(document.querySelector("[data-session-composer-region]")).toBeTruthy()
    expect(document.querySelector("[data-new-session-view]")).toBeNull()
  })

  test("renders the new-session view when the target has no session", () => {
    mount(() => <SessionSurfaceBase target={{}} />)

    expect(document.querySelector("[data-new-session-view]")).toBeTruthy()
    expect(document.querySelector("[data-message-timeline]")).toBeNull()
    expect(document.querySelector("[data-session-composer-region]")).toBeTruthy()
  })

  test("scopes messages, composer, and terminal container ids per surface", () => {
    mount(() =>
      [
        createComponent(SessionSurfaceBase, { target: { sessionID: "sess-1" }, surfaceID: "s1" }),
        createComponent(SessionSurfaceBase, { target: { sessionID: "sess-2" }, surfaceID: "s2" }),
      ] as never,
    )

    const messagesA = document.getElementById("session-surface-s1-messages")
    const messagesB = document.getElementById("session-surface-s2-messages")
    expect(messagesA).toBeTruthy()
    expect(messagesB).toBeTruthy()
    expect(messagesA).not.toBe(messagesB)

    expect(document.getElementById("session-surface-s1-composer")).toBeTruthy()
    expect(document.getElementById("session-surface-s2-composer")).toBeTruthy()
    expect(document.getElementById("session-surface-s1-terminal")).toBeTruthy()
    expect(document.getElementById("session-surface-s2-terminal")).toBeTruthy()
    expect(document.getElementById("session-surface-s1-review")).toBeTruthy()
    expect(document.getElementById("session-surface-s2-review")).toBeTruthy()
  })

  test("mounts two surfaces for the same session without id collisions", () => {
    const host = mount(() =>
      [
        createComponent(SessionSurfaceBase, { target: { sessionID: "sess-shared" }, surfaceID: "s1" }),
        createComponent(SessionSurfaceBase, { target: { sessionID: "sess-shared" }, surfaceID: "s2" }),
      ] as never,
    )

    expect(host.querySelectorAll("[data-message-timeline]").length).toBe(2)
    expect(document.getElementById("session-surface-s1-messages")).not.toBe(
      document.getElementById("session-surface-s2-messages"),
    )
  })

  test("leaves ids unscoped when no surfaceID is provided", () => {
    mount(() => <SessionSurfaceBase target={{ sessionID: "sess-1" }} />)

    expect(document.getElementById("session-surface-s1-messages")).toBeNull()
    expect(document.querySelector("[data-message-timeline]")).toBeTruthy()
  })
})
