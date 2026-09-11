import { afterEach, describe, expect, mock, test } from "bun:test"

const clientSolid = import.meta.resolve("solid-js").replace("dist/server.js", "dist/solid.js")
const clientWeb = import.meta.resolve("solid-js/web").replace("dist/server.js", "dist/web.js")
mock.module("solid-js", () => require(clientSolid))
mock.module("solid-js/web", () => require(clientWeb))

type DropTargetProps = {
  targetID: string
  instanceID: string
  functionalityID: string
  disabled: () => boolean
}

const registrations: DropTargetProps[] = []
const composers: Array<Record<string, unknown>> = []
const CapturingComposer = (props: Record<string, unknown>) => {
  composers.push(props)
  return document.createElement("div")
}
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
mock.module("@opencode-ai/session-ui/v2/prompt-input", () => ({ PromptInputV2: CapturingComposer }))

function createElement(tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  const next = { ...(props ?? {}) }
  if (children.length > 0) next.children = children.length > 1 ? children : children[0]
  if (tag === CapturingDropTarget) return CapturingDropTarget(next as DropTargetProps)
  if (tag === CapturingComposer) return CapturingComposer(next)
  return document.createElement("div")
}
const Fragment = (props: { children?: unknown }) => props.children
;(globalThis as unknown as { React: unknown }).React = { createElement, Fragment }

const { PromptInputV2Composer } = await import("./prompt-input-v2")

afterEach(() => {
  registrations.splice(0)
  composers.splice(0)
})

describe("PromptInputV2Composer CtxPack identity wiring", () => {
  test("chat-only composers keep model selection but hide variant and coding menus", () => {
    PromptInputV2Composer({
      controller: {
        chatOnly: true,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async () => {},
        ctxpackDropDisabled: () => false,
        model: { loading: false, paid: true, selection: { current: () => undefined } },
      } as never,
    })

    expect(composers.at(-1)?.chatOnly).toBe(true)
    expect(composers.at(-1)?.variantControlVisible).toBe(false)
    expect(Boolean(composers.at(-1)?.modelControl)).toBe(true)
  })

  test.each([false, true])("workspace model controls are hidden only when opted in: %s", (workspaceModels) => {
    PromptInputV2Composer({
      controller: {
        workspaceModels,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async () => {},
        ctxpackDropDisabled: () => false,
        model: { loading: false, paid: true, selection: { current: () => undefined } },
      } as never,
    })

    expect(composers.at(-1)?.variantControlVisible).toBe(!workspaceModels)
    expect(Boolean(composers.at(-1)?.modelControl)).toBe(!workspaceModels)
  })

  test("uses one canonical target for registration and instance metadata", () => {
    PromptInputV2Composer({
      controller: {
        ctxpackTarget: {
          instanceID: "instance-1",
          functionalityID: "builtin:operating-chat-session",
        },
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
    expect(registrations[0]?.targetID).toBe("instance-1")
    expect(registrations[0]?.instanceID).toBe("instance-1")
    expect(registrations[0]?.functionalityID).toBe("builtin:operating-chat-session")
  })

  test("registers a disabled empty target instead of an ephemeral identity", () => {
    PromptInputV2Composer({
      controller: {
        ctxpackTarget: undefined,
        ctxpackWorkspaceID: "workspace-1",
        ctxpackAddCtxPack: async () => {},
        ctxpackDropDisabled: () => true,
        model: {
          loading: false,
          paid: true,
          selection: { current: () => undefined },
        },
      } as never,
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.targetID).toBe("")
    expect(registrations[0]?.instanceID).toBe("")
    expect(registrations[0]?.functionalityID).toBe("")
    expect(registrations[0]?.disabled()).toBe(true)
  })
})
