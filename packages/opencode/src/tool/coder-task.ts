import { Effect, Schema } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Provider } from "@/provider/provider"
import { SessionID } from "../session/schema"
import { Tool } from "./tool"

// Temporary ports frozen from 02-contracts-and-data-model.md section 10.
// Replace with R1's MasterAgentSessionContext and R3's ChildTaskRunner on merge.

export interface ModelSelection {
  readonly modelID: string
  readonly providerID: string
}

export interface MasterAgentSessionContext {
  readonly workspaceID: Workspace.ID
  readonly blockID: string
  readonly functionalityInstanceID: string
  readonly parentSessionID: SessionID
  readonly directory: string
  readonly primaryModel: ModelSelection | null
  readonly operatingAgent: string | null
  readonly coderModel: ModelSelection | null
  readonly taskPermission: "allow" | "deny" | "ask" | "default"
}

export interface ChildTaskResult {
  readonly sessionID: SessionID
  readonly output: string
}

export interface ChildTaskRunner {
  readonly runTrusted: (input: {
    readonly parentSessionID: SessionID
    readonly directory: string
    readonly agentID: "coder"
    readonly model: ModelSelection
    readonly task: string
    readonly context?: string
  }) => Effect.Effect<ChildTaskResult, Error>
}

export interface CoderTaskOps {
  readonly resolve: (sessionID: SessionID) => Effect.Effect<MasterAgentSessionContext, Error>
  readonly run: ChildTaskRunner["runTrusted"]
}

const id = "coder-task"

const DESCRIPTION = [
  "Delegate coding execution to the workspace Coder agent. Use when the workspace has Coder mode enabled and implementation, build, test, migration, debugging, formatting, or other repository work must be performed.",
  "The host creates a child Coder session using the workspace-selected Coder model, working directory, parent session, agent, and permissions. The model, provider, directory, workspace, agent, and permission choices are resolved by the host and cannot be overridden through arguments.",
  "Returns the child session result for the primary agent to synthesize into the final answer. If the Coder model is unavailable or incompatible, the call fails visibly and never falls back to the primary model.",
].join("\n")

export const Parameters = Schema.Struct({
  task: Schema.String.annotate({
    description: "The coding task to delegate to the Coder agent",
  }),
  context: Schema.optional(Schema.String).annotate({
    description: "Optional additional context for the Coder agent",
  }),
})

function renderOutput(input: { sessionID: SessionID; text: string }) {
  return [
    `<coder-task id="${input.sessionID}" state="completed">`,
    `<result>`,
    input.text,
    `</result>`,
    "</coder-task>",
  ].join("\n")
}

export const CoderTaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const provider = yield* Provider.Service

    const run = Effect.fn("CoderTaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const ops = ctx.extra?.coderTaskOps as CoderTaskOps | undefined
      if (!ops) return yield* Effect.fail(new Error("CoderTaskTool requires coderTaskOps in ctx.extra"))

      const resolved = yield* ops.resolve(ctx.sessionID).pipe(
        Effect.mapError(
          (cause) => new Error(`Coder delegation unavailable for this session: ${cause.message}`),
        ),
      )

      if (resolved.coderModel === null) {
        return yield* Effect.fail(
          new Error(
            "Coder mode is not configured for this workspace. Select a Coder model before delegating coding work; the primary model is not used for coding execution.",
          ),
        )
      }

      if (resolved.taskPermission === "deny") {
        return yield* Effect.fail(
          new Error(`Coder delegation is not permitted: the "task" permission is denied for this session.`),
        )
      }

      if (resolved.taskPermission !== "allow") {
        yield* ctx.ask({
          permission: "task",
          patterns: ["coder"],
          always: ["*"],
          metadata: { agent: "coder" },
        })
      }

      const snapshot = {
        parentSessionID: resolved.parentSessionID,
        directory: resolved.directory,
        workspaceID: resolved.workspaceID,
        model: resolved.coderModel,
      }

      const model = yield* provider
        .getModel(ProviderV2.ID.make(snapshot.model.providerID), ModelV2.ID.make(snapshot.model.modelID))
        .pipe(
          Effect.catchTag("ProviderModelNotFoundError", () =>
            Effect.fail(
              new Error(
                `Coder model ${snapshot.model.providerID}/${snapshot.model.modelID} is unavailable. Choose a different Coder model and retry; the primary model was not used.`,
              ),
            ),
          ),
        )

      if (!model.capabilities.toolcall) {
        return yield* Effect.fail(
          new Error(
            `Coder model ${snapshot.model.providerID}/${snapshot.model.modelID} is incompatible with coding execution because it does not support tool calls. Choose a different Coder model and retry; the primary model was not used.`,
          ),
        )
      }

      const result = yield* ops
        .run({
          parentSessionID: snapshot.parentSessionID,
          directory: snapshot.directory,
          agentID: "coder",
          model: snapshot.model,
          task: params.task,
          ...(params.context ? { context: params.context } : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new Error(`Coder task failed on ${snapshot.model.providerID}/${snapshot.model.modelID}: ${cause.message}`),
          ),
        )

      return {
        title: "Coder task",
        metadata: {
          parentSessionID: snapshot.parentSessionID,
          childSessionID: result.sessionID,
          workspaceID: snapshot.workspaceID,
          directory: snapshot.directory,
          model: snapshot.model,
          agent: "coder",
        },
        output: renderOutput({ sessionID: result.sessionID, text: result.output }),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
