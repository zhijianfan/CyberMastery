import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import path from "node:path"
import readline from "node:readline"
import { chromium } from "playwright"

const chatGPT = "https://chatgpt.com/"
const composerSelector =
  '#mobile-composer-prompt[data-mobile-composer-prompt], #prompt-textarea, main textarea, main [contenteditable="true"]'
const sendSelector = 'button[aria-label="Send message"], button[data-testid="send-button"]'
const assistantSelector = '[data-message-author-role="assistant"]'
const transcriptTurnSelector = 'ol[data-conversation-transcript][aria-label="Conversation"] [id^="turn-"]'
const generatingSelector =
  'button[aria-label="Stop generating"], button[data-testid="stop-button"], [data-message-author-role="assistant"][data-is-streaming="true"], ol[data-conversation-transcript][aria-busy="true"]'
const menuSelector = '[role="menu"]:visible, [role="listbox"]:visible'
const optionSelector = '[role="menuitem"], [role="menuitemradio"], [role="option"]'
const controlSelectors = {
  model:
    'button[data-testid="model-switcher-dropdown-button"], button[data-testid^="model-" i][aria-haspopup], button[aria-label^="Select model" i][aria-haspopup], button[aria-label^="Choose model" i][aria-haspopup]',
  effort:
    'button[data-testid*="effort" i][aria-haspopup], button[data-testid*="reasoning" i][aria-haspopup], button[aria-label*="effort" i][aria-haspopup], button[aria-label*="reasoning" i][aria-haspopup], button[aria-label*="thinking" i][aria-haspopup]',
}

export function createChatProxyWorker(overrides = {}) {
  const browser = overrides.chromium ?? chromium
  const spawnBrowser = overrides.spawn ?? spawn
  const browserExecutable = overrides.edgeExecutable ?? edgeExecutable
  const uuid = overrides.randomUUID ?? randomUUID
  const sleep = overrides.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const sessions = new Map()
  const ownerships = new Map()
  const launches = new Map()
  const failures = new Map()
  const logins = new Map()
  const loginRequired = new Set()
  const userOperations = new Map()
  const restored = new Set()
  let shutdownPromise
  let stopping = false

  async function execute(request) {
    if (request.method === "shutdown") {
      await shutdown()
      return {}
    }
    if (request.method === "status") return provider(request.user)
    if (request.method === "restore") return restore(request.user, request.profile)
    if (request.method === "connect") return connect(request.user, request.profile)
    if (request.method === "open") return open(request.user, request.profile)
    if (request.method === "ensure") return ensure(request.user, request.workspaceID, request.blockID, request.profile)
    if (request.method === "reset")
      return reset(request.user, request.workspaceID, request.blockID, request.profile, request.tabID)
    if (request.method === "relay") return relay(request.user, request.workspaceID, request.blockID)
    if (request.method === "options") return options(request.user, request.workspaceID, request.blockID, request.tabID)
    if (request.method === "configure")
      return configure(request.user, request.workspaceID, request.blockID, request.tabID, request.model, request.effort)
    if (request.method === "prompt")
      return prompt(
        request.user,
        request.workspaceID,
        request.blockID,
        request.tabID,
        request.messageID,
        request.text,
        request.browserText,
      )
    if (request.method === "openRelay")
      return openRelay(request.user, request.workspaceID, request.blockID, request.tabID)
    if (request.method === "close") return close(request.user, request.workspaceID, request.blockID)
    if (request.method === "closeWorkspace") return closeWorkspace(request.user, request.workspaceID)
    throw new Error(`Unknown Chat Proxy worker method: ${request.method}`)
  }

  async function restore(user, profile) {
    const key = sessionKey(user)
    return withUser(key, async () => {
      if (sessions.has(key) || logins.has(key) || launches.has(key) || restored.has(key)) return provider(user)
      restored.add(key)
      await sessionFor(user, profile, true)
      if (sessions.has(key)) restored.delete(key)
      return provider(user)
    }).catch((cause) => {
      failures.set(key, errorMessage(cause))
      return provider(user)
    })
  }

  async function connect(user, profile) {
    const key = sessionKey(user)
    return withUser(key, async () => {
      if (logins.has(key) || launches.has(key)) return provider(user)
      const session = sessions.get(key)
      if (session?.loginPage.isClosed()) await openLoginPage(session)
      if (session && (await inspectPage(session.loginPage)).status === "ready") return provider(user)
      if (session) await closeSession(key, session)
      loginRequired.delete(key)
      openLogin(user, key, profile)
      return provider(user)
    })
  }

  async function open(user, profile) {
    const key = sessionKey(user)
    return withUser(key, async () => {
      if (logins.has(key) || launches.has(key)) return provider(user)
      const session = sessions.get(key)
      if (session?.loginPage.isClosed()) await openLoginPage(session)
      if (!session || (await inspectPage(session.loginPage)).status !== "ready") {
        if (session) await closeSession(key, session)
        loginRequired.delete(key)
        openLogin(user, key, profile)
        return provider(user)
      }
      await openLoginPage(session)
      return provider(user)
    })
  }

  function withUser(key, operation) {
    const previous = userOperations.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    userOperations.set(key, current)
    return current.finally(() => {
      if (userOperations.get(key) === current) userOperations.delete(key)
    })
  }

  function ownershipFor(key) {
    const current = ownerships.get(key)
    if (current) return current
    const ownership = { tabs: new Map(), ownerOperations: new Map() }
    ownerships.set(key, ownership)
    return ownership
  }

  function openLogin(user, key, profile) {
    if (!profile) throw new Error("Chat Proxy browser profile is missing")
    const child = spawnBrowser(
      browserExecutable(),
      [
        `--user-data-dir=${profile}`,
        "--disable-background-mode",
        "--disable-features=msEdgeStartupBoost",
        "--new-window",
        chatGPT,
      ],
      { stdio: "ignore", windowsHide: false },
    )
    const login = { child, profile, closing: false }
    logins.set(key, login)
    child.once("error", (cause) => {
      if (logins.get(key) !== login) return
      logins.delete(key)
      failures.set(key, errorMessage(cause))
    })
    child.once("exit", () => {
      if (logins.get(key) !== login) return
      logins.delete(key)
      if (login.closing) return
      void sessionFor(user, profile).catch(() => undefined)
    })
  }

  async function openLoginPage(session) {
    if (session.loginPage.isClosed()) {
      session.loginPage = await session.context.newPage()
      await navigate(session.loginPage, session)
    }
    await session.loginPage.bringToFront()
  }

  async function sessionFor(user, profile, restoring = false) {
    if (stopping) throw new Error("Chat Proxy browser worker is stopping")
    if (!profile) throw new Error("Chat Proxy browser profile is missing")
    const key = sessionKey(user)
    const current = sessions.get(key)
    if (current) {
      if (path.resolve(current.profile) !== path.resolve(profile))
        throw new Error("Chat Proxy browser profile does not match the connected account")
      return current
    }
    const pending = launches.get(key)
    if (pending) return pending
    const launching = launch(user, key, profile, restoring)
      .then((session) => {
        failures.delete(key)
        if (session) loginRequired.delete(key)
        return session
      })
      .catch((cause) => {
        failures.set(key, errorMessage(cause))
        throw browserError(cause)
      })
      .finally(() => launches.delete(key))
    launches.set(key, launching)
    return launching
  }

  async function launch(user, key, profile, restoring) {
    const executablePath = process.env.OPENCODE_CHAT_PROXY_EDGE
    const context = await launchContext(profile, {
      ...(executablePath ? { executablePath } : { channel: "msedge" }),
      headless: false,
      viewport: null,
      args: [restoring ? "--start-minimized" : "--start-maximized"],
      timeout: 30_000,
    })
    const pages = context.pages()
    const loginPage = pages[0] ?? (await context.newPage())
    const ownership = ownershipFor(key)
    const session = {
      context,
      loginPage,
      tabs: ownership.tabs,
      ownerOperations: ownership.ownerOperations,
      profile,
      closing: false,
      error: undefined,
      loginRequired: false,
    }
    await context.route(/^https:\/\/(?:auth\.openai\.com(?:\/|$)|chatgpt\.com\/auth\/)/, (route) => {
      if (!route.request().isNavigationRequest()) return route.continue()
      session.loginRequired = true
      return route.abort()
    })
    await Promise.all(pages.filter((page) => page !== loginPage).map((page) => page.close().catch(() => undefined)))
    await navigate(loginPage, session, restoring ? "domcontentloaded" : "commit")
    if (restoring)
      await loginPage
        .locator(composerSelector)
        .last()
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => undefined)
    if (stopping) {
      await context.close().catch(() => undefined)
      throw new Error("Chat Proxy browser worker is stopping")
    }
    const inspected = await inspectPage(loginPage)
    if (session.loginRequired || inspected.status === "login-required" || (restoring && inspected.status !== "ready")) {
      loginRequired.add(key)
      await context.close().catch(() => undefined)
      return
    }
    sessions.set(key, session)
    context.on("close", () => {
      restored.add(key)
      session.tabs.forEach((state) => {
        if (state.status === "closed" || !state.page.isClosed()) return
        state.status = "error"
        state.error = "The ChatGPT browser closed. Reconnect in Settings, then reset this ChatRelay block."
      })
      if (sessions.get(key)?.context === context) sessions.delete(key)
    })
    await loginPage.bringToFront()
    return session
  }

  async function launchContext(profile, options, attempt = 0) {
    return browser.launchPersistentContext(profile, options).catch(async (cause) => {
      if (
        !/opening in existing browser session|target page, context or browser has been closed/i.test(
          errorMessage(cause),
        )
      )
        throw cause
      if (attempt >= 19)
        throw new Error("The ChatGPT sign-in browser is still using its profile. Close that window and try again.")
      await new Promise((resolve) => setTimeout(resolve, 500))
      return launchContext(profile, options, attempt + 1)
    })
  }

  async function provider(user) {
    const key = sessionKey(user)
    if (logins.has(key)) return { id: "chatgpt", name: "ChatGPT", status: "login-required" }
    if (launches.has(key)) return { id: "chatgpt", name: "ChatGPT", status: "opening" }
    const session = sessions.get(key)
    if (!session) {
      const error = failures.get(key)
      return {
        id: "chatgpt",
        name: "ChatGPT",
        status: error ? "error" : loginRequired.has(key) ? "login-required" : "disconnected",
        error,
      }
    }
    const page = session.loginPage.isClosed()
      ? [...session.tabs.values()].find((tab) => !tab.page.isClosed() && tab.status !== "closed")?.page
      : session.loginPage
    if (!page) {
      session.error = "The ChatGPT login page was closed. Open ChatGPT again to continue."
      return { id: "chatgpt", name: "ChatGPT", status: "error", error: session.error }
    }
    const state = await inspectPage(page)
    if (state.status === "login-required") return { id: "chatgpt", name: "ChatGPT", status: "login-required" }
    if (session.error && state.status !== "ready")
      return { id: "chatgpt", name: "ChatGPT", status: "error", error: session.error }
    if (state.status === "ready") session.error = undefined
    return { id: "chatgpt", name: "ChatGPT", status: state.status, error: state.error }
  }

  async function ensure(user, workspaceID, blockID) {
    return relay(user, workspaceID, blockID)
  }

  async function reset(user, workspaceID, blockID, profile, expectedTabID) {
    const userKey = sessionKey(user)
    if (logins.has(userKey)) return unavailable(workspaceID, blockID, await provider(user))
    const session = sessions.get(userKey)
    if (!session) return unavailable(workspaceID, blockID, await provider(user))
    if (!ownerships.has(userKey)) ownerships.set(userKey, session)
    const key = ownerKey(workspaceID, blockID)
    return withOwner(session, key, async () => {
      const current = session.tabs.get(key)
      if (current && current.tabID !== expectedTabID) throw staleTab()
      if (current) await closeState(current)
      const connection = await provider(user)
      if (connection.status !== "ready") return unavailable(workspaceID, blockID, connection)
      return snapshot(await createTab(session, workspaceID, blockID, key))
    })
  }

  async function relay(user, workspaceID, blockID) {
    const userKey = sessionKey(user)
    const key = ownerKey(workspaceID, blockID)
    const session = sessions.get(userKey)
    if (!session) {
      const state = ownerships.get(userKey)?.tabs.get(key)
      if (state) {
        if (state.page.isClosed() && state.status !== "closed") {
          state.status = "error"
          state.error = "The ChatGPT browser closed. Reconnect in Settings, then reset this ChatRelay block."
        }
        return snapshot(state)
      }
      return unavailable(workspaceID, blockID, await provider(user))
    }
    if (!ownerships.has(userKey)) ownerships.set(userKey, session)
    return withOwner(session, key, async () => {
      const connection = await provider(user)
      const state = session.tabs.get(key)
      if (!state) {
        if (connection.status !== "ready") return unavailable(workspaceID, blockID, connection)
        return snapshot(await createTab(session, workspaceID, blockID, key))
      }
      if (state.page.isClosed() && state.status !== "closed") {
        state.status = "error"
        state.error = "The ChatGPT tab was closed. Reinitialize this ChatRelay block to continue."
      }
      if (connection.status !== "ready" && state.status !== "closed") {
        return { ...snapshot(state), status: connection.status, error: connection.error }
      }
      await refreshTab(state)
      return snapshot(state)
    })
  }

  function withOwner(session, key, operation) {
    const previous = session.ownerOperations.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    session.ownerOperations.set(key, current)
    return current.finally(() => {
      if (session.ownerOperations.get(key) === current) session.ownerOperations.delete(key)
    })
  }

  async function prompt(user, workspaceID, blockID, tabID, messageID, text, browserText) {
    const value = text?.trim()
    const browserValue = (browserText ?? text)?.trim()
    if (!value || !browserValue) throw new Error("Message cannot be empty")
    if (!messageID) throw new Error("Message ID is required")
    const state = requireTab(user, workspaceID, blockID, tabID)
    if (state.controlOperation) throw new Error("ChatGPT controls are already being updated")
    const admitted = state.admitted.get(messageID)
    if (admitted) {
      if (admitted !== JSON.stringify([value, browserValue]))
        throw new Error("Message ID was already used with different text")
      return snapshot(state)
    }
    if (state.status === "thinking") throw new Error("This ChatGPT tab is already waiting for a response")
    if (state.status === "closed" || state.page.isClosed()) throw new Error("The ChatGPT tab is closed")

    state.status = "thinking"
    state.error = undefined
    const observation = await beginPrompt(state, browserValue, () => {
      state.admitted.set(messageID, JSON.stringify([value, browserValue]))
      state.messages.push({ id: messageID, role: "user", text: value, createdAt: Date.now() })
    }).catch((cause) => {
      failTab(state, cause)
      throw cause
    })
    const response = { id: uuid(), role: "assistant", text: "", createdAt: Date.now() }
    state.messages.push(response)
    void readReply(state, response, observation).catch((cause) => failTab(state, cause))
    return snapshot(state)
  }

  async function options(user, workspaceID, blockID, tabID) {
    const state = requireTab(user, workspaceID, blockID, tabID)
    return withControls(state, async () => {
      state.controls = await readControls(state.page, state.controls)
      return snapshot(state)
    })
  }

  async function configure(user, workspaceID, blockID, tabID, model, effort) {
    const state = requireTab(user, workspaceID, blockID, tabID)
    return withControls(state, async () => {
      const error = await Promise.resolve()
        .then(async () => {
          if (model !== undefined) {
            await applyChoice(state.page, "model", model)
          }
          if (effort !== undefined) await applyChoice(state.page, "effort", effort)
        })
        .then(
          () => undefined,
          (cause) => errorMessage(cause),
        )
      state.controls =
        (await readControls(state.page, state.controls).catch((cause) => ({
          ...state.controls,
          error: errorMessage(cause),
        }))) ?? {}
      const modelApplied = model === undefined || state.controls.model?.value === model
      const effortApplied = effort === undefined || state.controls.effort?.value === effort
      if (error) state.controls.error = error
      else if (!modelApplied) state.controls.error = "ChatGPT model option was not applied"
      else if (!effortApplied) state.controls.error = "ChatGPT effort option was not applied"
      return snapshot(state)
    })
  }

  function withControls(state, operation) {
    if (state.status !== "idle") throw new Error("ChatGPT controls are available only while this tab is idle")
    if (state.controlOperation) throw new Error("ChatGPT controls are already being updated")
    const current = operation()
    state.controlOperation = current
    return current.finally(() => {
      if (state.controlOperation === current) state.controlOperation = undefined
    })
  }

  async function openRelay(user, workspaceID, blockID, tabID) {
    const state = requireTab(user, workspaceID, blockID, tabID)
    if (state.status === "closed" || state.page.isClosed()) throw new Error("The ChatGPT tab is closed")
    await state.page.bringToFront()
    return snapshot(state)
  }

  async function close(user, workspaceID, blockID) {
    const userKey = sessionKey(user)
    const ownership = ownerships.get(userKey)
    const key = ownerKey(workspaceID, blockID)
    if (!ownership) return unavailable(workspaceID, blockID, await provider(user))
    const response = await withOwner(ownership, key, async () => {
      const state = ownership.tabs.get(key)
      if (!state) return unavailable(workspaceID, blockID, await provider(user))
      await closeState(state)
      if (ownership.tabs.get(key) === state) ownership.tabs.delete(key)
      return snapshot(state)
    })
    releaseOwnership(userKey, ownership)
    return response
  }

  async function closeWorkspace(user, workspaceID) {
    const ownership = ownerships.get(sessionKey(user))
    if (!ownership) return {}
    const keys = new Set(
      [...ownership.tabs.keys(), ...ownership.ownerOperations.keys()].filter(
        (key) => JSON.parse(key)[0] === workspaceID,
      ),
    )
    await Promise.all(
      [...keys].map((key) =>
        withOwner(ownership, key, async () => {
          const state = ownership.tabs.get(key)
          if (!state || state.workspaceID !== workspaceID) return
          await closeState(state)
          if (ownership.tabs.get(key) === state) ownership.tabs.delete(key)
        }),
      ),
    )
    releaseOwnership(sessionKey(user), ownership)
    return {}
  }

  function releaseOwnership(key, ownership) {
    if (ownership.tabs.size || ownership.ownerOperations.size) return
    if (ownerships.get(key) === ownership) ownerships.delete(key)
  }

  function requireTab(user, workspaceID, blockID, tabID) {
    const state = sessions.get(sessionKey(user))?.tabs.get(ownerKey(workspaceID, blockID))
    if (!state || state.tabID !== tabID) throw staleTab()
    return state
  }

  async function createTab(session, workspaceID, blockID, key) {
    const page = await session.context.newPage()
    const state = {
      providerID: "chatgpt",
      workspaceID,
      blockID,
      tabID: uuid(),
      page,
      status: "opening",
      messages: [],
      admitted: new Map(),
      controls: undefined,
      controlOperation: undefined,
      error: undefined,
    }
    session.tabs.set(key, state)
    const response = await page.goto(chatGPT, { waitUntil: "commit", timeout: 30_000 }).catch((cause) => {
      state.status = "error"
      state.error = `Could not open ChatGPT: ${errorMessage(cause)}`
    })
    if (response && response.status() >= 400) {
      state.status = "error"
      state.error = `ChatGPT returned HTTP ${response.status()}`
    }
    if (state.status !== "error") {
      const inspected = await inspectPage(page)
      state.status = inspected.status === "ready" ? "idle" : inspected.status
      state.error = inspected.error
    }
    return state
  }

  async function readControls(page, previous) {
    await page
      .locator("#mobile-composer-prompt[data-mobile-composer-prompt]:visible, #prompt-textarea:visible")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
    await assertRegularChat(page)
    // Dismiss menus without making a choice; leave dialogs and their decisions alone.
    if (await page.locator('[role="dialog"]:visible').count())
      return { ...previous, error: "Close the open ChatGPT dialog before refreshing model options." }
    if (await page.locator(menuSelector).count()) {
      const trigger = page
        .locator(
          `:is(${controlSelectors.model}, ${controlSelectors.effort}, button.__composer-pill[aria-haspopup="menu"])[aria-expanded="true"]:visible`,
        )
        .first()
      await closeMenus(page, (await trigger.count()) ? trigger : undefined, 3)
      if (await page.locator(menuSelector).count())
        return { ...previous, error: "Close the open ChatGPT menu before refreshing model options." }
    }
    // ChatGPT can render the composer before its model picker finishes loading.
    await page
      .locator(
        `:is(${controlSelectors.model}, ${controlSelectors.effort}, button.__composer-pill[aria-haspopup="menu"]):visible`,
      )
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .catch(() => undefined)
    const errors = []
    const model = await discoverControl(page, "model").catch((cause) => {
      errors.push(`Model options: ${errorMessage(cause)}`)
    })
    const effort = await discoverControl(page, "effort").catch((cause) => {
      errors.push(`Reasoning effort options: ${errorMessage(cause)}`)
    })
    return {
      ...(model ? { model: model.value } : {}),
      ...(effort ? { effort: effort.value } : {}),
      ...(errors.length ? { error: errors.join(" ") } : {}),
    }
  }

  async function applyChoice(page, kind, id) {
    await assertRegularChat(page)
    const discovered = await discoverControl(page, kind, true)
    if (!discovered) throw new Error(`ChatGPT ${kind} control is unavailable`)
    try {
      const matches = discovered.entries.filter((entry) => entry.option.id === id)
      if (matches.length !== 1) throw new Error(`ChatGPT ${kind} option is stale or unavailable`)
      if (matches[0].option.disabled) throw new Error(`ChatGPT ${kind} option is disabled`)
      if (discovered.slider) {
        const delta = matches[0].position - discovered.slider.value
        for (let index = 0; index < Math.abs(delta); index++)
          await discovered.slider.control.press(delta > 0 ? "ArrowRight" : "ArrowLeft")
      } else await discovered.menu.locator(optionSelector).nth(matches[0].index).click()
      await assertRegularChat(page)
    } finally {
      await closeMenus(page, discovered.rootTrigger, discovered.opened)
    }
  }

  async function discoverControl(page, kind, keepOpen = false) {
    let opened = 0
    let success = false
    let rootTrigger
    try {
      if ((await page.locator(`${menuSelector}, [role="dialog"]:visible`).count()) > 0)
        throw new Error("Close the open ChatGPT menu or dialog before reading controls")
      let trigger = await visibleTrigger(page.locator(controlSelectors[kind]), kind)
      const composer =
        !trigger && (await visibleTrigger(page.locator('button.__composer-pill[aria-haspopup="menu"]'), kind))
      trigger ??= composer || undefined
      rootTrigger = trigger
      if (!trigger && kind === "effort") {
        const model = await visibleTrigger(page.locator(controlSelectors.model), "model")
        if (!model) return
        rootTrigger = model
        const parent = await openMenu(page, model, 0)
        opened += 1
        trigger = await visibleTrigger(
          parent.locator(
            '[data-testid*="effort" i][aria-haspopup], [data-testid*="reasoning" i][aria-haspopup], [aria-label*="effort" i][aria-haspopup], [aria-label*="reasoning" i][aria-haspopup], [aria-label*="thinking" i][aria-haspopup]',
          ),
          kind,
        )
        trigger ??= await visibleTrigger(
          parent
            .locator('[role="menuitem"][aria-haspopup], [role="menuitemradio"][aria-haspopup]')
            .filter({ hasText: /effort|reasoning|thinking/i }),
          kind,
        )
        if (!trigger) return
      }
      if (!trigger) return
      let menu = await openMenu(page, trigger, opened)
      opened += 1
      if (composer) {
        const picker = menu.locator('[data-testid="composer-intelligence-picker-content"]')
        if ((await picker.count()) !== 1) return
        if (kind === "model") {
          await picker.getByRole("menuitem", { name: "Select model", exact: true }).click({ timeout: 5_000 })
          menu = picker.locator('[data-testid="composer-model-picker-slider-advanced-view"][data-active="true"]')
          await menu.waitFor({ state: "visible", timeout: 5_000 })
        } else {
          const control = picker.locator('[role="menuitem"][aria-keyshortcuts="ArrowLeft ArrowRight"]')
          const slider = control.locator('[data-model-reasoning-effort-slider] [role="slider"]')
          if ((await slider.count()) !== 1) return
          const range = await slider.evaluate((node) => ({
            min: Number(node.getAttribute("aria-valuemin")),
            max: Number(node.getAttribute("aria-valuemax")),
            value: Number(node.getAttribute("aria-valuenow")),
          }))
          if (
            ![range.min, range.max, range.value].every(Number.isInteger) ||
            range.max < range.min ||
            range.max - range.min > 20
          )
            throw new Error("ChatGPT effort slider range is unsupported")
          const locked = await control
            .locator("[data-selected][data-locked]")
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-locked") === "true"))
          const label = await control.evaluate((node) => {
            const description = node.getAttribute("aria-describedby")?.split(/\s+/)[0]
            return description ? document.getElementById(description)?.textContent?.trim() : undefined
          })
          const disabled = (await control.getAttribute("aria-disabled")) === "true"
          const entries = Array.from({ length: range.max - range.min + 1 }, (_, index) => ({
            position: range.min + index,
            option: {
              id: `slider:${range.min + index}`,
              label: String(range.min + index),
              ...(disabled || locked[index] ? { disabled: true } : {}),
            },
          }))
          success = true
          return {
            rootTrigger,
            menu,
            opened,
            entries,
            slider: { control, value: range.value },
            value: { value: `slider:${range.value}`, label, options: entries.map((entry) => entry.option) },
          }
        }
      }
      const raw = await menu.locator(optionSelector).evaluateAll((nodes) =>
        nodes.map((node, index) => ({
          index,
          stableID:
            node.getAttribute("data-value") ??
            node.getAttribute("data-testid") ??
            node.getAttribute("value") ??
            undefined,
          label:
            node.getAttribute("aria-label") ?? (node instanceof HTMLElement ? node.innerText : node.textContent) ?? "",
          href: (() => {
            const link = node.closest("a[href]") ?? node.querySelector("a[href]")
            return link instanceof HTMLAnchorElement ? link.href : ""
          })(),
          submenu: node.hasAttribute("aria-haspopup") && node.getAttribute("aria-haspopup") !== "false",
          visible:
            !node.closest('[inert], [aria-hidden="true"], [data-active="false"]') &&
            node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility !== "hidden" &&
            getComputedStyle(node).display !== "none",
          disabled:
            node.getAttribute("aria-disabled") === "true" ||
            node.getAttribute("data-disabled") !== null ||
            (node instanceof HTMLButtonElement && node.disabled),
          selected:
            node.getAttribute("aria-checked") === "true" ||
            node.getAttribute("aria-selected") === "true" ||
            node.getAttribute("data-state") === "checked",
        })),
      )
      const candidates = raw
        .map((entry) => {
          const label = entry.label.replace(/\s+/g, " ").trim()
          const blocked =
            !label ||
            !entry.visible ||
            !!entry.href ||
            entry.submenu ||
            /\b(?:account|billing|customize|log\s*in|log\s*out|manage|pricing|sign\s*in|sign\s*out|upgrade|codex|work)\b/i.test(
              label,
            )
          if (blocked) return
          const opaque = createHash("sha256")
            .update(`${kind}\0${label.toLocaleLowerCase()}`)
            .digest("base64url")
            .slice(0, 16)
          return {
            index: entry.index,
            option: {
              id: entry.stableID ? `dom:${entry.stableID}` : `label:${opaque}`,
              label,
              ...(entry.disabled ? { disabled: true } : {}),
            },
            selected: entry.selected,
          }
        })
        .filter(Boolean)
      const duplicate = candidates.find(
        (entry, index) => candidates.findIndex((candidate) => candidate.option.id === entry.option.id) !== index,
      )
      if (duplicate) throw new Error(`ChatGPT ${kind} options are ambiguous`)
      const selected = candidates.find((entry) => entry.selected)
      const label = ((await trigger.innerText().catch(() => "")) || (await trigger.getAttribute("aria-label")) || "")
        .replace(/\s+/g, " ")
        .trim()
      const result = {
        rootTrigger,
        menu,
        opened,
        entries: candidates,
        value: {
          ...(selected ? { value: selected.option.id, label: selected.option.label } : label ? { label } : {}),
          options: candidates.map((entry) => entry.option),
        },
      }
      success = true
      return result
    } finally {
      if (!keepOpen || !success) await closeMenus(page, rootTrigger, opened)
    }
  }

  async function closeMenus(page, trigger, opened) {
    for (let index = 0; index < opened; index++) {
      const menus = page.locator(menuSelector)
      if (!(await menus.count().catch(() => 0))) return
      const menu = menus.last()
      if (trigger && (await trigger.getAttribute("aria-expanded").catch(() => undefined)) === "true")
        await trigger.click({ timeout: 1_000 }).catch(() => undefined)
      else await page.keyboard.press("Escape").catch(() => undefined)
      await menu.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined)
    }
  }

  async function visibleTrigger(locator, kind) {
    const visible = []
    for (let index = 0; index < (await locator.count()); index++) {
      const candidate = locator.nth(index)
      if (await candidate.isVisible().catch(() => false)) visible.push(candidate)
    }
    if (visible.length > 1) throw new Error(`ChatGPT ${kind} control is ambiguous`)
    return visible[0]
  }

  async function openMenu(page, trigger, expected) {
    const menus = page.locator(menuSelector)
    const index = await menus.count()
    if (index !== expected) throw new Error("ChatGPT menu state changed before controls could be read")
    const menu = menus.nth(index)
    await Promise.resolve()
      .then(() => trigger.click())
      .then(() => menu.waitFor({ state: "visible", timeout: 5_000 }))
      .catch(async (cause) => {
        await page.keyboard.press("Escape").catch(() => undefined)
        throw cause
      })
    return menu
  }

  async function beginPrompt(state, text, admit) {
    await assertRegularChat(state.page)
    const composer = state.page.locator(composerSelector).last()
    await composer.waitFor({ state: "visible", timeout: 15_000 })
    const assistants = state.page.locator(assistantSelector)
    const turns = state.page.locator(transcriptTurnSelector)
    const observation = { assistants: await assistants.count(), turns: await turns.count(), text }
    await composer.fill(text, { timeout: 10_000 })
    await assertRegularChat(state.page)
    const send = state.page.locator(sendSelector).last()
    await send.waitFor({ state: "visible", timeout: 10_000 })
    if (!(await send.isEnabled())) throw new Error("ChatGPT Send is unavailable")
    admit()
    await send.click({ timeout: 10_000 })
    return observation
  }

  async function readReply(state, message, observation) {
    const deadline = Date.now() + 300_000
    let previous = ""
    let stable = 0
    while (Date.now() < deadline) {
      if (state.status === "closed" || state.page.isClosed()) throw new Error("The ChatGPT tab was closed")
      await assertRegularChat(state.page)
      const next = await responseText(state.page, observation)
      if (next) message.text = next
      const alert = state.page.locator('main [role="alert"]').last()
      const alertText = (await alert.isVisible().catch(() => false)) ? (await alert.innerText()).trim() : ""
      if (alertText && /error|failed|problem|try again|unusual activity|rate limit|too many requests/i.test(alertText))
        throw new Error(alertText)
      const generating = await state.page
        .locator(generatingSelector)
        .last()
        .isVisible()
        .catch(() => false)
      stable = next && next === previous ? stable + 1 : 0
      if (next && stable >= 10 && !generating) {
        state.status = "idle"
        state.error = undefined
        return
      }
      previous = next
      await sleep(500)
    }
    throw new Error("ChatGPT did not finish responding within five minutes")
  }

  async function responseText(page, observation) {
    const assistants = page.locator(assistantSelector)
    const assistantCount = await assistants.count()
    if (assistantCount > observation.assistants) return (await assistants.nth(assistantCount - 1).innerText()).trim()
    const turns = page.locator(transcriptTurnSelector)
    const turnCount = await turns.count()
    if (turnCount < observation.turns + 2) return ""
    const value = (await turns.nth(turnCount - 1).innerText()).trim()
    return value === observation.text ? "" : value
  }

  async function assertRegularChat(page) {
    const inspected = await inspectPage(page)
    if (inspected.status !== "ready")
      throw new Error(
        inspected.error ??
          (inspected.status === "login-required"
            ? "ChatGPT login is required. Complete it in the visible browser and try again."
            : "ChatGPT Chat is not ready. Finish login or browser verification and try again."),
      )
    const url = safeURL(page.url())
    if (!url || url.origin !== "https://chatgpt.com" || (url.pathname !== "/" && !url.pathname.startsWith("/c/")))
      throw new Error("ChatRelay only sends from a regular ChatGPT Chat tab")
    const selected = page.locator('[aria-current="page"], [aria-selected="true"], [data-state="active"]')
    const labels = await selected.allTextContents().catch(() => [])
    const selectedModes = await selected
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node instanceof HTMLAnchorElement ? node.href : "",
          marker: `${node.getAttribute("data-testid") ?? ""} ${node.getAttribute("data-mode") ?? ""}`,
        })),
      )
      .catch(() => [])
    if (
      labels.some((label) => label.trim().toLowerCase() === "work") ||
      selectedModes.some(
        (mode) => /\/(?:codex|work)(?:\/|$)/i.test(mode.href) || /\b(?:codex|work)\b/i.test(mode.marker),
      )
    )
      throw new Error("ChatRelay will not send from ChatGPT Work mode. Switch this tab to Chat and try again.")
    const identifiedChat = await page
      .locator("#mobile-composer-prompt[data-mobile-composer-prompt], #prompt-textarea")
      .last()
      .isVisible()
      .catch(() => false)
    if (!identifiedChat && !labels.some((label) => label.trim().toLowerCase() === "chat"))
      throw new Error("ChatRelay could not confirm that this is a regular ChatGPT Chat tab")
    const composer = page.locator(composerSelector).last()
    if (!(await composer.isVisible().catch(() => false)))
      throw new Error("ChatGPT Chat is not ready. Finish login or browser verification and try again.")
  }

  async function inspectPage(page) {
    if (page.isClosed()) return { status: "error", error: "The ChatGPT page was closed" }
    const url = safeURL(page.url())
    if (url && (/auth\.openai\.com$/i.test(url.hostname) || url.pathname.startsWith("/auth/")))
      return { status: "login-required" }
    if (url && (/challenge|captcha/i.test(url.pathname) || /challenge|captcha/i.test(url.hostname)))
      return { status: "error", error: "ChatGPT requires browser verification. Complete it in the visible browser." }
    const challenge = page.getByText(/verify you are human|checking your browser|unusual activity/i).first()
    if (await challenge.isVisible().catch(() => false))
      return { status: "error", error: "ChatGPT requires browser verification. Complete it in the visible browser." }
    const login = page.getByRole("button", { name: /log in|sign up/i }).first()
    if (await login.isVisible().catch(() => false)) return { status: "login-required" }
    if (
      await page
        .locator(composerSelector)
        .last()
        .isVisible()
        .catch(() => false)
    )
      return { status: "ready" }
    return { status: "opening" }
  }

  async function refreshTab(state) {
    const recoverable =
      state.status === "opening" ||
      state.status === "login-required" ||
      (state.status === "error" && state.error?.includes("requires browser verification"))
    if (!recoverable || state.page.isClosed()) return
    const inspected = await inspectPage(state.page)
    state.status = inspected.status === "ready" ? "idle" : inspected.status
    state.error = inspected.error
  }

  async function navigate(page, session, waitUntil = "commit") {
    const response = await page.goto(chatGPT, { waitUntil, timeout: 30_000 }).catch((cause) => {
      session.error = `Could not open ChatGPT: ${errorMessage(cause)}`
    })
    if (response && response.status() >= 400) session.error = `ChatGPT returned HTTP ${response.status()}`
  }

  async function closeState(state) {
    if (!state.page.isClosed()) await state.page.close()
    if (!state.page.isClosed()) throw new Error("ChatGPT page did not close")
    state.status = "closed"
    state.error = undefined
  }

  async function closeSession(key, session) {
    session.closing = true
    if (sessions.get(key) === session) sessions.delete(key)
    await session.context.close().catch(() => undefined)
  }

  function failTab(state, cause) {
    if (state.status === "closed") return
    state.status = "error"
    state.error = errorMessage(cause)
  }

  function shutdown() {
    stopping = true
    logins.forEach((login) => {
      login.closing = true
      login.child.kill()
    })
    logins.clear()
    loginRequired.clear()
    shutdownPromise ??= Promise.allSettled([...launches.values()])
      .then(() =>
        Promise.all(
          [...sessions.values()].map((session) => {
            session.closing = true
            return session.context.close().catch(() => undefined)
          }),
        ),
      )
      .then(() => sessions.clear())
    return shutdownPromise
  }

  return { execute, shutdown }
}

function snapshot(state) {
  return {
    providerID: "chatgpt",
    workspaceID: state.workspaceID,
    blockID: state.blockID,
    tabID: state.tabID,
    status: state.status,
    messages: state.messages.map((message) => ({ ...message })),
    controls: state.controls ? structuredClone(state.controls) : undefined,
    url: safeChatGPTURL(state.page.url()),
    error: state.error,
  }
}

function unavailable(workspaceID, blockID, provider) {
  return {
    providerID: "chatgpt",
    workspaceID,
    blockID,
    status: provider.status === "ready" ? "disconnected" : provider.status,
    messages: [],
    error: provider.error,
  }
}

function sessionKey(user) {
  return `chatgpt:${user}`
}

function ownerKey(workspaceID, blockID) {
  return JSON.stringify([workspaceID, blockID])
}

function staleTab() {
  return new Error("ChatGPT tab changed; refresh this ChatRelay block and try again")
}

function safeURL(value) {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function safeChatGPTURL(value) {
  const url = safeURL(value)
  if (url?.origin === "https://chatgpt.com") return `${url.origin}${url.pathname}`
}

function browserError(cause) {
  const message = errorMessage(cause)
  if (/executable doesn.?t exist|browser.*not found|distribution.*msedge.*not found/i.test(message))
    return new Error(`${message} Install Microsoft Edge or set OPENCODE_CHAT_PROXY_EDGE.`)
  return new Error(message)
}

function edgeExecutable() {
  const candidates = [
    process.env.OPENCODE_CHAT_PROXY_EDGE,
    process.platform === "win32" && process.env["PROGRAMFILES(X86)"]
      ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    process.platform === "win32" && process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
  ].filter(Boolean)
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (executable) return executable
  throw new Error("Microsoft Edge is required for ChatGPT sign-in. Install Edge or set OPENCODE_CHAT_PROXY_EDGE.")
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

function respond(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

export async function startChatProxyWorkerServer(endpoint, worker = createChatProxyWorker()) {
  if (process.platform !== "win32") rmSync(endpoint, { force: true })
  const connections = new Set()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.once("close", () => connections.delete(socket))
    socket.on("error", () => undefined)
    serve(worker, socket, (response) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`, () => undefined)
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, resolve)
  })
  let closed
  return {
    close() {
      closed ??= Promise.all([
        new Promise((resolve) => {
          connections.forEach((socket) => socket.destroy())
          server.close(resolve)
        }),
        worker.shutdown(),
      ]).then(() => {
        if (process.platform !== "win32") rmSync(endpoint, { force: true })
      })
      return closed
    },
  }
}

function serve(worker, input, send) {
  const lines = readline.createInterface({ input })
  lines.on("line", (line) => {
    if (!line) return
    void Promise.resolve()
      .then(() => JSON.parse(line))
      .then(
        (request) =>
          worker.execute(request).then(
            (value) => send({ id: request?.id, ok: true, value }),
            (cause) => send({ id: request?.id, ok: false, error: errorMessage(cause) }),
          ),
        (cause) => send({ ok: false, error: `Invalid Chat Proxy request: ${errorMessage(cause)}` }),
      )
  })
  return lines
}

async function run() {
  const socket = process.argv.indexOf("--socket")
  if (socket >= 0) {
    const server = await startChatProxyWorkerServer(process.argv[socket + 1])
    const stop = () => void server.close().then(() => process.exit(0))
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    return
  }
  const worker = createChatProxyWorker()
  const input = serve(worker, process.stdin, respond)
  input.on("close", () => void worker.shutdown().then(() => process.exit(0)))
  process.on("SIGINT", () => void worker.shutdown().then(() => process.exit(0)))
  process.on("SIGTERM", () => void worker.shutdown().then(() => process.exit(0)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void run()
