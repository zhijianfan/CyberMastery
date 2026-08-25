import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect } from "../benchmark"
import { measureFirstNavigation } from "./first-navigation-probe"
import { fixture } from "./session-timeline-stress.fixture"
import { installTimelineSettings, mockStressTimeline, stressSessionHref } from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const contentSelector = '[data-message-id], [data-component="prompt-input"]'

benchmark.describe("performance: first navigation paint", () => {
  benchmark("opens a linked child session without a blank frame", async ({ page, report }) => {
    await setup(page)
    const href = stressSessionHref(fixture.childID)
    const link = page.locator(`a[href="${href}"]`, { has: page.locator('[data-component="task-tool-card"]') })
    await expect(link).toBeVisible()
    const result = await measureFirstNavigation(page, {
      href,
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.childMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await link.click()
        await expectSessionTitle(page, fixture.expected.childTitle)
      },
    })
    report(result)
    expect(result.summary.blankSamples).toBe(0)
    expect(result.summary.unknownSamples).toBe(0)
  })
})

async function setup(page: Parameters<typeof mockStressTimeline>[0]) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
