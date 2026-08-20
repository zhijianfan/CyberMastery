import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"
import { chromium } from "playwright"

const sessions = new Map()
const launches = new Map()
const logins = new Map()
const failures = new Map()
const shutdownState = { active: false }
const chatGPT = "https://chatgpt.com/"
const composerSelector = '#prompt-textarea, main textarea, main [contenteditable="true"]'
const modelPickerSelector =
  'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="model" i][aria-haspopup]'
const effortPickerSelector =
  'button[data-testid*="effort" i], button[aria-label*="effort" i][aria-haspopup], button[aria-label*="reasoning" i][aria-haspopup]'
const menuSelector = '[role="menu"]:visible, [role="listbox"]:visible'
const menuOptionSelector = '[role="menuitem"]:visible, [role="menuitemradio"]:visible, [role="option"]:visible'
const input = readline.createInterface({ input: process.stdin })

input.on("line", (line) => {
  if (!line) return
  const request = JSON.parse(line)
  void execute(request).then(
    (value) => respond({ id: request.id, ok: true, value }),
    (cause) => respond({ id: request.id, ok: false, error: errorMessage(cause) }),
  )
})
input.on("close", () => void shutdown())
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

async function execute(request) {
  if (request.method === "status") return provider(request.user)
  if (request.method === "connect") return connect(request.user, request.profile)
  if (request.method === "open") return open(request.user, request.profile)
  if (request.method === "disconnect") return disconnect(request.user)
  if (request.method === "relay") return relay(request.user, request.relayID)
  if (request.method === "prompt") {
    return prompt(request.user, request.relayID, request.text, request.model, request.effort)
  }
  throw new Error(`Unknown Chat Proxy worker method: ${request.method}`)
}

async function connect(user, profile) {
  const key = sessionKey(user)
  if (logins.has(key)) return provider(user)
  const current = sessions.get(key)
  if (current) return provider(user)
  await openLogin(user, key, profile)
  return provider(user)
}

async function open(user, profile) {
  const key = sessionKey(user)
  if (logins.has(key)) return provider(user)
  const session = sessions.get(key)
  if (session) {
    session.closing = true
    await session.context.close()
  }
  await openLogin(user, key, profile ?? session?.profile, session?.relays)
  return provider(user)
}

async function openLogin(user, key, profile, relays = new Map()) {
  if (!profile) throw new Error("Chat Proxy browser profile is missing")
  await clearRestoredPages(profile)
  const browser = spawn(edgeExecutable(), [
    `--user-data-dir=${profile}`,
    "--disable-background-mode",
    "--disable-features=msEdgeStartupBoost",
    "--new-window",
    chatGPT,
  ], { stdio: "ignore" })
  const login = { browser, profile, relays, closing: false }
  logins.set(key, login)
  browser.once("error", (cause) => {
    if (logins.get(key) !== login) return
    logins.delete(key)
    failures.set(key, errorMessage(cause))
  })
  browser.once("exit", () => {
    if (logins.get(key) !== login) return
    logins.delete(key)
    if (login.closing) return
    void start(user, key, profile, "background", relays, 750).catch(() => undefined)
  })
}

async function disconnect(user) {
  const key = sessionKey(user)
  const login = logins.get(key)
  if (login) {
    login.closing = true
    logins.delete(key)
    login.browser.kill()
  }
  const pending = launches.get(key)
  const session = sessions.get(key) ?? (pending ? await pending.catch(() => undefined) : undefined)
  if (session) {
    session.closing = true
    await session.context.close().catch(() => undefined)
  }
  sessions.delete(key)
  failures.delete(key)
  return { id: "chatgpt", name: "ChatGPT", status: "disconnected" }
}

async function relay(user, relayID) {
  const connection = await provider(user)
  const session = sessions.get(sessionKey(user))
  const previous = session?.relays.get(relayID)
  if (connection.status !== "ready" || !session) {
    return {
      providerID: "chatgpt",
      relayID,
      status: connection.status === "ready" ? "disconnected" : connection.status,
      messages: previous?.messages.map((message) => ({ ...message })) ?? [],
      configuration: previous?.configuration,
      error: connection.error,
    }
  }

  return snapshot(relayID, await relayState(session, relayID))
}

async function prompt(user, relayID, text, model, effort) {
  const value = text.trim()
  if (!value) throw new Error("Message cannot be empty")

  const connection = await provider(user)
  if (connection.status !== "ready") {
    throw new Error(connection.error ?? "ChatGPT is not connected. Open Settings > Providers > Chat Proxy first.")
  }

  const session = sessions.get(sessionKey(user))
  if (!session) throw new Error("The ChatGPT browser session is not running")
  const state = await relayState(session, relayID)
  if (state.status === "thinking") throw new Error("This relay is already waiting for a response")

  state.messages.push({ id: randomUUID(), role: "user", text: value, createdAt: Date.now() })
  state.status = "thinking"
  state.error = undefined
  void runPrompt(state, value, model, effort).catch((cause) => failRelay(state, cause))
  return snapshot(relayID, state)
}

function start(user, key, profile, mode = "background", relays = new Map(), delay = 0) {
  if (!profile) return Promise.reject(new Error("Chat Proxy browser profile is missing"))
  const pending = (delay
    ? new Promise((resolve) => setTimeout(resolve, delay)).then(() => launch(user, key, profile, mode, relays))
    : launch(user, key, profile, mode, relays))
    .then((session) => {
      failures.delete(key)
      return session
    })
    .catch((cause) => {
      const error = browserError(cause)
      failures.set(key, error.message)
      throw error
    })
    .finally(() => launches.delete(key))
  launches.set(key, pending)
  return pending
}

async function launch(user, key, profile, mode = "login", relays = new Map()) {
  await clearRestoredPages(profile)
  const context = await launchContext(profile, {
    channel: "msedge",
    headless: false,
    viewport: null,
    args: mode === "background" ? ["--start-minimized"] : ["--start-maximized"],
    timeout: 30_000,
  })
  const pages = context.pages()
  const page = pages[0] ?? (await context.newPage())
  const session = {
    context,
    loginPage: page,
    relays,
    profile,
    mode,
    closing: false,
    error: undefined,
  }
  sessions.set(key, session)
  context.on("close", () => {
    if (sessions.get(key)?.context === context) sessions.delete(key)
  })
  await Promise.all(
    pages.filter((candidate) => candidate !== page).map((candidate) => candidate.close().catch(() => undefined)),
  )
  await navigate(page, session)
  await page.bringToFront()
  return session
}

async function launchContext(profile, options, attempt = 0) {
  return chromium.launchPersistentContext(profile, options).catch(async (cause) => {
    if (!/opening in existing browser session|target page, context or browser has been closed/i.test(errorMessage(cause))) {
      throw cause
    }
    if (attempt >= 9) {
      throw new Error(
        "Microsoft Edge is still holding the Chat Proxy profile. Close its windows and disable Startup boost and background apps in edge://settings/system, then reconnect.",
      )
    }
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
      status: error ? "error" : "disconnected",
      error,
    }
  }

  const status = await browserStatus(await loginPage(session))
  if (status === "login-required" && session.mode === "background") {
    session.closing = true
    await session.context.close()
    await openLogin(user, key, session.profile, session.relays)
    return provider(user)
  }
  if (status === "ready" || status === "login-required") session.error = undefined
  return {
    id: "chatgpt",
    name: "ChatGPT",
    status: session.error ? "error" : status,
    error: session.error,
  }
}

async function loginPage(session) {
  if (!session.loginPage.isClosed()) return session.loginPage
  const page = session.context.pages().find((candidate) => !candidate.isClosed()) ?? (await session.context.newPage())
  session.loginPage = page
  if (page.url() === "about:blank") await navigate(page, session)
  return page
}

async function navigate(page, session) {
  const response = await page.goto(chatGPT, { waitUntil: "commit", timeout: 30_000 }).catch(async (cause) => {
    session.error = `Could not open ChatGPT: ${errorMessage(cause)}`
    await page.setContent(errorPage(session.error)).catch(() => undefined)
  })
  if (response && response.status() >= 400) session.error = `ChatGPT returned HTTP ${response.status()}`
}

async function browserStatus(page) {
  if (page.isClosed()) return "disconnected"
  if (/auth\.openai\.com|\/auth\//i.test(page.url())) return "login-required"
  if (await page.locator(composerSelector).last().isVisible().catch(() => false)) return "ready"
  if (await page.getByRole("button", { name: /log in|sign up/i }).first().isVisible().catch(() => false)) {
    return "login-required"
  }
  return "opening"
}

async function relayState(session, relayID) {
  const current = session.relays.get(relayID)
  if (current && !current.page.isClosed()) {
    if (current.status === "idle" && Date.now() - (current.configurationReadAt ?? 0) > 60_000) {
      await refreshConfiguration(current)
    }
    return current
  }

  const page = await session.context.newPage()
  const state = current
    ? { ...current, page, status: "idle", error: undefined, configurationReadAt: 0 }
    : { page, status: "idle", messages: [], error: undefined, configurationReadAt: 0 }
  session.relays.set(relayID, state)
  const response = await page.goto(chatGPT, { waitUntil: "commit", timeout: 30_000 }).catch((cause) => {
    state.status = "error"
    state.error = errorMessage(cause)
  })
  if (response && response.status() >= 400) {
    state.status = "error"
    state.error = `ChatGPT returned HTTP ${response.status()}`
  }
  if (state.status === "idle") await refreshConfiguration(state)
  return state
}

async function selectModel(page, model) {
  const value = model?.trim()
  if (!value) return
  const picker = page.locator(modelPickerSelector).first()
  await picker.waitFor({ state: "visible", timeout: 10_000 })
  if ((await picker.innerText()).toLowerCase().includes(value.toLowerCase())) return
  const opened = await openModelMenu(page)
  const option = await findChoice(opened.root, value)
  if (!option) {
    await page.keyboard.press("Escape").catch(() => undefined)
    throw new Error(`ChatGPT model option "${value}" is no longer available`)
  }
  await option.click()
  await page.waitForTimeout(250)
}

async function selectEffort(page, effort) {
  const value = effort?.trim()
  if (!value) return
  const effortPicker = page.locator(effortPickerSelector).first()
  if (await effortPicker.isVisible().catch(() => false)) {
    if ((await effortPicker.innerText()).toLowerCase().includes(value.toLowerCase())) return
    await effortPicker.click()
    const menu = page.locator(menuSelector).last()
    await menu.waitFor({ state: "visible", timeout: 10_000 })
    const option = await findChoice(menu, value)
    if (option) {
      await option.click()
      return
    }
    await page.keyboard.press("Escape").catch(() => undefined)
  }

  const opened = await openModelMenu(page)
  const triggers = opened.root.locator(menuOptionSelector).filter({ hasText: /effort|thinking|reasoning/i })
  for (let index = 0; index < (await triggers.count()); index++) {
    await triggers.nth(index).hover().catch(() => undefined)
    await page.waitForTimeout(150)
    const count = await opened.menus.count()
    if (count <= opened.rootIndex + 1) continue
    const option = await findChoice(opened.menus.nth(count - 1), value)
    if (option) {
      await option.click()
      return
    }
  }

  const option = await findChoice(opened.root, value)
  if (option) {
    await option.click()
    return
  }
  await page.keyboard.press("Escape").catch(() => undefined)
  throw new Error(`ChatGPT effort option "${value}" is no longer available`)
}

async function runPrompt(state, text, model, effort) {
  await selectModel(state.page, model)
  await selectEffort(state.page, effort)
  await refreshConfiguration(state)
  const composer = state.page.locator(composerSelector).last()
  await composer.waitFor({ state: "visible", timeout: 15_000 })
  const assistant = state.page.locator('[data-message-author-role="assistant"]')
  const baseline = await assistant.count()
  await composer.fill(text)
  const send = state.page.locator('button[data-testid="send-button"], button[aria-label*="Send"]').last()
  if (await send.isVisible().catch(() => false)) await send.click()
  else await composer.press("Enter")

  const responseID = randomUUID()
  state.messages.push({ id: responseID, role: "assistant", text: "", createdAt: Date.now() })
  const deadline = Date.now() + 300_000
  let last = ""
  let stable = 0
  let retried = false
  while (Date.now() < deadline) {
    const count = await assistant.count()
    const next = count > baseline ? (await assistant.nth(count - 1).innerText()).trim() : ""
    const message = state.messages.find((item) => item.id === responseID)
    if (message && next) message.text = next

    const alert = state.page.locator('main [role="alert"]').last()
    const alertText = (await alert.isVisible().catch(() => false)) ? (await alert.innerText()).trim() : ""
    if (alertText && /too many requests|request(?:ed)? too often|rate limit/i.test(alertText)) {
      if (retried) throw new Error(alertText)
      const retry = state.page.getByRole("button", { name: /retry|try again/i }).last()
      if (!(await retry.isVisible().catch(() => false))) throw new Error(alertText)
      retried = true
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      await retry.click()
      last = ""
      stable = 0
      continue
    }
    if (alertText && /error|failed|problem|try again|unusual activity/i.test(alertText)) throw new Error(alertText)

    const stopping = await state.page
      .locator('button[data-testid="stop-button"], button[aria-label*="Stop"]')
      .last()
      .isVisible()
      .catch(() => false)
    stable = next && next === last ? stable + 1 : 0
    if (next && stable >= 3 && !stopping) {
      state.status = "idle"
      state.error = undefined
      return
    }
    last = next
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("ChatGPT did not finish responding within five minutes")
}

function failRelay(state, cause) {
  const error = errorMessage(cause)
  const empty = state.messages.findIndex((message) => message.role === "assistant" && !message.text)
  if (empty >= 0) state.messages.splice(empty, 1)
  state.messages.push({ id: randomUUID(), role: "error", text: error, createdAt: Date.now() })
  state.status = "error"
  state.error = error
}

function snapshot(relayID, state) {
  return {
    providerID: "chatgpt",
    relayID,
    status: state.status,
    messages: state.messages.map((message) => ({ ...message })),
    configuration: state.configuration,
    error: state.error,
  }
}

async function refreshConfiguration(state) {
  state.configurationReadAt = Date.now()
  state.configuration = await readConfiguration(state.page).catch(
    () => state.configuration ?? { models: [], efforts: [] },
  )
}

async function readConfiguration(page) {
  const picker = page.locator(modelPickerSelector).first()
  await picker.waitFor({ state: "visible", timeout: 15_000 })
  const currentModel = choiceLabel(await picker.innerText())
  const opened = await openModelMenu(page)
  const modelChoices = await readChoices(opened.root)
  const effortChoices = []
  const triggers = opened.root.locator(menuOptionSelector).filter({ hasText: /effort|thinking|reasoning/i })

  for (let index = 0; index < (await triggers.count()); index++) {
    await triggers.nth(index).hover().catch(() => undefined)
    await page.waitForTimeout(150)
    const count = await opened.menus.count()
    if (count <= opened.rootIndex + 1) continue
    effortChoices.push(...(await readChoices(opened.menus.nth(count - 1))))
  }
  await page.keyboard.press("Escape").catch(() => undefined)

  const effortPicker = page.locator(effortPickerSelector).first()
  const currentEffort = (await effortPicker.isVisible().catch(() => false))
    ? choiceLabel(await effortPicker.innerText())
    : effortChoices.find((choice) => choice.selected)?.label
  if (await effortPicker.isVisible().catch(() => false)) {
    await effortPicker.click()
    const menu = page.locator(menuSelector).last()
    await menu.waitFor({ state: "visible", timeout: 10_000 })
    effortChoices.push(...(await readChoices(menu)))
    await page.keyboard.press("Escape").catch(() => undefined)
  }

  return {
    model: modelChoices.find((choice) => choice.selected)?.label || currentModel || undefined,
    effort: effortChoices.find((choice) => choice.selected)?.label || currentEffort || undefined,
    models: uniqueStrings([...modelChoices.map((choice) => choice.label), currentModel]),
    efforts: uniqueStrings([...effortChoices.map((choice) => choice.label), currentEffort]),
  }
}

async function openModelMenu(page) {
  const picker = page.locator(modelPickerSelector).first()
  await picker.waitFor({ state: "visible", timeout: 10_000 })
  await picker.click()
  const menus = page.locator(menuSelector)
  await menus.last().waitFor({ state: "visible", timeout: 10_000 })
  const rootIndex = (await menus.count()) - 1
  return { menus, rootIndex, root: menus.nth(rootIndex) }
}

async function readChoices(scope) {
  const choices = await scope.locator(menuOptionSelector).evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: (node.getAttribute("aria-label") || (node instanceof HTMLElement ? node.innerText : node.textContent) || "")
        .split("\n")
        .map((part) => part.trim())
        .find(Boolean)
        ?.replace(/\s+/g, " ") ?? "",
      selected:
        node.getAttribute("aria-checked") === "true" ||
        node.getAttribute("aria-selected") === "true" ||
        node.getAttribute("data-state") === "checked" ||
        node.querySelector('[aria-checked="true"], [data-state="checked"]') !== null,
    })),
  )
  return choices.filter(
    (choice, index) =>
      choice.label && choices.findIndex((candidate) => candidate.label.toLowerCase() === choice.label.toLowerCase()) === index,
  )
}

async function findChoice(scope, value) {
  const options = scope.locator(menuOptionSelector)
  const target = value.trim().toLowerCase()
  for (let index = 0; index < (await options.count()); index++) {
    const option = options.nth(index)
    const label = choiceLabel((await option.getAttribute("aria-label")) ?? (await option.innerText()))
    if (label.toLowerCase() === target) return option
  }
}

function choiceLabel(value) {
  return value
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ") ?? ""
}

function uniqueStrings(values) {
  return values.filter(
    (value, index) => value && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
  )
}

function respond(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

async function shutdown() {
  if (shutdownState.active) return
  shutdownState.active = true
  logins.forEach((login) => {
    login.closing = true
    login.browser.kill()
  })
  logins.clear()
  await Promise.all(
    [...sessions.values()].map((session) => {
      session.closing = true
      return session.context.close().catch(() => undefined)
    }),
  )
  process.exit(0)
}

function sessionKey(user) {
  return `chatgpt:${user}`
}

async function clearRestoredPages(profile) {
  const directories = [path.join(profile, "Default", "Sessions"), path.join(profile, "Sessions")]
  await Promise.all(
    directories.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^(Session|Tabs)_/.test(entry.name))
          .map((entry) => rm(path.join(directory, entry.name), { force: true }).catch(() => undefined)),
      )
    }),
  )
  await Promise.all(
    ["Current Session", "Current Tabs", "Last Session", "Last Tabs"].map((name) =>
      rm(path.join(profile, "Default", name), { force: true }).catch(() => undefined),
    ),
  )
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
  throw new Error("Microsoft Edge is required for Chat Proxy login. Install Edge or set OPENCODE_CHAT_PROXY_EDGE.")
}

function browserError(cause) {
  const message = errorMessage(cause)
  if (/executable doesn.?t exist|browser.*not found|distribution.*msedge.*not found/i.test(message)) {
    return new Error(`${message} Install Microsoft Edge or set OPENCODE_CHAT_PROXY_EDGE.`)
  }
  return new Error(message)
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

function errorPage(message) {
  return `<!doctype html><title>Chat Proxy could not open ChatGPT</title><style>body{font:16px/1.5 sans-serif;max-width:760px;margin:64px auto;padding:0 24px;color:#1f2937}h1{font-size:24px}pre{white-space:pre-wrap;background:#f3f4f6;padding:16px;border-radius:8px}</style><h1>Chat Proxy could not open ChatGPT</h1><p>The backend will show the same error in Settings.</p><pre>${escapeHTML(message)}</pre>`
}

function escapeHTML(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
