import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCreate } from "@opencode-ai/core/session/create"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunner, SessionRunnerLLM } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SubagentRunner } from "@opencode-ai/core/session/subagent-runner"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = ModelV2.Ref.make({ id: ModelV2.ID.make("worker"), providerID: ProviderV2.ID.make("test") })
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const runs: Array<{ sessionID: SessionV2.ID; force: boolean }> = []
let gate: Deferred.Deferred<void> | undefined
let started: Deferred.Deferred<void> | undefined
let active = 0
let maxActive = 0
let runnerMode: "success" | "failure" | "assistant-error" | "empty" = "success"
const runner = Layer.effect(
  SessionRunner.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return SessionRunner.Service.of({
      run: (input) =>
        Effect.gen(function* () {
          runs.push(input)
          active++
          maxActive = Math.max(maxActive, active)
          if (active === 2 && started) yield* Deferred.succeed(started, undefined)
          if (gate) yield* Deferred.await(gate)
          if (runnerMode === "failure")
            return yield* Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID: input.sessionID }))
          const timestamp = DateTime.makeUnsafe(Date.now())
          const messageID = SessionMessage.ID.make(`msg_worker_${input.sessionID}`)
          const message = encodeMessage(
            SessionMessage.Assistant.make({
              id: messageID,
              type: "assistant",
              agent: "parallel-worker",
              model,
              content:
                runnerMode === "empty"
                  ? []
                  : [{ type: "text", id: "text_worker_result", text: "Worker completed the owned change" }],
              ...(runnerMode === "assistant-error" ? { error: { type: "unknown", message: "Provider failed" } } : {}),
              time: { created: timestamp },
            }),
          )
          const { id: _, type, ...data } = message
          yield* db
            .insert(SessionMessageTable)
            .values([{
              id: messageID,
              session_id: input.sessionID,
              type,
              seq: 1,
              data,
              time_created: DateTime.toEpochMillis(timestamp),
            }])
            .run()
            .pipe(Effect.orDie)
        }).pipe(Effect.ensuring(Effect.sync(() => active--))),
    })
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, ProjectV2.node, SessionProjector.node, SessionStore.node, SubagentRunner.node]),
    [
      [ProjectV2.node, projects],
      [Location.node, Location.boundNode(location)],
      [SessionRunnerLLM.node, runner],
    ],
  ),
)

describe("SubagentRunner", () => {
  it.effect("creates and runs a same-location child with the fixed model snapshot", () =>
    Effect.gen(function* () {
      runs.length = 0
      gate = undefined
      started = undefined
      active = 0
      maxActive = 0
      runnerMode = "success"
      const runner = yield* SubagentRunner.Service
      const parent = yield* SessionCreate.make(
        yield* Database.Service,
        yield* EventV2.Service,
        yield* ProjectV2.Service,
        yield* SessionStore.Service,
      )({ location, agent: AgentV2.ID.make("parallel-master"), model })

      const result = yield* runner.run({
        parentSessionID: parent.id,
        agent: AgentV2.ID.make("parallel-worker"),
        model,
        title: "Update isolated module",
        prompt: "Change only src/example.ts",
      })
      const child = yield* (yield* SessionStore.Service).get(result.sessionID)

      expect(result.text).toBe("Worker completed the owned change")
      expect(child).toMatchObject({
        parentID: parent.id,
        agent: "parallel-worker",
        model,
        location,
        title: "Update isolated module",
      })
      expect(runs).toEqual([{ sessionID: result.sessionID, force: true }])
    }),
  )

  it.effect("runs distinct children concurrently without serializing worker execution", () =>
    Effect.gen(function* () {
      runs.length = 0
      active = 0
      maxActive = 0
      runnerMode = "success"
      gate = yield* Deferred.make<void>()
      started = yield* Deferred.make<void>()
      const childRunner = yield* SubagentRunner.Service
      const parent = yield* SessionCreate.make(
        yield* Database.Service,
        yield* EventV2.Service,
        yield* ProjectV2.Service,
        yield* SessionStore.Service,
      )({ location, agent: AgentV2.ID.make("parallel-master"), model })
      const first = yield* childRunner
        .run({
          parentSessionID: parent.id,
          agent: AgentV2.ID.make("parallel-worker"),
          model,
          title: "First worker task",
          prompt: "Change only src/first.ts",
        })
        .pipe(Effect.forkChild)
      const second = yield* childRunner
        .run({
          parentSessionID: parent.id,
          agent: AgentV2.ID.make("parallel-worker"),
          model,
          title: "Second worker task",
          prompt: "Change only src/second.ts",
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(started)
      expect(maxActive).toBe(2)
      yield* Deferred.succeed(gate, undefined)
      const result = yield* Effect.all([Fiber.join(first), Fiber.join(second)])

      expect(result[0].sessionID).not.toBe(result[1].sessionID)
      expect(runs).toMatchObject([
        { sessionID: result[0].sessionID, force: true },
        { sessionID: result[1].sessionID, force: true },
      ])
      gate = undefined
      started = undefined
    }),
  )

  it.effect("rejects a missing or different-location parent before worker execution", () =>
    Effect.gen(function* () {
      runs.length = 0
      runnerMode = "success"
      const childRunner = yield* SubagentRunner.Service
      const missing = yield* childRunner
        .run({
          parentSessionID: SessionV2.ID.make("ses_missing_parent"),
          agent: AgentV2.ID.make("parallel-worker"),
          model,
          title: "Missing parent task",
          prompt: "Change nothing",
        })
        .pipe(Effect.flip)
      const parent = yield* SessionCreate.make(
        yield* Database.Service,
        yield* EventV2.Service,
        yield* ProjectV2.Service,
        yield* SessionStore.Service,
      )({ location: Location.Ref.make({ directory: AbsolutePath.make("/other") }), model })
      const mismatch = yield* childRunner
        .run({
          parentSessionID: parent.id,
          agent: AgentV2.ID.make("parallel-worker"),
          model,
          title: "Wrong location task",
          prompt: "Change nothing",
        })
        .pipe(Effect.flip)

      expect(missing.message).toContain("Parent session not found")
      expect(mismatch.message).toContain("not available in this location")
      expect(runs).toEqual([])
    }),
  )

  it.effect("surfaces provider and assistant completion failures", () =>
    Effect.gen(function* () {
      runs.length = 0
      const childRunner = yield* SubagentRunner.Service
      const parent = yield* SessionCreate.make(
        yield* Database.Service,
        yield* EventV2.Service,
        yield* ProjectV2.Service,
        yield* SessionStore.Service,
      )({ location, model })
      const input = {
        parentSessionID: parent.id,
        agent: AgentV2.ID.make("parallel-worker"),
        model,
        title: "Failure task",
        prompt: "Change nothing",
      }
      runnerMode = "failure"
      expect((yield* childRunner.run(input).pipe(Effect.flip)).message).toContain("No model is available")
      runnerMode = "assistant-error"
      expect((yield* childRunner.run(input).pipe(Effect.flip)).message).toContain("Provider failed")
      runnerMode = "empty"
      expect((yield* childRunner.run(input).pipe(Effect.flip)).message).toContain("did not return text")
      runnerMode = "success"
    }),
  )
})
