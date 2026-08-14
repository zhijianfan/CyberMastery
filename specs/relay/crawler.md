# Relay Crawler — Pseudo-Implementation

Status: proposed
Companion: [architecture.md](./architecture.md) (file-only block this feeds)
Scope: execute-capable upstream capture. Everything here runs **outside** the
relay block. The block only ever consumes transcript files from the inbox.

## 1. Portion map

| Pipeline portion | Implemented here | Notes |
|---|---|---|
| Send prompt, capture streaming text | Yes | §3 |
| Multi-turn continuation prompts | Yes | `runPlan` drives the doc-per-turn sequence |
| Regenerate, attachments, model toggles | Yes | Where the UI exposes them |
| Conversation metadata (id, title, URL) | Yes | §3.4 |
| Write transcript into `specs/relay/inbox/` | Yes | The crawler's only file write |
| Doc extraction / classification / organizing | No | Relay block (`architecture.md`) |
| Coherence pass / plan execution | No | Downstream execute-capable passes |
| CAPTCHA, 2FA, login walls | No | Abort → human (never auto-retry) |

Degradation ladder: **official API adapter → crawler → manual paste import**.
The crawler is always optional, never the single point of failure.

## 2. Adapter contract

```ts
interface ChatProvider {
  readonly id: "chatgpt" | "claude" | ...

  // capability probe: is the API adapter usable for this account?
  prefersApi(): boolean

  // page-scoped session on a persistent browser profile
  openSession(): Promise<ChatSession>
}

interface Turn {
  role: "user" | "assistant"
  text: string            // rendered markdown
  startedAt: number
  finishedAt: number | null   // null = capture interrupted
}

interface ChatSession {
  readonly conversationId: string
  readonly url: string

  send(prompt: string): AsyncIterable<{ delta: string }>
  captureTurn(): Promise<Turn>
  regenerate(): Promise<void>
  attach(files: string[]): Promise<void>
  dispose(): Promise<void>
}
```

## 3. Pseudo-implementation

### 3.1 Session bootstrap (real browser, persistent profile)

```ts
async function launchProfile(profileDir: string) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",                    // real Chrome build
    headless: false,                      // persistent profile ⇒ headed
    userAgent: "",                        // omitted: match the actual build
    viewport: { width: 1536, height: 900 },
    timezoneId: "Asia/Shanghai",          // fixed per profile, never changes
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled"],
  })
  await ctx.addInitScript(() => {
    // minimal patch only — full stealth libraries carry their own signatures
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  })
  return ctx
}
```

### 3.2 Warm-up + health probe

```ts
async function warmUp(page: ChatPage) {
  await page.goto(homeUrl)
  await humanScroll(page)                    // organic scroll before acting
  await page.openRecentConversation()        // never deep-link cold into a fresh chat
}

// send a trivial ping before the real run; abort cleanly on selector drift
async function selfTest(session: ChatSession): Promise<boolean> {
  await session.send("ping")
  const turn = await session.captureTurn({ timeoutMs: 30_000 })
  return turn.finishedAt !== null
}
```

### 3.3 Prompting with human-like input

```ts
async function typeLikeHuman(page: Page, text: string) {
  for (const chunk of splitByClause(text)) {
    for (const ch of chunk) {
      await page.keyboard.type(ch, { delay: jitter(35, 60) })  // gaussian, not uniform
      if (Math.random() < 0.004) {                               // occasional fix-up
        await page.keyboard.press("Backspace")
        await page.keyboard.type(ch, { delay: jitter(80, 140) })
      }
    }
    await pause(jitter(250, 900))            // clause-level think pauses
  }
}

function jitter(base: number, spread: number) {
  return Math.max(20, base + (randn() * spread))
}
```

### 3.4 Stream capture + completion detection

```ts
async function captureTurn(page: Page, opts: { timeoutMs: number }): Promise<Turn> {
  const startedAt = Date.now()
  const container = page.getByRole("article").last()          // ARIA roles only

  const text = await withQuietPeriod(container, opts.timeoutMs, {
    quietMs: 2000,              // completion = stop button gone
    check: () => sendButtonVisible(page) || stopButtonGone(page),
  })

  const finished = await completionConfirmed(page)
  return {
    text: extractMarkdown(container),         // walk tree: headings/code/tables
    finishedAt: finished ? Date.now() : null, // null ⇒ mark transcript incomplete
    ...
  }
}
```

### 3.5 Anti-detection session hygiene

```ts
class SessionHygiene {
  dailyBudget = 40 turns/profile            // below organic-use levels

  // One account ↔ one profile ↔ one IP. Never parallel sessions per account.
  async guard(session: ChatSession) {
    if (await this.overBudget(session)) throw new BudgetExceeded()
    if (await this.flagged(session)) throw new SessionUnhealthy()
  }

  async cooldown() {                         // post-run: idle browsing, not idle loop
    await pause(jitter(3, 15) * 60_000)
  }
}

// CAPTCHA / Turnstile / login wall: stop, screenshot, surface to human.
async function onChallenge(page: Page) {
  await page.screenshot({ path: `relay/failures/${Date.now()}.png` })
  markUnhealthy()
  throw new HumanInterventionRequired("captcha")
}

// Partial capture is saved — never discarded.
// onStreamInterrupt(): write turn with finishedAt = null, mark incomplete.
```

### 3.6 Doc-per-turn run plan (the relay's main sequence)

```ts
async function runPlan(session: ChatSession, idea: string) {
  const prompts = [
    ["product",   `${idea}\n\nWrite the product requirements document.`],
    ["arch",      `Continue as workspace-canvas/architecture.md style architecture.`],
    ["plan",      `Now write the implementation plan as contract-first parallel tracks.`],
  ]
  for (const [kind, prompt] of prompts) {
    await typeLikeHuman(page, prompt)
    const turn = await captureTurn(page, { timeoutMs: 10 * 60_000 })
    writeInbox({ conversationId, kind, turn })     // only file write
    await interTurnPause()                          // jittered, proportional to length
  }
}
```

## 4. Failure & ops rules

- Never auto-retry after a challenge; cooldown ≥ 24 h for a flagged session.
- Every run logs: selectors used, DOM snapshot + screenshot on failure, timing
  trace — the basis for selector maintenance and detection forensics.
- Fingerprint is per-profile and immutable; any change ⇒ new profile + re-login.
- Blocked account ⇒ fall back to manual paste import; crawler is never required.
- Operate within provider ToS; prefer the API adapter whenever keys exist.

## 5. What the crawler must never do

- Run inside the relay block (file-only constraint from `architecture.md`).
- Touch files outside `specs/relay/inbox/`.
- Impersonate fresh devices per run, rotate IPs, or run many accounts from one
  IP — account-level ML scoring is the one layer that cannot be patched away.
