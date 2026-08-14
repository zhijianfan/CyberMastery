import * as fs from "node:fs/promises"
import * as path from "node:path"
import { renderInboxFile, type ChatSession, type InboxFile } from "./types.js"
import { SessionHygiene } from "./hygiene.js"

export interface PlanPrompt {
  kind: string
  prompt: string
}

export const DEFAULT_PLAN: readonly PlanPrompt[] = [
  { kind: "product", prompt: "{idea}\n\nWrite the product requirements document." },
  { kind: "arch", prompt: "Continue with the architecture document." },
  { kind: "plan", prompt: "Now write the implementation plan as contract-first parallel tracks." },
]

export function interpolate(prompt: string, idea: string): string {
  return prompt.replace(/\{idea\}/g, idea)
}

export async function writeInboxTurn(opts: { inboxDir: string; file: InboxFile }): Promise<string> {
  const filename = `${opts.file.conversationId}-${opts.file.turn}.md`
  if (!filename.endsWith(".md")) throw new Error("inbox filename must be markdown")
  const target = path.join(opts.inboxDir, filename)
  const resolved = path.resolve(target)
  const base = path.resolve(opts.inboxDir)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("inbox path escapes inbox directory")
  }
  await fs.mkdir(opts.inboxDir, { recursive: true })
  await fs.writeFile(target, renderInboxFile(opts.file), "utf8")
  return target
}

const DEFAULT_HYGIENE = new SessionHygiene()

export async function runPlan(opts: {
  session: ChatSession
  idea: string
  inboxDir: string
  plan?: readonly PlanPrompt[]
  hygiene?: SessionHygiene
}): Promise<string[]> {
  const plan = opts.plan ?? DEFAULT_PLAN
  const hygiene = opts.hygiene ?? DEFAULT_HYGIENE
  await hygiene.guard(0)

  const written: string[] = []
  const capturedAt = () => new Date().toISOString()

  for (const [index, entry] of plan.entries()) {
    const prompt = interpolate(entry.prompt, opts.idea)
    const userBody = `User prompt (${entry.kind}):\n${prompt}`
    const userTurn = 2 * index + 1
    written.push(
      await writeInboxTurn({
        inboxDir: opts.inboxDir,
        file: {
          source: "chatgpt",
          conversationId: opts.session.conversationId,
          turn: userTurn,
          capturedAt: capturedAt(),
          complete: true,
          body: userBody,
        },
      }),
    )

    for await (const _delta of opts.session.send(prompt)) {
      void _delta
    }

    const turn = await opts.session.captureTurn({ quietMs: 2000, timeoutMs: 600_000 })
    const assistantTurn = 2 * index + 2
    written.push(
      await writeInboxTurn({
        inboxDir: opts.inboxDir,
        file: {
          source: "chatgpt",
          conversationId: opts.session.conversationId,
          turn: assistantTurn,
          capturedAt: capturedAt(),
          complete: turn.finishedAt !== null,
          body: turn.text,
        },
      }),
    )

    if (index < plan.length - 1) {
      const pause = hygiene.cooldownMs()
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause))
    }
  }

  return written
}
