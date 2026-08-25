import { expect, test } from "bun:test"

test("discovers only timeline benchmark specs", async () => {
  const result = await Bun.$`bunx playwright test --config e2e/performance/playwright.config.ts --list`.quiet().nothrow()

  expect(result.exitCode).toBe(0)
  expect(result.text()).toContain("first-navigation-benchmark.spec.ts")
  expect(result.text()).not.toContain("timeline-stability")
  expect(result.text()).not.toContain("visual-stability.test.ts")
})
