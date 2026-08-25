import { benchmark, expect } from "../benchmark"
import { expectSessionTitle } from "../../utils/waits"
import { measureNavigationMilestones } from "./navigation-milestones"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, installTimelineSettings, mockStressTimeline } from "./timeline-test-helpers"

const homeRow = '[data-component="home-session-row"]'

benchmark.describe("performance: home navigation", () => {
  benchmark("opens a home session and paints its content", async ({ page, report }) => {
    await setup(page)
    await page.goto("/")
    const row = page.locator(homeRow).filter({ hasText: fixture.expected.targetTitle }).first()
    await expect(row).toBeVisible()
    const content = messageSelector(fixture.expected.targetMessageIDs.at(-1)!)
    const result = await measureNavigationMilestones(page, {
      triggerSelector: homeRow,
      milestones: {
        content: { selector: content },
      },
      navigate: async () => {
        await row.click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })
    report(result)
    await expect(page.locator(content).first()).toBeVisible()
  })
})

async function setup(page: Parameters<typeof mockStressTimeline>[0]) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await installStressSessionTabs(page, { sessionIDs: [] })
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
