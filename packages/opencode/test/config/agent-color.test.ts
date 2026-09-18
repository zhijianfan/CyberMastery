import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"
import { buildLocationServiceMap, LocationServiceMap } from "@opencode-ai/core/location-services"
import { sessionContextReplacements } from "@/effect/session-context"

const testLocationServiceMap = buildLocationServiceMap(sessionContextReplacements)

const it = testEffect(LayerNode.compile(LayerNode.group([Config.node, AgentSvc.node]), [[LocationServiceMap.node, testLocationServiceMap]]))

it.instance(
  "agent color parsed from project config",
  () =>
    Effect.gen(function* () {
      const cfg = yield* Config.use.get()
      expect(cfg.agent?.["build"]?.color).toBe("#FFA500")
      expect(cfg.agent?.["plan"]?.color).toBe("primary")
    }),
  {
    git: true,
    config: {
      agent: {
        build: { color: "#FFA500" },
        plan: { color: "primary" },
      },
    },
  },
)

it.instance(
  "Agent.get includes color from config",
  () =>
    Effect.gen(function* () {
      const plan = yield* AgentSvc.use.get("plan")
      expect(plan?.color).toBe("#A855F7")
      const build = yield* AgentSvc.use.get("build")
      expect(build?.color).toBe("accent")
    }),
  {
    git: true,
    config: {
      agent: {
        plan: { color: "#A855F7" },
        build: { color: "accent" },
      },
    },
  },
)
