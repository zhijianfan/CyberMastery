export * as SubagentRunner from "./subagent-runner"

import { Cause, Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { SessionCreate } from "./create"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionRunner, SessionRunnerLLM } from "./runner"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

export class RunError extends Schema.TaggedErrorClass<RunError>()("SubagentRunner.RunError", {
  message: Schema.String,
  sessionID: Schema.optional(SessionSchema.ID),
  outcome: Schema.optional(Schema.Literals(["error", "interrupted"])),
}) {}

export type Input = {
  readonly parentSessionID: SessionSchema.ID
  readonly childSessionID?: SessionSchema.ID
  readonly promptMessageID?: SessionMessage.ID
  readonly agent: AgentV2.ID
  readonly model: ModelV2.Ref
  readonly title: string
  readonly prompt: string
}

export interface Interface {
  readonly run: (input: Input) => Effect.Effect<{ readonly sessionID: SessionSchema.ID; readonly text: string }, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentRunner") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const runner = yield* SessionRunner.Service
    const create = SessionCreate.make(database, events, projects, store)

    const run: Interface["run"] = (input) =>
      Effect.gen(function* () {
        const parent = yield* store.get(input.parentSessionID)
        if (!parent) return yield* Effect.fail(new RunError({ message: `Parent session not found: ${input.parentSessionID}` }))
        if (parent.location.directory !== location.directory || parent.location.workspaceID !== location.workspaceID)
          return yield* Effect.fail(
            new RunError({ message: `Parent session is not available in this location: ${input.parentSessionID}` }),
          )
        const child = yield* create({
          id: input.childSessionID,
          parentID: parent.id,
          location: parent.location,
          agent: input.agent,
          model: input.model,
          title: input.title,
        })
        if (!matchesConfiguration(child, parent, input))
          return yield* Effect.fail(
            new RunError({ message: "Worker child configuration conflicts with retry", sessionID: child.id }),
          )
        return yield* Effect.uninterruptibleMask((restore) =>
          restore(
            Effect.gen(function* () {
              const prompt = { text: input.prompt }
              const admitted = yield* SessionInput.admit(database.db, events, {
                id: input.promptMessageID ?? SessionMessage.ID.create(),
                sessionID: child.id,
                prompt,
                delivery: "steer",
              })
              if (!SessionInput.equivalent(admitted, { sessionID: child.id, prompt, delivery: "steer" }))
                return yield* Effect.fail(new RunError({ message: `Worker prompt identity conflicts: ${admitted.id}` }))
              yield* runner.run({ sessionID: child.id, force: false })
              const assistant = (yield* store.context(child.id)).findLast((message) => message.type === "assistant")
              if (!assistant)
                return yield* Effect.fail(
                  new RunError({ message: `Worker did not return an assistant message: ${child.id}` }),
                )
              if (assistant.error)
                return yield* Effect.fail(
                  new RunError({ message: `Worker failed: ${assistant.error.message ?? "unknown error"}` }),
                )
              const text = assistant.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
              if (!text) return yield* Effect.fail(new RunError({ message: `Worker did not return text: ${child.id}` }))
              return { sessionID: child.id, text }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new RunError({
                    message:
                      error instanceof RunError ? error.message : error instanceof Error ? error.message : String(error),
                    sessionID: child.id,
                    outcome: "error",
                  }),
              ),
            ),
          ).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.fail(
                    new RunError({
                      message: `Worker interrupted: ${child.id}`,
                      sessionID: child.id,
                      outcome: "interrupted",
                    }),
                  )
                : Effect.failCause(cause),
            ),
          ),
        )
      }).pipe(Effect.mapError((error) => (error instanceof RunError ? error : new RunError({ message: String(error) }))))

    return Service.of({ run })
  }),
)

function matchesConfiguration(child: SessionSchema.Info, parent: SessionSchema.Info, input: Input) {
  return (
    child.parentID === parent.id &&
    child.location.directory === parent.location.directory &&
    child.location.workspaceID === parent.location.workspaceID &&
    child.agent === input.agent &&
    child.model?.providerID === input.model.providerID &&
    child.model.id === input.model.id &&
    child.model.variant === (input.model.variant ?? ModelV2.VariantID.make("default")) &&
    child.title === input.title
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionProjector.node,
    SessionStore.node,
    Location.node,
    SessionRunnerLLM.node,
  ],
})
