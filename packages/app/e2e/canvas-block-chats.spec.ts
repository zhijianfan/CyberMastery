import { expect, test } from "@playwright/test"
import { openCanvasBlockChats } from "./utils/canvas-block-chats"

test("Relay tabs keep older live conversations writable and their drafts independent", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["relay"] })
  const relay = page.locator('[data-component="chat-relay"]')
  const input = relay.locator('[data-input="chat-relay-message"]')
  await expect(relay.getByRole("tab", { name: "Relay conversation", exact: true })).toBeVisible()
  await input.fill("Original tab draft")
  await relay.getByRole("button", { name: "New session", exact: true }).click()
  await expect(relay.getByRole("tab", { name: "Fresh Relay conversation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(input).toHaveText("")
  await input.fill("New tab draft")
  await relay.getByRole("button", { name: "Session history", exact: true }).click()
  await relay.getByRole("option", { name: "Relay conversation", exact: true }).click()
  await expect(input).toHaveText("Original tab draft")
  await expect(relay.getByText("ChatGPT independent previous answer", { exact: true })).toBeVisible()
  await input.press("Enter")
  await expect(relay.getByText("ChatGPT mirrored response for Original tab draft", { exact: true })).toBeVisible()
  expect(fixture.browserPrompts.at(-1)).toMatchObject({ tabID: "tab-relay-1", text: "Original tab draft" })
  expect(fixture.browserResets).toEqual([])
  expect(fixture.errors).toEqual([])
})

test("Relay saved history stays selectable after worker restart with no composer and can start a new live tab", async ({
  page,
}) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["relay"] })
  const relay = page.locator('[data-component="chat-relay"]')
  await expect(relay.locator('[data-input="chat-relay-message"]')).toBeVisible()
  fixture.restartRelay()
  await page.reload()
  await expect(relay.getByText("ChatGPT independent previous answer", { exact: true })).toBeVisible()
  await expect(relay).toContainText("Read-only")
  await expect(relay.locator('[data-component="prompt-input"]')).toHaveCount(0)
  await relay.getByRole("button", { name: "Session history", exact: true }).click()
  await relay.getByRole("textbox", { name: "Search archived sessions", exact: true }).fill("Archived Relay")
  await relay.getByRole("option", { name: /Archived Relay conversation/ }).click()
  await expect(relay.getByText("Archived ChatGPT answer", { exact: true })).toBeVisible()
  await expect(relay.locator('[data-component="prompt-input"]')).toHaveCount(0)
  await relay.getByRole("button", { name: "New session", exact: true }).click()
  const input = relay.locator('[data-input="chat-relay-message"]')
  await expect(input).toBeVisible()
  await input.fill("Fresh after restart")
  await input.press("Enter")
  await expect(relay.getByText("ChatGPT mirrored response for Fresh after restart", { exact: true })).toBeVisible()
  expect(fixture.browserPrompts).toHaveLength(1)
  expect(fixture.browserPrompts[0].tabID).toBe(fixture.tabRequests[0].requestID)
  expect(fixture.errors).toEqual([])
})

test("V2 block tabs rebind writable sessions, preserve history, and survive reload", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", { chatRoles: ["operating", "master"], sessionTabs: true })
  for (const role of fixture.roles) {
    const chat = page.locator(`.block-chat[data-chat-role="${role}"]`)
    await expect(chat.locator('[data-component="prompt-input"]')).toBeVisible()
    await expect(chat.getByRole("tab", { name: `${role} conversation`, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await chat.getByRole("button", { name: "New session", exact: true }).click()
    await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}_2`)
    await expect(chat.locator('[data-component="prompt-input"]')).toBeVisible()
    await chat.getByRole("button", { name: "Session history", exact: true }).click()
    await chat.getByRole("option", { name: `${role} conversation`, exact: true }).click()
    await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}`)
    await expect(chat.locator('[data-component="prompt-input"]')).toBeVisible()
    if (role === "master")
      await expect(chat.getByText("ses_master independent previous answer", { exact: true })).toBeVisible()
    await chat.locator('[data-component="prompt-input"]').fill(`Continue ${role} original`)
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/session/ses_${role}/prompt`,
    )
    await chat.locator('[data-component="prompt-input"]').press("Enter")
    expect((await submitted).status()).toBe(200)
    expect(fixture.prompts.at(-1)?.path).toBe(`/api/session/ses_${role}/prompt`)
  }
  expect(fixture.tabRequests).toHaveLength(2)
  const remote = fixture.canvasTabs.find((tabs) => tabs.role === "master")!
  remote.selectedTabID = remote.items.find((tab) => tab.conversationID === "ses_master_2")!.id
  remote.revision++
  await fixture.transport.send({
    directory: fixture.directory,
    payload: {
      id: "evt_remote_canvas_tab",
      type: "workspace.canvas-tab.changed",
      properties: {
        workspaceID: fixture.workspaceID,
        kind: "master-agent",
        blockID: "block-master",
        revision: remote.revision,
      },
    },
  })
  const master = page.locator('.block-chat[data-chat-role="master"]')
  await expect(master).toHaveAttribute("data-chat-session", "ses_master_2")
  await expect(master.locator('[data-component="prompt-input"]')).toBeVisible()
  await master.getByRole("button", { name: "Session history", exact: true }).click()
  await master.getByRole("option", { name: "master conversation", exact: true }).click()
  await expect(master).toHaveAttribute("data-chat-session", "ses_master")
  await expect(page.getByRole("button", { name: "Reset session", exact: true })).toHaveCount(0)
  expect(JSON.stringify(fixture.layout)).not.toMatch(/selectedTabID|conversationID|tab-master|tab-operating/)
  await page.reload()
  for (const role of fixture.roles) {
    const chat = page.locator(`.block-chat[data-chat-role="${role}"]`)
    await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}`)
    await expect(chat.locator('[data-component="prompt-input"]')).toBeVisible()
    await chat.getByRole("button", { name: "Session history", exact: true }).click()
    await chat.getByRole("option", { name: `Archived ${role} conversation`, exact: true }).click()
    await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}_0`)
    await expect(chat.getByText(`ses_${role}_0 independent previous answer`, { exact: true })).toBeVisible()
    await chat.locator('[data-component="prompt-input"]').fill(`Continue restored ${role}`)
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/session/ses_${role}_0/prompt`,
    )
    await chat.locator('[data-component="prompt-input"]').press("Enter")
    expect((await submitted).status()).toBe(200)
  }
})

test("failed tab creation preserves the mounted conversation and draft", async ({ page }) => {
  await openCanvasBlockChats(page, "v2", { chatRoles: ["operating", "master"], sessionTabs: true })
  for (const role of ["master", "operating"]) {
    const chat = page.locator(`.block-chat[data-chat-role="${role}"]`)
    await expect(chat.getByRole("tab", { name: `${role} conversation`, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const input = chat.locator('[data-component="prompt-input"]')
    await input.fill(`${role} preserved draft`)
    const mounted = await input.elementHandle()
    await page.route(
      `**/canvas-tab/${role === "master" ? "master-agent" : "operating-chat"}/owned/block-${role}/create`,
      (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "CanvasTabBusyError", message: "Session is busy" }),
        }),
    )
    await chat.getByRole("button", { name: "New session", exact: true }).click()
    await expect(chat.locator('[role="alert"][data-tab-error]')).toBeVisible()
    await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}`)
    await expect(input).toHaveText(`${role} preserved draft`)
    expect(await mounted!.evaluate((element) => element.isConnected)).toBe(true)
  }
})

for (const protocol of ["v1", "v2"] as const) {
  test(`${protocol}: canvas chats and browser relay stay independent and execute an attached plan only on request`, async ({
    page,
  }, testInfo) => {
    const {
      directory,
      workspaceID,
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
      tabRequests,
      browserOpens,
      browserActions,
      relayReads,
      relayTab,
      transport,
    } = await openCanvasBlockChats(page, protocol)

    await expect(page.locator(".block-chat")).toHaveCount(2)
    for (const role of roles) {
      const chat = page.locator(`.block-chat[data-chat-role="${role}"]`)
      await expect(chat).toHaveAttribute("data-chat-session", `ses_${role}`)
      await expect(chat.locator('[data-component="prompt-input"]')).toBeVisible()
      await expect(chat.locator('[data-action="prompt-model"]')).toHaveCount(0)
      await expect(chat.locator('[data-slot="session-turn-assistant-content"]')).toHaveCount(
        role === "operating" ? 0 : 1,
      )
      if (role === "master")
        await expect(chat.getByText(`ses_${role} independent previous answer`, { exact: true })).toBeVisible()
      await chat.locator('[data-component="prompt-input"]').fill(`${role} independent draft`)
    }
    for (const role of roles)
      await expect(page.locator(`.block-chat[data-chat-role="${role}"] [data-component="prompt-input"]`)).toHaveText(
        `${role} independent draft`,
      )
    const operating = page.locator('.block-chat[data-chat-role="operating"]')
    const master = page.locator('.block-chat[data-chat-role="master"]')
    const relay = page.locator('[data-component="chat-relay"]')
    const relayInput = relay.locator('[data-input="chat-relay-message"]')
    await expect(relay).toBeVisible()
    await expect(relay.locator('[data-status-indicator="ready"]')).toHaveText("Ready")
    await expect(relay.locator('[data-component="prompt-input"]')).toHaveCount(1)
    await expect(relay.locator('[data-action="prompt-model"]')).toHaveCount(0)
    await expect(relay.getByText("ChatGPT independent previous answer", { exact: true })).toBeVisible()
    await relayInput.fill("relay independent draft")
    const operatingEditor = await operating.locator('[data-component="prompt-input"]').elementHandle()
    const ensured = requests.filter((path) => path.endsWith("/operating-chat/block-operating/ensure")).length
    await transport.send({
      directory,
      payload: {
        id: "evt_same_binding",
        type: "workspace.operatingChat.binding.updated",
        properties: {
          workspaceID,
          blockID: "block-operating",
          functionalityInstanceID: "instance-operating",
          sessionID: "ses_operating",
          directory,
          revision: 2,
        },
      },
    })
    await expect
      .poll(() => requests.filter((path) => path.endsWith("/operating-chat/block-operating/ensure")).length)
      .toBeGreaterThan(ensured)
    expect(await operatingEditor!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(operating.locator('[data-component="prompt-input"]')).toHaveText("operating independent draft")

    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/session/ses_operating/prompt",
    )
    await operating.locator('[data-component="prompt-input"]').press("Enter")
    expect((await submitted).status()).toBe(200)
    expect(prompts).toHaveLength(1)
    expect(prompts[0].path).toBe("/api/session/ses_operating/prompt")
    expect(prompts[0].body.prompt.text).toBe("operating independent draft")
    const timestamp = Date.now()
    const event = (type: string, data: Record<string, unknown>) => ({
      directory,
      payload: { id: `evt_${type}`, type, properties: { sessionID: "ses_operating", timestamp, ...data } },
    })
    await transport.burst([
      event("session.next.prompted", {
        messageID: prompts[0].body.id,
        prompt: { text: "operating independent draft" },
        delivery: "steer",
      }),
      event("session.next.step.started", { assistantMessageID: "msg_live_operating", agent: "build", model }),
      event("session.next.text.started", { assistantMessageID: "msg_live_operating", textID: "text_live_operating" }),
      event("session.next.text.delta", {
        assistantMessageID: "msg_live_operating",
        textID: "text_live_operating",
        delta: "Operating streamed response appears here.",
      }),
    ])
    await expect(operating.getByText("Operating streamed response appears here.", { exact: true })).toBeVisible()
    await expect(page.getByText("Operating streamed response appears here.", { exact: true })).toHaveCount(1)
    await transport.burst([
      event("session.next.text.ended", {
        assistantMessageID: "msg_live_operating",
        textID: "text_live_operating",
        text: "Operating streamed response appears here.",
      }),
      event("session.next.step.ended", { assistantMessageID: "msg_live_operating", finish: "stop", cost: 0, tokens }),
      event("session.status", { status: { type: "idle" } }),
    ])
    await expect(operating.locator('[role="status"]')).toHaveText("Ready")
    await expect(operating.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
    await expect(master.locator('[data-component="prompt-input"]')).toHaveText("master independent draft")
    await expect(relayInput).toHaveText("relay independent draft")
    await expect(master.getByText("ses_master independent previous answer", { exact: true })).toBeVisible()

    const relaySubmitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/prompt"),
    )
    await relayInput.press("Enter")
    expect((await relaySubmitted).status()).toBe(200)
    expect(browserPrompts).toHaveLength(1)
    expect(browserPrompts[0]).toMatchObject({ tabID: "tab-relay-1", text: "relay independent draft" })
    expect(browserPrompts[0].messageID).toBeTruthy()
    await expect(relayInput).toHaveText("")
    await expect(relay.getByText("relay independent draft", { exact: true })).toBeVisible()
    await expect(
      relay.getByText("ChatGPT mirrored response for relay independent draft", { exact: true }),
    ).toBeVisible()
    expect(relayReads()).toBeGreaterThan(0)
    expect(prompts).toHaveLength(1)

    const relayCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/canvas-tab/chat-relay/owned/block-relay/create"),
    )
    await relay.getByRole("button", { name: "New session", exact: true }).click()
    expect((await relayCreated).status()).toBe(200)
    expect(browserResets).toEqual([])
    expect(relayTab()).toBe(tabRequests[0].requestID)
    await expect(relay.locator('[data-component="chat-relay-transcript"]')).not.toContainText(
      "ChatGPT mirrored response for relay independent draft",
    )

    await relayInput.fill("message in the new tab")
    const secondRelayPrompt = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/prompt"),
    )
    await relay.getByRole("button", { name: "Send", exact: true }).click()
    expect((await secondRelayPrompt).status()).toBe(200)
    expect(browserPrompts[1]).toMatchObject({ tabID: tabRequests[0].requestID, text: "message in the new tab" })
    await expect(relay.getByText("ChatGPT mirrored response for message in the new tab", { exact: true })).toBeVisible()

    const relayOpened = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/chat-relay/block-relay/browser/open"),
    )
    await relay.locator('[data-action="chat-relay-open"]').click()
    expect((await relayOpened).status()).toBe(200)
    expect(browserOpens).toEqual([{ tabID: tabRequests[0].requestID }])

    const browser = page.locator('[data-component="ctxpack-browser"]')
    const card = browser.getByRole("button", { name: `Open context pack ${pack.title}`, exact: true })
    const draggable = browser.locator(`article[data-ctxpack-id="${pack.id}"]`)
    await expect(draggable).toHaveAttribute("draggable", "true")
    await expect(card).toContainText(`${pack.title}designtestingdelivery`)
    await expect(browser.locator(".ctxpack-browser-detail")).toHaveCount(0)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    expect(await browser.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      "rgb(255, 255, 255)",
    )
    await card.click()
    await expect(browser.locator(".ctxpack-browser-fragment-text")).toHaveText(pack.fragments[0].text)
    await expect(browser.getByText("hidden-fourth-keyword", { exact: true })).toBeVisible()
    await browser.getByRole("button", { name: "Close", exact: true }).click()
    await expect(draggable).toHaveAttribute("draggable", "true")
    const materialized = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/ctxpack/${pack.id}/materialize`),
    )
    await draggable.dragTo(master.locator('[data-component="prompt-input"]'))
    expect((await materialized).status()).toBe(200)
    const chips = master.locator('[data-component="prompt-input-v2-context-attachments"] [data-attachment-id]')
    await expect(chips).toHaveCount(1)
    await expect(chips).toContainText(pack.title)
    await expect(operating.locator("[data-attachment-id]")).toHaveCount(0)
    await expect(relay.locator("[data-attachment-id]")).toHaveCount(0)
    await expect(page.getByText("Drop files to attach", { exact: true })).toHaveCount(0)
    expect(materializations).toEqual([
      {
        expectedContentHash: pack.contentHash,
        targetInstanceID: "chat-instance:ses_master",
        targetFunctionalityID: "builtin:chat",
      },
    ])
    await expect(master.getByRole("button", { name: "Execute plan", exact: true })).toBeEnabled()
    expect(prompts).toHaveLength(1)
    await expect(operating.getByRole("button", { name: "Execute plan", exact: true })).toHaveCount(0)
    await expect(relay.getByRole("button", { name: "Execute plan", exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("canvas-chats-plan-attached.png"), fullPage: true })

    const executed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/session/ses_master/prompt",
    )
    await master.getByRole("button", { name: "Execute plan", exact: true }).click()
    expect((await executed).status()).toBe(200)
    await expect(chips).toHaveCount(0)
    await expect(master.locator('[data-component="prompt-input"]')).toHaveText("")
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatchObject({
      path: "/api/session/ses_master/prompt",
      body: {
        prompt: {
          text: "Execute the attached ParallelPlan context packs. Coordinate independent tasks in parallel, honor task dependencies, and report progress and results.\n\nmaster independent draft",
        },
        contextAttachments: [
          {
            contextCapsuleID: "ctxkpsl_parallel_plan",
            contentHash: pack.contentHash,
            label: pack.title,
            source: { kind: "ctxpack", ctxPackID: pack.id },
          },
        ],
      },
    })
    expect(legacyPrompts).toEqual([])
    expect(browserActions).toEqual([])
    expect(errors).toEqual([])
  })
}

test("v2: a disconnected ChatRelay points to Settings without opening a browser", async ({ page }) => {
  const fixture = await openCanvasBlockChats(page, "v2", {
    chatRoles: ["relay"],
    chatRelayDisconnected: true,
    waitForSse: false,
  })
  const relay = page.locator('[data-component="chat-relay"]')

  await expect(relay).toContainText("Connect ChatGPT in Settings")
  await expect
    .poll(
      () =>
        fixture.requests.filter(
          (request) => request === "GET /api/workspace/wrk_chat_acceptance/chat-relay/block-relay/browser",
        ).length,
    )
    .toBeGreaterThan(1)
  expect(fixture.browserActions).toEqual([])
  expect(fixture.errors).toEqual([])
})
