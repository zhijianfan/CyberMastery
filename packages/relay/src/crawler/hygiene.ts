import { jitter, lcg } from "./human.js"

export class BudgetExceeded extends Error {
  constructor() {
    super("budget-exceeded")
    this.name = "BudgetExceeded"
  }
}

export class SessionHygiene {
  private random = lcg(0x1ce)

  constructor(private dailyBudget = 40) {}

  async guard(turnsToday: number): Promise<void> {
    if (turnsToday >= this.dailyBudget) throw new BudgetExceeded()
  }

  cooldownMs(): number {
    return Math.min(15 * 60_000, Math.max(60_000, Math.round(jitter(3, 12, this.random) * 60_000)))
  }
}
