/**
 * Frozen builtin manifest for the context-pack browser.
 *
 * M1 registers this in the builtin registry — this file registers nothing.
 */

export const CtxPackBrowserManifest = {
  id: "builtin:ctxpack-browser",
  version: 1,
  label: "Context Packs",
  description: "Search, inspect, and attach reusable workspace text context.",
  icon: "package",
  kind: "builtin",
  constraints: { initialAspect: "free", minW: 5, minH: 4, maxW: null, maxH: null },
  lifecycle: { clientWhenHidden: "suspend", hostWhenNoViewers: "idle", idleTimeoutMs: 30_000 },
  concurrency: { policy: "parallel", maximumActive: 4, maximumQueued: 16 },
  rights: {
    mount: ["read"],
    operations: {
      "ctxpack.read": ["read"],
      "ctxpack.create": ["write"],
      "ctxpack.patch": ["write"],
      "ctxpack.remove": ["write"],
      "ctxpack.materialize": ["read"],
    },
  },
  context: { accepts: [], produces: ["ctxpack.reference", "context.capsule"] },
} as const
