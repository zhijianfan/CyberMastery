import { afterEach, describe, expect, mock, test } from "bun:test"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")
mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))

type DropTargetProps = {
  targetID: string
  instanceID: string
  functionalityID: string
  addCtxPack: (payload: unknown) => Promise<void>
  disabled: () => boolean
}

const registrations: DropTargetProps[] = []
const CapturingDropTarget = (props: DropTargetProps) => {
  registrations.push(props)
  return document.createElement("div")
}

mock.module("@/context/ctxpack/drop-target", () => ({
  CtxPackDropTarget: CapturingDropTarget,
  useMessageContextTargetRegistry: () => ({ markFocused() {} }),
}))
mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ show() {} }) }))
mock.module("@/context/command", () => ({
  useCommand: () => ({
    keybind: () => "",
    keybindParts: () => [],
  }),
}))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  if (tag === CapturingDropTarget) return CapturingDropTarget(next as DropTargetProps)
  return document.createElement("div")
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const { PromptInputV2Composer } = await import("./prompt-input-v2")

afterEach(() => registrations.splice(0))

describe("PromptInputV2Composer CtxPack identity wiring", () => {
  test("uses the controller's canonical target for registration and materialization", async () => {
    const calls: unknown[] = []
    const target = {
      instanceID: "chat-instance:session-123",
      functionalityID: "builtin:chat",
    }

    PromptInputV2Composer({
      controller: {
        ctxpackContextTarget: () => target,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async (payload: unknown) => {
          calls.push(payload)
        },
        ctxpackDropDisabled: () => false,
        model: {
          loading: false,
          paid: true,
          selection: { current: () => undefined },
        },
      } as never,
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.targetID).toBe(target.instanceID)
    expect(registrations[0]?.instanceID).toBe(target.instanceID)
    expect(registrations[0]?.functionalityID).toBe(target.functionalityID)
    await registrations[0]?.addCtxPack({ ctxPackID: "pack-1" })
    expect(calls).toEqual([{ ctxPackID: "pack-1" }])
  })

  test("disables a composer without a Session target", async () => {
    const calls: unknown[] = []

    PromptInputV2Composer({
      controller: {
        ctxpackContextTarget: () => undefined,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async (payload: unknown) => {
          calls.push(payload)
        },
        ctxpackDropDisabled: () => true,
        model: {
          loading: false,
          paid: true,
          selection: { current: () => undefined },
        },
      } as never,
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.disabled()).toBe(true)
    expect(registrations[0]?.targetID).toBe("")
    expect(registrations[0]?.instanceID).toBe("")
    expect(registrations[0]?.functionalityID).toBe("")
    expect(calls).toHaveLength(0)
  })
})
