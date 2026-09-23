import type { Page } from "@playwright/test"
import type { ChatProxyRelay } from "@opencode-ai/sdk/v2/client"
import { currentSession, mockOpenCodeServer } from "./mock-server"
import { installSseTransport } from "./sse-transport"

export async function openCanvasBlockChats(
  page: Page,
  protocol: "v1" | "v2",
  options: {
    chatRoles?: readonly ("operating" | "master" | "relay")[]
    chatRelayDisconnected?: boolean
    chatRelayControls?: boolean
    chatRelayConfigureError?: string
    chatRelayRejectFirstPrompt?: boolean
    waitForSse?: boolean
    sessionTabs?: boolean
  } = {},
) {
  const directory = "C:/OpenCode/ChatAcceptance"
  const workspaceID = "wrk_chat_acceptance"
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const roles = ["operating", "master"] as const
  const blockRoles = ["operating", "master", "relay"] as const
  const functionality = [
    "builtin:operating-chat-session",
    "builtin:master-agent",
    "builtin:chat-relay",
    "builtin:ctxpack-browser",
  ]
  const layout = {
    workspaceID,
    revision: 1,
    blocks: [
      ...blockRoles
        .map((role, index) => ({
          id: `block-${role}`,
          functionality: functionality[index],
          transform: { x: 20 + index * 470, y: 80, w: 450, h: 760, z: index },
          configuration: { version: 1, directoryBinding: { mode: "workspace-primary" }, sessionBinding: null },
        }))
        .filter((block) => !options.chatRoles || options.chatRoles.some((role) => block.id === `block-${role}`)),
      { id: "block-packs", functionality: functionality[3], transform: { x: 1430, y: 80, w: 320, h: 760, z: 3 } },
    ],
  }
  const workspace = {
    id: workspaceID,
    name: "Chat workspace",
    model: "opencode:test-model",
    operatingAgent: "build",
    directories: [directory],
    coderModel: "opencode:test-model",
  }
  const location = { directory, workspaceID, project: { id: "proj_chat", directory } }
  const model = { id: "test-model", providerID: "opencode" }
  const tokens = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
  const sessions = [...roles, "route"].map((role) => ({
    id: `ses_${role}`,
    projectID: "proj_chat",
    directory,
    workspaceID,
    title: `${role} conversation`,
    version: "dev",
    agent: "build",
    model,
    time: { created: 1, updated: 1 },
  }))
  const canvasTabs = roles.map((role) => ({
    role,
    kind: role === "master" ? "master-agent" : "operating-chat",
    revision: 1,
    selectedTabID: `tab-${role}`,
    items: [
      {
        id: `tab-${role}`,
        workspaceID,
        kind: role === "master" ? "master-agent" : "operating-chat",
        blockID: `block-${role}`,
        conversationID: `ses_${role}`,
        title: `${role} conversation`,
        createdAt: 1,
        writable: true,
      },
    ],
  }))
  const tabRequests: { requestID: string }[] = []
  const archivedTabs = roles.map((role) => ({
    id: `archived-${role}`,
    workspaceID,
    kind: role === "master" ? "master-agent" : "operating-chat",
    conversationID: `ses_${role}_0`,
    title: `Archived ${role} conversation`,
    createdAt: 0,
    archivedAt: 10,
    writable: true,
  }))
  if (options.sessionTabs)
    archivedTabs.forEach((tab) => sessions.push({ ...sessions[0], id: tab.conversationID, title: tab.title }))
  const pack = {
    id: "ctxpk_parallel_plan",
    workspaceID,
    title: "Workspace implementation plan",
    keywords: ["design", "testing", "delivery", "hidden-fourth-keyword"],
    tags: ["ParallelPlan"],
    sensitivity: "workspace",
    revision: 1,
    contentHash: "sha256:parallel-plan",
    byteLength: 120,
    estimatedTokens: 30,
    fragments: [
      {
        id: "ctxpkf_plan_tasks",
        clientFragmentID: "plan-tasks",
        ordinal: 0,
        contentHash: "sha256:tasks",
        byteLength: 120,
        estimatedTokens: 30,
        text: "Implement the independent interface and storage tasks in parallel, then verify their integration.",
        source: {
          workspaceID,
          blockID: "block-operating",
          functionalityID: functionality[0],
          kind: "block-text",
          direction: "received",
          sourceTimestamp: 1,
          capturedAt: 1,
          entityRef: null,
          label: "Planning response",
          metadata: {},
          sensitivity: "workspace",
        },
      },
    ],
    usage: { attachedCount: 0, lastAttachedAt: null },
    createdByUserID: "fixture",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinnedAt: 1,
  }
  const prompts: {
    path: string
    body: { id: string; prompt: { text: string }; delivery: string; contextAttachments?: unknown[] }
  }[] = []
  const materializations: Record<string, unknown>[] = []
  const legacyPrompts: string[] = []
  const errors: string[] = []
  const requests: string[] = []
  const browserPrompts: Array<{
    tabID: string
    messageID: string
    text: string
    contextAttachments?: unknown[]
  }> = []
  const browserResets: Array<{ tabID?: string }> = []
  const browserOpens: Array<{ tabID: string }> = []
  const browserOptionReads: Array<{ tabID: string }> = []
  const browserConfigurations: Array<{ tabID: string; model?: string; effort?: string }> = []
  const browserActions: string[] = []
  let relayReads = 0
  let relayTab = 1
  let pendingReply: string | undefined
  let relay: ChatProxyRelay & { readonly?: boolean } = options.chatRelayDisconnected
    ? { providerID: "chatgpt", workspaceID, blockID: "block-relay", status: "disconnected", messages: [] }
    : {
        providerID: "chatgpt",
        workspaceID,
        blockID: "block-relay",
        tabID: `tab-relay-${relayTab}`,
        status: "idle",
        messages: [
          {
            id: "relay-previous-answer",
            role: "assistant",
            text: "ChatGPT independent previous answer",
            createdAt: 1,
          },
        ],
      }
  const relayTabs = {
    revision: 1,
    selectedTabID: relay.tabID,
    items: relay.tabID
      ? [
          {
            id: relay.tabID,
            workspaceID,
            kind: "chat-relay",
            blockID: "block-relay",
            conversationID: relay.tabID,
            title: "Relay conversation",
            createdAt: 1,
            writable: true,
          },
        ]
      : [],
  }
  const relayArchive = [
    {
      id: "archived-relay",
      workspaceID,
      kind: "chat-relay",
      conversationID: "archived-relay",
      title: "Archived Relay conversation",
      createdAt: 0,
      archivedAt: 1,
      writable: true,
    },
  ]
  const relayPages = new Map<string, ChatProxyRelay & { readonly?: boolean }>([
    [
      "archived-relay",
      {
        providerID: "chatgpt",
        workspaceID,
        blockID: "",
        tabID: "archived-relay",
        status: "idle",
        messages: [{ id: "archived-reply", role: "assistant", text: "Archived ChatGPT answer", createdAt: 1 }],
      },
    ],
  ])
  if (options.chatRelayControls)
    Object.assign(relay, {
      controls: {
        model: { value: "gpt-5", label: "GPT-5", options: [{ id: "gpt-5", label: "GPT-5" }] },
        effort: {
          value: "auto",
          label: "Auto",
          options: [
            { id: "auto", label: "Auto" },
            { id: "fast", label: "Fast", disabled: true },
          ],
        },
      },
    })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    requests.push(`${request.method()} ${path}`)
    if (request.method() === "POST" && /^\/session\/[^/]+\/(message|prompt_async)$/.test(path)) legacyPrompts.push(path)
  })
  const transport = await installSseTransport(page, { server })
  await mockOpenCodeServer(page, {
    protocol,
    directory,
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              limit: { context: 200000 },
              cost: { input: 0, output: 0 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { opencode: "test-model" },
    },
    project: {
      id: "proj_chat",
      worktree: directory,
      vcs: "git",
      name: "Chat workspace",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    sessions,
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (value: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(value),
        headers: { "access-control-allow-origin": "*" },
      })
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "*",
        },
      })
    if (path === "/api/provider")
      return json({ location, data: [{ id: "opencode", name: "OpenCode", integrationID: "opencode", settings: {} }] })
    if (path === "/api/model")
      return json({
        location,
        data: [
          {
            ...model,
            modelID: "test-model",
            name: "Test Model",
            capabilities: { input: ["text"], output: ["text"], tools: true },
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            variants: [],
            time: { released: 1 },
            enabled: true,
            limit: { context: 200000, output: 8192 },
            status: "active",
          },
        ],
      })
    if (path === "/api/model/default") return json({ location, data: model })
    if (path === "/api/integration")
      return json({
        location,
        data: [
          { id: "opencode", name: "OpenCode", connections: [{ type: "env", name: "FIXTURE_MODEL" }], methods: [] },
        ],
      })
    if (path === "/api/workspace") return json([workspace])
    if (path === `/api/workspace/${workspaceID}`) return json(workspace)
    if (path === `/api/workspace/${workspaceID}/functionality`)
      return json(
        functionality.map((id) => ({ id, kind: "builtin", label: id, minW: 4, minH: 4, maxW: null, maxH: null })),
      )
    if (path === "/api/workspace/layout") return json(layout)
    if (path === "/api/workspace/layout/save") return json({ status: "saved", layout })
    if (path === `/api/workspace/${workspaceID}/ctxpack`)
      return json({
        items: [
          {
            ...pack,
            fragments: undefined,
            fragmentCount: 1,
            sourceBlockIDs: ["block-operating"],
            sourceFunctionalityIDs: [functionality[0]],
            sourceKinds: ["block-text"],
          },
        ],
        nextCursor: null,
        totalEstimate: 1,
      })
    if (path === `/api/workspace/${workspaceID}/ctxpack/${pack.id}`) return json(pack)
    if (path === `/api/workspace/${workspaceID}/ctxpack/${pack.id}/materialize`) {
      materializations.push(request.postDataJSON())
      return json({
        contextCapsuleID: "ctxkpsl_parallel_plan",
        sourceCtxPackID: pack.id,
        label: pack.title,
        tags: pack.tags,
        contentHash: pack.contentHash,
        estimatedTokens: pack.estimatedTokens,
      })
    }
    if (path === "/api/chat-proxy")
      return json({
        id: "chatgpt",
        name: "ChatGPT",
        status: options.chatRelayDisconnected ? "disconnected" : "ready",
      })
    if (path === "/api/chat-proxy/connect" || path === "/api/chat-proxy/open") {
      browserActions.push(path)
      return json({ id: "chatgpt", name: "ChatGPT", status: "opening" })
    }
    const relayPath = `/api/workspace/${workspaceID}/chat-relay/block-relay/browser`
    if (path === relayPath && request.method() === "GET") {
      relayReads += 1
      if (pendingReply) {
        relay = {
          ...relay,
          status: "idle",
          messages: [
            ...relay.messages,
            {
              id: `relay-assistant-${browserPrompts.length}`,
              role: "assistant",
              text: pendingReply,
              createdAt: 10 + browserPrompts.length,
            },
          ],
        }
        pendingReply = undefined
      }
      return json(relay)
    }
    if (path === `${relayPath}/ensure`) return json(relay)
    if (path === `${relayPath}/prompt`) {
      const body: {
        tabID: string
        messageID: string
        text: string
        contextAttachments?: unknown[]
      } = request.postDataJSON()
      if (relay.readonly || relay.status === "closed" || body.tabID !== relay.tabID)
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "ChatProxyRequestError", message: "Tab is read-only or no longer selected" }),
        })
      browserPrompts.push(body)
      if (options.chatRelayRejectFirstPrompt && browserPrompts.length === 1)
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            name: "ChatProxyRequestError",
            data: { message: "ChatGPT rejected the message" },
          }),
          headers: { "access-control-allow-origin": "*" },
        })
      relay = {
        ...relay,
        status: "thinking",
        messages: [
          ...relay.messages,
          { id: body.messageID, role: "user", text: body.text, createdAt: 10 + browserPrompts.length },
        ],
      }
      pendingReply = `ChatGPT mirrored response for ${body.text}`
      return json(relay)
    }
    if (path === `${relayPath}/options`) {
      const body = request.postDataJSON()
      browserOptionReads.push(body)
      Object.assign(relay, {
        controls: {
          model: {
            value: "gpt-5",
            label: "GPT-5",
            options: [
              { id: "gpt-5", label: "GPT-5" },
              { id: "gpt-4o", label: "GPT-4o" },
            ],
          },
          effort: {
            value: "auto",
            label: "Auto",
            options: [
              { id: "auto", label: "Auto" },
              { id: "high", label: "High" },
            ],
          },
        },
      })
      return json(relay)
    }
    if (path === `${relayPath}/configure`) {
      const body: { tabID: string; model?: string; effort?: string } = request.postDataJSON()
      browserConfigurations.push(body)
      if (options.chatRelayConfigureError)
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            name: "ChatProxyRequestError",
            data: { message: options.chatRelayConfigureError },
          }),
          headers: { "access-control-allow-origin": "*" },
        })
      const controls = (
        relay as ChatProxyRelay & {
          controls: {
            model?: { value?: string; label?: string; options: Array<{ id: string; label: string }> }
            effort?: { value?: string; label?: string; options: Array<{ id: string; label: string }> }
          }
        }
      ).controls
      if (body.model && controls.model) {
        controls.model.value = body.model
        controls.model.label = controls.model.options.find((option) => option.id === body.model)?.label
      }
      if (body.effort && controls.effort) {
        controls.effort.value = body.effort
        controls.effort.label = controls.effort.options.find((option) => option.id === body.effort)?.label
      }
      return json(relay)
    }
    if (path === `${relayPath}/reset`) {
      browserResets.push(request.postDataJSON())
      relayTab += 1
      pendingReply = undefined
      relay = { ...relay, tabID: `tab-relay-${relayTab}`, status: "idle", messages: [] }
      return json(relay)
    }
    if (path === `${relayPath}/open`) {
      browserOpens.push(request.postDataJSON())
      return json(relay)
    }
    if (path.includes("/canvas-tab/chat-relay/")) {
      if (path.endsWith("/archived")) {
        const search = new URL(request.url()).searchParams.get("search")?.toLowerCase()
        return json({
          items: relayArchive.filter((tab) => !search || tab.title.toLowerCase().includes(search) || tab.id === search),
          next: null,
        })
      }
      if (request.method() === "GET")
        return json({ ...relayTabs, selectedTabID: relayTabs.selectedTabID ?? null, next: null })
      const body = request.postDataJSON()
      if (body.expectedRevision !== relayTabs.revision || relay.status === "thinking")
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "CanvasTabStaleRevisionError", message: "Tab changed or is busy" }),
        })
      if (relay.tabID) relayPages.set(relay.tabID, relay)
      if (path.endsWith("/create")) {
        tabRequests.push(body)
        relay = {
          providerID: "chatgpt",
          workspaceID,
          blockID: "block-relay",
          tabID: body.requestID,
          status: "idle",
          readonly: false,
          messages: [],
        }
        relayTabs.items.unshift({
          id: body.requestID,
          workspaceID,
          kind: "chat-relay",
          blockID: "block-relay",
          conversationID: body.requestID,
          title: "Fresh Relay conversation",
          createdAt: ++relayTab,
          writable: true,
        })
      } else {
        if (path.endsWith("/restore")) {
          const index = relayArchive.findIndex((tab) => tab.id === body.tabID)
          if (index < 0) return route.fulfill({ status: 404 })
          const { archivedAt, ...tab } = relayArchive.splice(index, 1)[0]
          relayTabs.items.push({ ...tab, blockID: "block-relay" })
        }
        const selected = relayTabs.items.find((tab) => tab.id === body.tabID)
        const page = relayPages.get(body.tabID)
        if (!selected || !page) return route.fulfill({ status: 404 })
        relay = { ...page, blockID: "block-relay" }
      }
      relayTabs.selectedTabID = relay.tabID
      relayTabs.revision++
      return json({ selected: relayTabs.items.find((tab) => tab.id === relay.tabID), revision: relayTabs.revision })
    }
    const registry = options.sessionTabs
      ? canvasTabs.find((tabs) => path.includes(`/canvas-tab/${tabs.kind}/`))
      : undefined
    if (registry) {
      if (path.endsWith("/archived"))
        return json({ items: archivedTabs.filter((tab) => tab.kind === registry.kind), next: null })
      if (request.method() === "GET")
        return json({
          items: registry.items,
          selectedTabID: registry.selectedTabID,
          revision: registry.revision,
          bindingRevision: registry.revision,
          next: null,
        })
      if (path.endsWith("/create")) {
        const body = request.postDataJSON()
        tabRequests.push(body)
        const session = {
          ...sessions.find((session) => session.id === `ses_${registry.role}`)!,
          id: `ses_${registry.role}_${registry.revision + 1}`,
          title: `Fresh ${registry.role} conversation`,
        }
        sessions.push(session)
        const tab = {
          ...registry.items[0],
          id: body.requestID,
          conversationID: session.id,
          title: session.title,
          createdAt: registry.revision + 1,
        }
        registry.items.unshift(tab)
        registry.selectedTabID = tab.id
        registry.revision++
        return json({ selected: tab, revision: registry.revision, bindingRevision: registry.revision })
      }
      if (path.endsWith("/select")) {
        const tab = registry.items.find((tab) => tab.id === request.postDataJSON().tabID)!
        registry.selectedTabID = tab.id
        registry.revision++
        return json({ selected: tab, revision: registry.revision, bindingRevision: registry.revision })
      }
      if (path.endsWith("/restore")) {
        const index = archivedTabs.findIndex(
          (tab) => tab.id === request.postDataJSON().tabID && tab.kind === registry.kind,
        )
        const { archivedAt, ...restored } = archivedTabs.splice(index, 1)[0]
        const tab = { ...restored, blockID: `block-${registry.role}` }
        registry.items.push(tab)
        registry.selectedTabID = tab.id
        registry.revision++
        return json({ selected: tab, revision: registry.revision, bindingRevision: registry.revision })
      }
      return route.fallback()
    }
    const role = roles.find((role) => path.includes(`/block-${role}`))
    if (role) {
      const binding = {
        workspaceID,
        blockID: `block-${role}`,
        functionalityInstanceID: `instance-${role}`,
        sessionID: options.sessionTabs
          ? canvasTabs
              .find((tabs) => tabs.role === role)!
              .items.find((tab) => tab.id === canvasTabs.find((tabs) => tabs.role === role)!.selectedTabID)!
              .conversationID
          : `ses_${role}`,
        directory,
        generation: 1,
        revision: 1,
      }
      return json(path.endsWith("/ensure") ? binding : { status: "bound", binding })
    }
    const sessionID = path.match(/^\/api\/session\/(ses_(?:operating|master)(?:_\d+)?)(?:\/|$)/)?.[1]
    if (sessionID && path.endsWith("/message"))
      return json({
        data:
          sessionID === "ses_operating"
            ? []
            : [
                {
                  id: `msg_${sessionID}_question`,
                  type: "user",
                  time: { created: 1 },
                  text: `${sessionID} previous question`,
                },
                {
                  id: `msg_${sessionID}_answer`,
                  type: "assistant",
                  time: { created: 2, completed: 3 },
                  agent: "build",
                  model,
                  cost: 0,
                  tokens,
                  content: [
                    { type: "text", id: `text_${sessionID}`, text: `${sessionID} independent previous answer` },
                  ],
                },
              ].toReversed(),
        cursor: {},
      })
    if (sessionID && path === `/api/session/${sessionID}`)
      return json({ data: currentSession(sessions.find((session) => session.id === sessionID)!, directory) })
    if (/^\/api\/session\/[^/]+\/prompt$/.test(path)) {
      const body = request.postDataJSON()
      prompts.push({ path, body })
      return json({
        data: {
          admittedSeq: prompts.length,
          id: body.id,
          sessionID: path.split("/")[3],
          prompt: body.prompt,
          delivery: body.delivery,
          timeCreated: 5,
        },
      })
    }
    return route.fallback()
  })
  await page.route("**/config?*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ permission: "allow" }) }),
  )
  await page.route("**/config", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ permission: "allow" }) }),
  )
  await page.addInitScript(
    ({ directory, workspaceID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.canvas.workspaceID.v1", workspaceID)
    },
    { directory, workspaceID },
  )
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto(`/server/${Buffer.from(server).toString("base64url")}/session/ses_route`)
  if (options.waitForSse !== false) await transport.waitForConnection()

  return {
    directory,
    workspaceID,
    server,
    roles,
    model,
    tokens,
    pack,
    prompts,
    materializations,
    legacyPrompts,
    errors,
    requests,
    browserPrompts,
    browserResets,
    browserOpens,
    browserOptionReads,
    browserConfigurations,
    browserActions,
    relayReads: () => relayReads,
    relayTab: () => relay.tabID,
    restartRelay: () => {
      if (relay.tabID) relayPages.set(relay.tabID, relay)
      relayPages.forEach((page, id) =>
        relayPages.set(id, { ...page, status: "closed", readonly: true, controls: undefined }),
      )
      if (relay.tabID) relay = relayPages.get(relay.tabID)!
      relayTabs.items.forEach((tab) => {
        tab.writable = false
      })
      relayArchive.forEach((tab) => {
        tab.writable = false
      })
      pendingReply = undefined
    },
    transport,
    canvasTabs,
    tabRequests,
    layout,
  }
}
