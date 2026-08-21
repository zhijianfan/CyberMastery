import { afterEach, describe, expect, mock, test } from "bun:test"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")
mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))

type DropTargetProps = {
  targetID: string
  instanceID: string
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
  test("uses one canonical target ID for registration and instance metadata", () => {
    const targetID = "v2-composer-session-123"

    PromptInputV2Composer({
      controller: {
        ctxpackTargetID: targetID,
        ctxpackInstanceID: targetID,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async () => {},
        ctxpackDropDisabled: () => false,
        model: {
          loading: false,
          paid: true,
          selection: { current: () => undefined },
        },
      } as never,
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.targetID).toBe(targetID)
    expect(registrations[0]?.instanceID).toBe(targetID)
  })
})
