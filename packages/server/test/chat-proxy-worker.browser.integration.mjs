import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { chromium } from "playwright"
import { createChatProxyWorker } from "../src/chat-proxy-worker.mjs"

const chat = `<!doctype html>
<html><body>
  <main>
    <a aria-current="page" data-mode="chat" href="/">Chat</a>
    <textarea id="prompt-textarea"></textarea>
    <button aria-label="Send message">Send</button>
    <ol data-conversation-transcript aria-label="Conversation"></ol>
  </main>
  <script>
    window.sendCount = 0
    document.querySelector('[aria-label="Send message"]').addEventListener('click', () => {
      window.sendCount += 1
      const transcript = document.querySelector('[data-conversation-transcript]')
      transcript.insertAdjacentHTML('beforeend', '<li id="turn-user">sent</li>')
      transcript.insertAdjacentHTML('beforeend', '<li id="turn-assistant"><div data-message-author-role="assistant" data-is-streaming="true">partial reply</div></li>')
    })
  </script>
</body></html>`

const work = `<!doctype html><html><body><main>
  <a aria-current="page" data-mode="work" href="/codex">Workspace</a>
  <textarea id="prompt-textarea"></textarea>
  <button aria-label="Send message" onclick="window.sendCount += 1">Send</button>
  <script>window.sendCount = 0</script>
</main></body></html>`

const login = `<!doctype html><html><body><main>
  <button>Log in</button><textarea id="prompt-textarea"></textarea>
  <button aria-label="Send message" onclick="window.sendCount += 1">Send</button>
  <script>window.sendCount = 0</script>
</main></body></html>`

const challenge = `<!doctype html><html><body><main>
  <div>Verify you are human</div><textarea id="prompt-textarea"></textarea>
  <button aria-label="Send message" onclick="window.sendCount += 1">Send</button>
  <script>window.sendCount = 0</script>
</main></body></html>`

const controls = `<!doctype html><html><body><main>
  <a aria-current="page" data-mode="chat" href="/">Chat</a>
  <button data-testid="model-switcher-dropdown-button" aria-haspopup="menu">Alpha</button>
  <div id="models" role="menu" style="display:none">
    <button role="menuitemradio" data-value="alpha" aria-checked="true">Alpha</button>
    <button role="menuitemradio" data-value="beta">Beta</button>
    <button role="menuitemradio" data-value="gamma" aria-haspopup="false">Gamma</button>
    <button role="menuitemradio" data-value="noop">No-op</button>
    <button role="menuitemradio" data-value="retired" aria-disabled="true">Retired</button>
    <button role="menuitemradio" data-value="hidden" style="display:none">Hidden</button>
    <a role="menuitem" href="/upgrade">Upgrade</a>
    <a role="menuitem" href="/logout">Leave</a>
    <div role="menuitem"><a href="/account">Nested account</a></div>
  </div>
  <button data-testid="reasoning-effort" aria-haspopup="menu">Balanced</button>
  <div id="efforts" role="menu" style="display:none">
    <button role="menuitemradio" aria-checked="true">Balanced</button>
    <button role="menuitemradio">Deep</button>
  </div>
  <textarea id="prompt-textarea"></textarea>
  <button aria-label="Send message">Send</button>
  <ol data-conversation-transcript aria-label="Conversation"></ol>
</main><script>
  const show = (id) => document.querySelector(id).style.display = 'block'
  window.modelOpens = 0
  document.querySelector('[data-testid="model-switcher-dropdown-button"]').onclick = () => {
    window.modelOpens += 1
    show('#models')
  }
  document.querySelector('[data-testid="reasoning-effort"]').onclick = () => show('#efforts')
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('[role="menu"]').forEach((menu) => menu.style.display = 'none')
  })
  const choose = (menu, trigger, option) => {
    menu.querySelectorAll('[role]').forEach((node) => node.setAttribute('aria-checked', 'false'))
    option.setAttribute('aria-checked', 'true')
    trigger.textContent = option.textContent
    menu.style.display = 'none'
  }
  document.querySelectorAll('#models button').forEach((option) => option.onclick = () => {
    if (option.getAttribute('aria-disabled') === 'true' || option.dataset.value === 'noop') return
    choose(document.querySelector('#models'), document.querySelector('[data-testid="model-switcher-dropdown-button"]'), option)
    if (option.dataset.value === 'beta') {
      document.querySelector('#efforts').innerHTML = '<button role="menuitemradio" aria-checked="true">Quick</button><button role="menuitemradio">Deep</button>'
      document.querySelector('[data-testid="reasoning-effort"]').remove()
      document.querySelector('#models').insertAdjacentHTML('beforeend', '<button id="nested-effort" role="menuitem" aria-haspopup="menu" aria-label="Reasoning effort">Reasoning effort</button>')
      document.querySelector('#nested-effort').onclick = () => show('#efforts')
    }
  })
  document.querySelector('#efforts').onclick = (event) => {
    const option = event.target.closest('[role="menuitemradio"]')
    const trigger = document.querySelector('[data-testid="reasoning-effort"]') || document.querySelector('#nested-effort')
    if (option) choose(document.querySelector('#efforts'), trigger, option)
  }
  document.querySelector('[aria-label="Send message"]').onclick = () => {
    const transcript = document.querySelector('[data-conversation-transcript]')
    transcript.innerHTML = '<li id="turn-user">sent</li><li id="turn-assistant"><div data-message-author-role="assistant" data-is-streaming="true">busy</div></li>'
  }
</script></body></html>`

const powerControls = `<!doctype html><html><body>
<aside><button aria-label="Open conversation options for Coding Model" aria-haspopup="menu">History</button></aside>
<main><textarea id="prompt-textarea"></textarea>
<button class="__composer-pill" aria-haspopup="menu" style="display:none">Instant</button>
<div id="picker" role="menu" style="display:none"><div data-testid="composer-intelligence-picker-content">
<div role="menuitem" aria-label="Select model">Select model</div>
<div data-testid="composer-model-picker-slider-simple-view" data-active="true">
<div role="menuitem" aria-label="Power" aria-keyshortcuts="ArrowLeft ArrowRight" aria-describedby="power-description" tabindex="0">
<div data-model-reasoning-effort-slider><span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"></span>
<span data-selected="true" data-locked="false"></span><span data-selected="false" data-locked="false"></span>
<span data-selected="false" data-locked="false"></span><span data-selected="false" data-locked="false"></span>
<span data-selected="false" data-locked="true"></span></div></div><span id="power-description">Instant, 1 of 5.</span></div>
<div data-testid="composer-model-picker-slider-advanced-view" data-active="false" inert>
<div role="menuitemradio" aria-checked="true">Latest</div><div role="menuitemradio" aria-checked="false">Example model</div>
</div></div></div></main><script>
const picker = document.querySelector('#picker')
const simple = document.querySelector('[data-testid="composer-model-picker-slider-simple-view"]')
const advanced = document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]')
setTimeout(() => document.querySelector('.__composer-pill').style.display = '', 400)
document.querySelector('.__composer-pill').onclick = () => {
 picker.style.display = 'block'; simple.inert = false; simple.dataset.active = 'true';
 advanced.inert = true; advanced.dataset.active = 'false';
}
document.querySelector('[aria-label="Select model"]').onclick = () => {
 simple.inert = true; simple.dataset.active = 'false'; advanced.inert = false; advanced.dataset.active = 'true';
}
document.querySelectorAll('[role="menuitemradio"]').forEach(option => option.onclick = () => {
 document.querySelectorAll('[role="menuitemradio"]').forEach(item => item.setAttribute('aria-checked', String(item === option)))
 picker.style.display = 'none'
})
document.querySelector('[aria-label="Power"]').onkeydown = event => {
 if (!['ArrowLeft','ArrowRight'].includes(event.key)) return
 const slider = document.querySelector('[role="slider"]')
 const value = Math.max(0, Math.min(3, Number(slider.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 1 : -1)))
 slider.setAttribute('aria-valuenow', String(value)); document.querySelector('#power-description').textContent = 'Power ' + value
 event.preventDefault()
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') picker.style.display = 'none' })
</script></body></html>`

const opening = `<!doctype html><html><body><main><div>Loading ChatGPT</div></main></body></html>`

let browser

before(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true })
})

after(async () => {
  await browser?.close()
})

describe("Chat Proxy worker browser DOM", () => {
  test("discovers and applies dynamic model and effort menus and rejects stale, disabled, and busy changes", async () => {
    const context = await browser.newContext()
    const loginPage = await context.newPage()
    const pages = []
    let finishLogin
    let served = controls
    await context.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html", body: served }))
    const worker = createChatProxyWorker({
      chromium: {
        launchPersistentContext: async () => ({
          pages: () => [loginPage],
          newPage: async () => {
            const page = await context.newPage()
            pages.push(page)
            return page
          },
          on: (...input) => context.on(...input),
          route: (...input) => context.route(...input),
          close: () => context.close(),
        }),
      },
      spawn: () => ({
        once: (event, listener) => {
          if (event === "exit") finishLogin = listener
        },
        kill: () => {},
      }),
      edgeExecutable: () => "C:/fake/msedge.exe",
      randomUUID: () => "assistant-id",
      sleep: () => new Promise(() => {}),
    })
    const execute = (method, input = {}) => worker.execute({ method, user: "controls-user", ...input })
    const profile = "C:/profiles/controls-user"
    await execute("connect", { profile })
    finishLogin()
    await waitUntil(async () => (await execute("status")).status === "ready")
    served = controls.replace("show('#models')", "setTimeout(() => show('#models'), 100)")
    const relay = await execute("relay", { workspaceID: "workspace", blockID: "controls", profile })
    assert.equal(relay.controls, undefined)
    assert.equal(await pages[0].evaluate(() => window.modelOpens), 0)
    const refreshing = execute("options", { workspaceID: "workspace", blockID: "controls", tabID: relay.tabID })
    await pages[0].waitForFunction(() => window.modelOpens > 0)
    const discovering = await execute("relay", { workspaceID: "workspace", blockID: "controls" })
    await assert.rejects(
      () =>
        execute("prompt", {
          workspaceID: "workspace",
          blockID: "controls",
          tabID: discovering.tabID,
          messageID: "discovery-race",
          text: "must not send",
        }),
      /controls are already being updated/,
    )
    const refreshed = await refreshing

    assert.deepEqual(
      refreshed.controls.model.options.map((option) => [option.id, option.label, option.disabled]),
      [
        ["dom:alpha", "Alpha", undefined],
        ["dom:beta", "Beta", undefined],
        ["dom:gamma", "Gamma", undefined],
        ["dom:noop", "No-op", undefined],
        ["dom:retired", "Retired", true],
      ],
    )
    assert.deepEqual(
      refreshed.controls.effort.options.map((option) => option.label),
      ["Balanced", "Deep"],
    )
    assert.equal(
      (
        await execute("configure", {
          workspaceID: "workspace",
          blockID: "controls",
          tabID: relay.tabID,
          model: "dom:retired",
        })
      ).controls.error,
      "ChatGPT model option is disabled",
    )
    assert.equal(
      (
        await execute("configure", {
          workspaceID: "workspace",
          blockID: "controls",
          tabID: relay.tabID,
          model: "dom:missing",
        })
      ).controls.error,
      "ChatGPT model option is stale or unavailable",
    )
    const beforeNoopModel = await pages[0].evaluate(() => window.modelOpens)
    assert.equal(
      (
        await execute("configure", {
          workspaceID: "workspace",
          blockID: "controls",
          tabID: relay.tabID,
          model: "dom:noop",
        })
      ).controls.error,
      "ChatGPT model option was not applied",
    )
    assert.equal((await pages[0].evaluate(() => window.modelOpens)) - beforeNoopModel, 2)
    const changed = await execute("configure", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
      model: "dom:beta",
      effort: "label:stale",
    })
    assert.equal(changed.controls.model.label, "Beta")
    assert.equal(changed.controls.error, "ChatGPT effort option is stale or unavailable")
    assert.deepEqual(
      changed.controls.effort.options.map((option) => option.label),
      ["Quick", "Deep"],
    )
    assert.equal(
      changed.controls.model.options.some((option) => option.label === "Reasoning effort"),
      false,
    )
    const deep = changed.controls.effort.options.find((option) => option.label === "Deep")
    const configured = await execute("configure", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
      effort: deep.id,
    })
    assert.ok(configured.controls.effort, JSON.stringify(configured.controls))
    assert.equal(configured.controls.effort.label, "Deep")

    await pages[0].locator('[data-testid="model-switcher-dropdown-button"]').click()
    await pages[0].locator("#models").waitFor({ state: "visible" })
    const recoveredMenu = await execute("options", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
    })
    assert.equal(recoveredMenu.controls.error, undefined)
    assert.equal(recoveredMenu.controls.model.label, "Beta")
    assert.equal(await pages[0].locator('[role="menu"]:visible').count(), 0)

    await pages[0].evaluate(() => {
      window.blockEscape = (event) => event.stopImmediatePropagation()
      window.addEventListener("keydown", window.blockEscape, true)
      document.querySelector("main").insertAdjacentHTML("beforeend", '<div role="menu" id="stubborn-menu">Open</div>')
    })
    const blockedByMenu = await execute("options", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
    })
    assert.match(blockedByMenu.controls.error, /close the open ChatGPT menu/i)
    await pages[0].evaluate(() => {
      document.querySelector("#stubborn-menu").remove()
      window.removeEventListener("keydown", window.blockEscape, true)
    })

    await pages[0].locator("#nested-effort").evaluate((node) => node.remove())
    await pages[0].locator("#efforts").evaluate((node) => node.remove())
    const withoutEffort = await execute("options", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
    })
    assert.equal(withoutEffort.controls.effort, undefined)

    await pages[0]
      .locator("main")
      .evaluate((node) =>
        node.insertAdjacentHTML("beforeend", '<div role="dialog" id="foreign-dialog">Unrelated dialog</div>'),
      )
    const beforeDialog = await pages[0].evaluate(() => window.modelOpens)
    const blockedByDialog = await execute("options", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
    })
    assert.match(blockedByDialog.controls.error, /close the open ChatGPT dialog/i)
    assert.deepEqual(blockedByDialog.controls.model, withoutEffort.controls.model)
    assert.equal(blockedByDialog.controls.effort, undefined)
    assert.equal(await pages[0].locator("#foreign-dialog").isVisible(), true)
    assert.equal(await pages[0].evaluate(() => window.modelOpens), beforeDialog)
    await pages[0].locator("#foreign-dialog").evaluate((node) => node.remove())
    assert.equal(
      (await execute("options", { workspaceID: "workspace", blockID: "controls", tabID: relay.tabID })).controls.error,
      undefined,
    )

    await pages[0].locator('[aria-current="page"]').evaluate((node) => {
      node.setAttribute("href", "/codex")
      node.setAttribute("data-mode", "work")
    })
    const beforeWork = await pages[0].evaluate(() => window.modelOpens)
    const blockedByWork = await execute("configure", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
      model: "dom:alpha",
    })
    assert.match(blockedByWork.controls.error, /Work mode/)
    assert.equal(await pages[0].evaluate(() => window.modelOpens), beforeWork)
    await pages[0].locator('[aria-current="page"]').evaluate((node) => {
      node.setAttribute("href", "/")
      node.setAttribute("data-mode", "chat")
    })

    served = opening
    const delayed = await execute("ensure", { workspaceID: "workspace", blockID: "delayed", profile })
    assert.equal(delayed.status, "opening")
    assert.equal(delayed.controls, undefined)
    await pages[1].setContent(controls)
    const initialized = await execute("relay", { workspaceID: "workspace", blockID: "delayed" })
    assert.equal(initialized.status, "idle")
    assert.equal(initialized.controls, undefined)
    const initializedControls = await execute("options", {
      workspaceID: "workspace",
      blockID: "delayed",
      tabID: delayed.tabID,
    })
    assert.deepEqual(
      initializedControls.controls.model.options.map((option) => option.label),
      ["Alpha", "Beta", "Gamma", "No-op", "Retired"],
    )

    await execute("prompt", {
      workspaceID: "workspace",
      blockID: "controls",
      tabID: relay.tabID,
      messageID: "busy-message",
      text: "hello",
    })
    await assert.rejects(
      () =>
        execute("options", {
          workspaceID: "workspace",
          blockID: "controls",
          tabID: relay.tabID,
        }),
      /only while this tab is idle/,
    )
    served = powerControls
    const powerRelay = await execute("relay", { workspaceID: "workspace", blockID: "power", profile })
    assert.equal(powerRelay.controls, undefined)
    const power = await execute("options", { workspaceID: "workspace", blockID: "power", tabID: powerRelay.tabID })
    assert.deepEqual(
      power.controls.model.options.map((option) => option.label),
      ["Latest", "Example model"],
    )
    assert.deepEqual(
      power.controls.effort.options.map((option) => option.id),
      ["slider:0", "slider:1", "slider:2", "slider:3", "slider:4"],
    )
    assert.equal(power.controls.effort.value, "slider:0")
    assert.equal(power.controls.effort.options[4].disabled, true)
    const powered = await execute("configure", {
      workspaceID: "workspace",
      blockID: "power",
      tabID: power.tabID,
      effort: "slider:2",
    })
    assert.equal(powered.controls.effort.value, "slider:2")
    assert.equal(powered.controls.effort.label, "Power 2")
    const modelled = await execute("configure", {
      workspaceID: "workspace",
      blockID: "power",
      tabID: power.tabID,
      model: power.controls.model.options[1].id,
    })
    assert.equal(modelled.controls.model.label, "Example model")
    await worker.shutdown()
  })

  test("reads a streaming regular Chat response and refuses Work, login, and challenge pages before clicking", async () => {
    const context = await browser.newContext()
    const loginPage = await context.newPage()
    const pages = []
    const sleepers = []
    let finishLogin
    await context.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html", body: chat }))
    const worker = createChatProxyWorker({
      chromium: {
        launchPersistentContext: async () => ({
          pages: () => [loginPage],
          newPage: async () => {
            const page = await context.newPage()
            pages.push(page)
            return page
          },
          on: (...input) => context.on(...input),
          route: (...input) => context.route(...input),
          close: () => context.close(),
        }),
      },
      spawn: () => ({
        once: (event, listener) => {
          if (event === "exit") finishLogin = listener
        },
        kill: () => {},
      }),
      edgeExecutable: () => "C:/fake/msedge.exe",
      randomUUID: (() => {
        let id = 0
        return () => `id-${++id}`
      })(),
      sleep: () => new Promise((resolve) => sleepers.push(resolve)),
    })
    const execute = (method, input = {}) => worker.execute({ method, user: "browser-user", ...input })
    const profile = "C:/profiles/browser-user"

    assert.equal((await execute("connect", { profile })).status, "login-required")
    finishLogin()
    await waitUntil(async () => (await execute("status")).status === "ready")
    const regular = await execute("ensure", { workspaceID: "workspace", blockID: "regular", profile })
    const prompted = await execute("prompt", {
      workspaceID: "workspace",
      blockID: "regular",
      tabID: regular.tabID,
      messageID: "message-1",
      text: "hello",
    })

    assert.equal(prompted.status, "thinking")
    await waitUntil(() => sleepers.length > 0)
    assert.deepEqual((await execute("relay", { workspaceID: "workspace", blockID: "regular" })).messages.at(-1), {
      id: "id-2",
      role: "assistant",
      text: "partial reply",
      createdAt: prompted.messages.at(-1).createdAt,
    })
    for (let index = 0; index < 5; index++) {
      sleepers.shift()?.()
      await waitUntil(() => sleepers.length > 0)
    }
    assert.equal((await execute("relay", { workspaceID: "workspace", blockID: "regular" })).status, "thinking")
    await pages[0].locator('[data-message-author-role="assistant"]').evaluate((node) => {
      node.textContent = "final reply"
      node.removeAttribute("data-is-streaming")
    })
    for (let index = 0; index < 11; index++) {
      sleepers.shift()?.()
      await waitUntil(() => sleepers.length > 0 || index === 10)
    }
    await waitUntil(
      async () => (await execute("relay", { workspaceID: "workspace", blockID: "regular" })).status === "idle",
    )
    assert.equal(
      (await execute("relay", { workspaceID: "workspace", blockID: "regular" })).messages.at(-1)?.text,
      "final reply",
    )

    const cases = [
      { blockID: "work", html: work, error: "Work mode" },
      { blockID: "login", html: login, error: "login is required" },
      { blockID: "challenge", html: challenge, error: "browser verification" },
    ]
    for (const item of cases) {
      const relay = await execute("ensure", { workspaceID: "workspace", blockID: item.blockID, profile })
      const page = pages.at(-1)
      await page.setContent(item.html)
      await assert.rejects(
        () =>
          execute("prompt", {
            workspaceID: "workspace",
            blockID: item.blockID,
            tabID: relay.tabID,
            messageID: `message-${item.blockID}`,
            text: "must not send",
          }),
        new RegExp(item.error, "i"),
      )
      assert.equal(await page.evaluate(() => window.sendCount), 0)
    }

    await worker.shutdown()
  })
})

async function waitUntil(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for browser fixture state")
}
