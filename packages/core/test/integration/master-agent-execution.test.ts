import { expect, test } from "bun:test"
import path from "path"
import { LLMClient, LLMEvent, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServices } from "@opencode-ai/core/location-services"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { MessageTable, SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceService } from "@opencode-ai/core/workspace"
import { MasterAgentService } from "@opencode-ai/core/workspace/master-agent"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { Workspace } from "@opencode-ai/schema/workspace"
import { asc, eq } from "drizzle-orm"
import { Deferred, Effect, Layer, LayerMap, Stream } from "effect"
import { tmpdir } from "../fixture/tmpdir"
import { managedNotReadySessionContext } from "../fixture/session-context"

test("MasterAgent prompt streams through local V2 execution and persists only V2 history", async () => {
  await using temporary = await tmpdir()
  await Bun.write(
    path.join(temporary.path, "config", "opencode.json"),
    JSON.stringify({
      snapshots: false,
      providers: {
        test: {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://model.test/v1" },
          models: { "test-model": { limit: { context: 128000, output: 4096 } } },
        },
      },
    }),
  )
  const requests: LLMRequest[] = []
  const finish = Deferred.makeUnsafe<void>()
  const client = Layer.succeed(
    LLMClient.Service,
    LLMClient.Service.of({
      prepare: () => Effect.die("Only streaming is expected"),
      generate: () => Effect.die("Only streaming is expected"),
      stream: ((request: LLMRequest) => {
        requests.push(request)
        return Stream.concat(
          Stream.fromIterable([
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "answer" }),
            LLMEvent.textDelta({ id: "answer", text: "MasterAgent is responding." }),
          ]),
          Stream.unwrap(
            Deferred.await(finish).pipe(
              Effect.as(
                Stream.fromIterable([
                  LLMEvent.textEnd({ id: "answer" }),
                  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                  LLMEvent.finish({ reason: "stop" }),
                ]),
              ),
            ),
          ),
        )
      }) as LLMClientShape["stream"],
    }),
  )
  const replacements = [
    ...managedNotReadySessionContext,
    [Database.node, Database.layerFromPath(path.join(temporary.path, "test.sqlite"))],
    [
      Global.node,
      Global.layerWith({
        home: temporary.path,
        data: path.join(temporary.path, "data"),
        cache: path.join(temporary.path, "cache"),
        config: path.join(temporary.path, "config"),
        state: path.join(temporary.path, "state"),
        tmp: path.join(temporary.path, "tmp"),
        bin: path.join(temporary.path, "bin"),
        log: path.join(temporary.path, "log"),
        repos: path.join(temporary.path, "repos"),
      }),
    ],
    [SessionExecution.node, SessionExecutionLocal.node],
    [LayerNodePlatform.llmClient, client],
  ] as const satisfies LayerNode.Replacements
  const locations = Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make((ref: Location.Ref) =>
      LayerNode.compile(locationServices, [...replacements, [Location.node, Location.boundNode(ref)]]),
    ),
  )
  const layer = AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionV2.node, WorkspaceService.node, MasterAgentService.node]),
    [...replacements, [LocationServiceMap.node, locations]],
  )
  await Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const workspace = yield* WorkspaceService.Service
    const masterAgent = yield* MasterAgentService.Service
    const sessions = yield* SessionV2.Service
    const info = yield* workspace.create({ name: "master-execution-regression" })
    yield* workspace.update(info.id, { model: "test:test-model", directories: [temporary.path] })
    const tuple = Workspace.Layout.Tuple.make({ user: "", style: "default", deviceClass: "desktop" })
    const layout = yield* workspace.layout.get(info.id, tuple, "execution-test")
    yield* workspace.layout.save(
      info.id,
      tuple,
      [{ id: "master", functionality: "builtin:master-agent", transform: { x: 0, y: 0, w: 4, h: 4, z: 0 } }],
      layout.revision,
      "execution-test",
    )
    const binding = yield* masterAgent.ensure(info.id, "master")
    const streamed = yield* Deferred.make<void>()
    const idle = yield* Deferred.make<void>()
    const live: EventV2.Payload[] = []
    yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== SessionEvent.Text.Delta.type && event.type !== SessionStatusEvent.Status.type) return
        const data = event.data as EventV2.Data<typeof SessionStatusEvent.Status | typeof SessionEvent.Text.Delta>
        if (data.sessionID !== binding.sessionID) return
        live.push(event)
        if (event.type === SessionEvent.Text.Delta.type) yield* Deferred.succeed(streamed, undefined)
        if (event.type !== SessionStatusEvent.Status.type) return
        const status = event.data as EventV2.Data<typeof SessionStatusEvent.Status>
        if (status.status.type === "idle") yield* Deferred.succeed(idle, undefined)
      }),
    )
    const admitted = yield* sessions.prompt({ sessionID: binding.sessionID, prompt: { text: "Hello, MasterAgent" } })
    yield* Deferred.await(streamed).pipe(Effect.timeout("10 seconds"))
    expect(requests).toHaveLength(1)
    expect(requests[0].model).toMatchObject({ id: "test-model" })
    expect(yield* sessions.active).toEqual(new Set([binding.sessionID]))
    expect(live.filter((event) => event.type === SessionStatusEvent.Status.type).map((event) => event.data)).toEqual([
      { sessionID: binding.sessionID, status: { type: "busy" } },
    ])
    expect(live.find((event) => event.type === SessionEvent.Text.Delta.type)?.data).toMatchObject({
      delta: "MasterAgent is responding.",
    })
    yield* Deferred.succeed(finish, undefined)
    yield* Deferred.await(idle).pipe(Effect.timeout("10 seconds"))
    expect(live.filter((event) => event.type === SessionStatusEvent.Status.type).map((event) => event.data)).toEqual([
      { sessionID: binding.sessionID, status: { type: "busy" } },
      { sessionID: binding.sessionID, status: { type: "idle" } },
    ])
    expect(yield* sessions.context(binding.sessionID)).toMatchObject([
      { type: "user", text: "Hello, MasterAgent" },
      {
        type: "assistant",
        agent: "parallel-master",
        finish: "stop",
        content: [{ type: "text", id: "answer", text: "MasterAgent is responding." }],
      },
    ])
    const row = yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, binding.sessionID)).get()
    expect(row).toMatchObject({
      runtime: "v2",
      agent: "parallel-master",
      model: { providerID: "test", id: "test-model" },
      workspace_id: info.id,
    })
    const inputs = yield* database.db
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.session_id, binding.sessionID))
      .all()
    expect(inputs).toHaveLength(1)
    expect(inputs[0].id).toBe(admitted.id)
    expect(inputs[0].promoted_seq).not.toBeNull()
    const messages = yield* database.db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, binding.sessionID))
      .orderBy(asc(SessionMessageTable.seq))
      .all()
    expect(messages.map((message) => message.type)).toEqual(["user", "assistant"])
    expect(
      yield* database.db.select().from(MessageTable).where(eq(MessageTable.session_id, binding.sessionID)).all(),
    ).toEqual([])
    const durable = yield* database.db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, binding.sessionID))
      .all()
    expect(durable.some((event) => event.type === EventV2.versionedType(SessionEvent.Text.Ended.type, 1))).toBeTrue()
    expect(durable.some((event) => event.type === EventV2.versionedType(SessionEvent.Text.Delta.type, 1))).toBeFalse()
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
}, 30000)
