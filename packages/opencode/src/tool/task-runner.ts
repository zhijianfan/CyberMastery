import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

export interface ModelSelection {
  readonly modelID: string
  readonly providerID: string
  readonly variant?: string
}

export interface ChildTaskResult {
  readonly sessionID: SessionID
  readonly output: string
}

/**
 * Host admission path used to drive the child session. The host resolves the
 * prompt parts and admits the prompt through the existing SessionPrompt
 * surface; the runner never opens a second chat implementation.
 */
export interface TaskRunnerOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts, Error>
}

/**
 * Trusted caller surface, frozen in 02-contracts-and-data-model.md section 10.
 * Trusted host callers resolve model/agent/directory; the model-visible tool
 * argument schema never exposes these fields.
 */
export interface TrustedRunInput {
  parentSessionID: SessionID
  directory: string
  agentID: "coder"
  model: ModelSelection
  task: string
  context?: string
}

export interface ChildTaskRunner {
  runTrusted(input: TrustedRunInput): Effect.Effect<ChildTaskResult, Error>
}

export interface PrepareChildInput {
  parentSessionID: SessionID
  /** Assistant message the child inherits model/variant from when no host-resolved model is given. */
  parentMessageID?: MessageID
  agentID: string
  title: string
  /** Resume an existing child session instead of creating one. */
  taskID?: SessionID
  /** Host-resolved model override; otherwise the agent's configured model, then the parent message model. */
  model?: ModelSelection
  /** Host-resolved working directory, recorded on the child session. */
  directory?: string
}

export interface PreparedChild {
  sessionID: SessionID
  agentName: string
  model: ModelSelection
  /** Child prompt variant; undefined when the child has a dedicated model. */
  variant?: string
  /** Parent message variant, for parent-side presentation. */
  parentVariant?: string
}

export interface RunPromptInput {
  sessionID: SessionID
  agentName: string
  model: ModelSelection
  prompt: string
  context?: string
  variant?: string
}

export interface TaskRunner {
  prepareChild(input: PrepareChildInput): Effect.Effect<PreparedChild, Error>
  runPrompt(input: RunPromptInput): Effect.Effect<string, Error>
  runTrusted(input: TrustedRunInput): Effect.Effect<ChildTaskResult, Error>
}

export interface TaskRunnerEnv {
  agent: Agent.Interface
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
}

const prepareChild = Effect.fn("TaskRunner.prepareChild")(function* (
  ops: TaskRunnerOps,
  input: PrepareChildInput,
  env: TaskRunnerEnv,
) {
  const next = yield* env.agent.get(input.agentID)
  if (!next) {
    return yield* Effect.fail(new Error(`Unknown agent type: ${input.agentID} is not a valid agent type`))
  }

  const parent = yield* env.sessions.get(input.parentSessionID)
  const existing = input.taskID
    ? yield* env.sessions.get(input.taskID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    : undefined

  const childPermission = deriveSubagentSessionPermission({
    parentSessionPermission: parent.permission ?? [],
    subagent: next,
  })
  const cfg = yield* env.config.get()
  const childToolDenies = [
    ...(next.permission.some((rule) => rule.permission === "todowrite")
      ? []
      : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(next.permission.some((rule) => rule.permission === "task")
      ? []
      : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(cfg.experimental?.primary_tools?.map((permission) => ({
      permission,
      pattern: "*" as const,
      action: "deny" as const,
    })) ?? []),
  ]
  const nextSession =
    existing ??
    (yield* env.sessions.create({
      parentID: input.parentSessionID,
      title: input.title,
      agent: next.name,
      metadata: input.directory ? { directory: input.directory } : undefined,
      permission: [
        ...childPermission,
        ...childToolDenies.filter(
          (deny) =>
            !childPermission.some(
              (rule) =>
                rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
            ),
        ),
      ],
    }))

  if (input.model) {
    return {
      sessionID: nextSession.id,
      agentName: next.name,
      model: input.model,
    }
  }

  if (!input.parentMessageID) {
    return yield* Effect.fail(
      new Error("TaskRunner requires a parent assistant message to inherit the child model"),
    )
  }
  const msg = yield* MessageV2.get({ sessionID: input.parentSessionID, messageID: input.parentMessageID }).pipe(
    Effect.provideService(Database.Service, env.database),
    Effect.orDie,
  )
  if (msg.info.role !== "assistant") {
    return yield* Effect.fail(new Error("Not an assistant message"))
  }
  return {
    sessionID: nextSession.id,
    agentName: next.name,
    model: next.model ?? { modelID: msg.info.modelID, providerID: msg.info.providerID },
    variant: next.model ? undefined : msg.info.variant,
    parentVariant: msg.info.variant,
  }
})

const runPrompt = Effect.fn("TaskRunner.runPrompt")(function* (
  ops: TaskRunnerOps,
  input: RunPromptInput,
  env: TaskRunnerEnv,
) {
  const parts = yield* ops.resolvePromptParts(input.prompt)
  const withContext = input.context ? [...parts, { type: "text" as const, text: input.context }] : parts
  const result = yield* ops.prompt({
    messageID: MessageID.ascending(),
    sessionID: input.sessionID,
    model: {
      modelID: ModelV2.ID.make(input.model.modelID),
      providerID: ProviderV2.ID.make(input.model.providerID),
    },
    variant: input.variant ?? input.model.variant,
    agent: input.agentName,
    parts: withContext,
  })
  return result.parts.findLast((item) => item.type === "text")?.text ?? ""
})

const runTrusted = Effect.fn("TaskRunner.runTrusted")(function* (
  ops: TaskRunnerOps,
  input: TrustedRunInput,
  env: TaskRunnerEnv,
) {
  const prepared = yield* prepareChild(ops, {
    parentSessionID: input.parentSessionID,
    agentID: input.agentID,
    title: "Coder task",
    model: input.model,
    directory: input.directory,
  }, env)
  const output = yield* runPrompt(ops, {
    sessionID: prepared.sessionID,
    agentName: prepared.agentName,
    model: prepared.model,
    prompt: input.task,
    context: input.context,
  }, env)
  return { sessionID: prepared.sessionID, output }
})

/**
 * Build the host-internal runner from captured service values. The runner
 * methods are requirement-free so they can be passed to detached execution
 * (background jobs) or the trusted `ChildTaskRunner` surface.
 */
export const makeTaskRunner = (ops: TaskRunnerOps, env: TaskRunnerEnv): TaskRunner => ({
  prepareChild: (input) => prepareChild(ops, input, env),
  runPrompt: (input) => runPrompt(ops, input, env),
  runTrusted: (input) => runTrusted(ops, input, env),
})
