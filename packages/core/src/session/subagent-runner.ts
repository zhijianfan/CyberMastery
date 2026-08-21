export * as SubagentRunner from "./subagent-runner"

import { Context, Effect, Layer, Schema } from "effect"
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
}) {}

export type Input = {
  readonly parentSessionID: SessionSchema.ID
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
          parentID: parent.id,
          location: parent.location,
          agent: input.agent,
          model: input.model,
          title: input.title,
        })
        yield* SessionInput.admit(database.db, events, {
          id: SessionMessage.ID.create(),
          sessionID: child.id,
          prompt: { text: input.prompt },
          delivery: "steer",
        })
        yield* runner.run({ sessionID: child.id, force: true }).pipe(
          Effect.mapError((error) => new RunError({ message: error instanceof Error ? error.message : String(error) })),
        )
        const assistant = (yield* store.context(child.id)).findLast((message) => message.type === "assistant")
        if (!assistant)
          return yield* Effect.fail(new RunError({ message: `Worker did not return an assistant message: ${child.id}` }))
        if (assistant.error)
          return yield* Effect.fail(new RunError({ message: `Worker failed: ${assistant.error.message ?? "unknown error"}` }))
        const text = assistant.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        if (!text) return yield* Effect.fail(new RunError({ message: `Worker did not return text: ${child.id}` }))
        return { sessionID: child.id, text }
      }).pipe(Effect.mapError((error) => (error instanceof RunError ? error : new RunError({ message: String(error) }))))

    return Service.of({ run })
  }),
)

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
