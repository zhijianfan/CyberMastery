import { expect, test } from "@playwright/test"
import { ctxPackFixture } from "./utils/ctxpack"

// Real canvas/composer and generated clients, isolated network fixture state.
// Core/Server integration tests own repository and authorization semantics.
test.describe("ctxpack", () => {
  test("saves selected text, opens the returned pack, drags it and admits one authenticated prompt", async ({
    page,
  }) => {
    const fixture = await ctxPackFixture(page)
    const pack = await fixture.createFromSelection()
    await fixture.openAndAttach(pack)
    const response = page.waitForResponse(fixture.isPromptResponse)
    await fixture.input.fill("Summarize the attached pack")
    await fixture.input.press("Enter")
    expect((await response).status()).toBe(200)
    await expect(fixture.chips).toHaveCount(0)
    await expect(fixture.input).toHaveText("")
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0]?.headers.authorization).toBe(fixture.authorization)
    expect(fixture.prompts[0]?.body).toMatchObject({
      id: expect.any(String),
      prompt: { text: "Summarize the attached pack" },
      delivery: "steer",
      contextAttachments: [
        {
          contextCapsuleID: fixture.capsuleID,
          contentHash: pack.contentHash,
          label: pack.title,
          source: { kind: "ctxpack", ctxPackID: pack.id },
        },
      ],
    })
    expect(fixture.prompts[0]?.body.contextAttachments).toHaveLength(1)
    expect(JSON.stringify(fixture.prompts[0]?.body.contextAttachments)).not.toContain(fixture.fragmentText)
    expect(fixture.legacyPrompts).toEqual([])
  })

  test("rejected admission restores the draft and attachment, then an explicit retry succeeds", async ({ page }) => {
    const fixture = await ctxPackFixture(page, { rejectFirstPrompt: true })
    const pack = await fixture.createFromSelection()
    await fixture.openAndAttach(pack)
    const rejected = page.waitForResponse(fixture.isPromptResponse)
    await fixture.input.fill("Keep this draft")
    await fixture.input.press("Enter")
    expect((await rejected).status()).toBe(500)
    await expect(fixture.input).toHaveText("Keep this draft")
    await expect(fixture.chips).toHaveCount(1)
    await expect(fixture.chips).toContainText(pack.title)
    expect(fixture.prompts).toHaveLength(1)
    const admitted = page.waitForResponse(fixture.isPromptResponse)
    await fixture.input.press("Enter")
    expect((await admitted).status()).toBe(200)
    await expect(fixture.chips).toHaveCount(0)
    await expect(fixture.input).toHaveText("")
    expect(fixture.prompts).toHaveLength(2)
    expect(fixture.prompts[1]?.body.contextAttachments).toEqual(fixture.prompts[0]?.body.contextAttachments)
    expect(fixture.prompts[1]?.body.prompt.text).toBe("Keep this draft")
    expect(fixture.legacyPrompts).toEqual([])
  })
})
