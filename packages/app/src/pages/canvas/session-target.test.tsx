import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { normalizeTarget, targetKey, useSessionTarget, type SessionSurfaceTarget } from "./session-target"
import {
  createScopedKeyHandler,
  createSessionScope,
  createSurfaceID,
  focusSurfaceComposer,
  scopedSurfaceId,
  surfaceFileTreePanelID,
  surfacePortalID,
  surfacePortalMount,
  surfaceReviewPanelID,
  surfaceTerminalMountID,
  useSessionScope,
} from "./session-scope"

afterEach(() => {
  document.body.innerHTML = ""
})

function host() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return element
}

test("targetKey distinguishes sessions and contexts", () => {
  expect(targetKey({ sessionID: "ses-a" })).not.toBe(targetKey({ sessionID: "ses-b" }))
  expect(targetKey({ sessionID: "ses-a", directory: "C:\\proj" })).not.toBe(targetKey({ sessionID: "ses-a" }))
  expect(targetKey({ sessionID: "ses-a", directory: "C:\\proj" })).toBe(
    targetKey({ sessionID: "ses-a", directory: "C:\\proj" }),
  )
  expect(targetKey(normalizeTarget({ sessionID: "ses-a", directory: "" }))).toBe(targetKey({ sessionID: "ses-a" }))
  expect(targetKey({ sessionID: "ses-a", workspaceID: "wrk-1" })).toBe(targetKey({ sessionID: "ses-a", workspaceID: "wrk-1" }))
})

test("normalizeTarget canonicalizes without mutating input", () => {
  const input: SessionSurfaceTarget = {
    sessionID: "ses-a",
    directory: "",
    workspaceID: "  ",
    contextTarget: {
      instanceID: "instance-1",
      functionalityID: "builtin:operating-chat-session",
    },
  }
  const normalized = normalizeTarget(input)
  expect(normalized.sessionID).toBe("ses-a")
  expect(normalized.directory).toBeUndefined()
  expect(normalized.workspaceID).toBeUndefined()
  expect(normalized.contextTarget).toEqual({
    instanceID: "instance-1",
    functionalityID: "builtin:operating-chat-session",
  })
  expect(input.directory).toBe("")
  expect(input.workspaceID).toBe("  ")
})

test("context target does not fork session surface identity", () => {
  expect(
    targetKey({
      sessionID: "ses-a",
      contextTarget: { instanceID: "instance-1", functionalityID: "builtin:operating-chat-session" },
    }),
  ).toBe(targetKey({ sessionID: "ses-a" }))
})

test("targets are plain data and need no route state", () => {
  const target = normalizeTarget({ sessionID: "ses-a", directory: "/work/proj", workspaceID: "wrk-1" })
  expect(targetKey(target)).toBe("ses-a|/work/proj|wrk-1")
})

test("createSurfaceID generates unique surface instance ids", () => {
  const ids = new Set(Array.from({ length: 300 }, () => createSurfaceID()))
  expect(ids.size).toBe(300)
  for (const id of ids) expect(id.startsWith("surface-")).toBe(true)
})

test("scoped ids are unique per surface and stable per part", () => {
  expect(scopedSurfaceId("block-a", "messages")).toBe("canvas-session-block-a-messages")
  expect(scopedSurfaceId("block-a", "messages")).not.toBe(scopedSurfaceId("block-b", "messages"))
  const scope = createSessionScope(() => "block-a", () => false)
  expect(scope.id("messages")).toBe(scopedSurfaceId("block-a", "messages"))
  expect(scope.id("messages")).toBe(scope.id("messages"))
})

test("scope ids stay stable across rerenders and remounts", () => {
  const first = createSessionScope(() => "block-a", () => false)
  const before = [first.id("terminal"), first.id("review"), first.id("files")]
  const second = createSessionScope(() => "block-a", () => true)
  expect(second.id("terminal")).toBe(before[0])
  expect(second.id("review")).toBe(before[1])
  expect(second.id("files")).toBe(before[2])
  expect(first.id("terminal")).toBe(before[0])
})

test("terminal, review, file tree, and portal helpers use the scope id scheme", () => {
  const scope = createSessionScope(() => "block-a", () => false)
  expect(surfaceTerminalMountID(scope)).toBe(scope.id("terminal"))
  expect(surfaceReviewPanelID(scope)).toBe(scope.id("review"))
  expect(surfaceFileTreePanelID(scope)).toBe(scope.id("files"))
  expect(surfacePortalID(scope, "titlebar-center")).toBe(scope.id("portal-titlebar-center"))
  const mount = host()
  mount.id = surfacePortalID(scope, "titlebar-center")
  expect(surfacePortalMount(scope, "titlebar-center")).toBe(mount)
  expect(surfacePortalMount(scope, "missing")).toBeNull()
})

test("keyboard ownership follows the focused surface through focus handover", () => {
  let aFocused = false
  let bFocused = false
  const a = createSessionScope(() => "block-a", () => aFocused)
  const b = createSessionScope(() => "block-b", () => bFocused)
  const rootA = host()
  const rootB = host()
  a.setRoot(rootA)
  b.setRoot(rootB)
  const childA = document.createElement("span")
  const childB = document.createElement("span")
  rootA.appendChild(childA)
  rootB.appendChild(childB)

  aFocused = true
  const fired: string[] = []
  const stopA = createScopedKeyHandler(a, () => fired.push("a"))
  const stopB = createScopedKeyHandler(b, () => fired.push("b"))

  childA.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(fired).toEqual(["a"])

  aFocused = false
  bFocused = true
  childB.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(fired).toEqual(["a", "b"])

  childA.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(fired).toEqual(["a", "b"])

  stopA()
  stopB()
  childB.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(fired).toEqual(["a", "b"])
})

test("keyboardOwned accepts events inside the root and rejects outsiders", () => {
  let focused = true
  const scope = createSessionScope(() => "block-a", () => focused)
  const root = host()
  const inside = document.createElement("span")
  root.appendChild(inside)
  scope.setRoot(root)
  const outsider = document.createElement("span")
  document.body.appendChild(outsider)

  let ownedFromOutsider = true
  outsider.addEventListener(
    "keydown",
    (event) => {
      ownedFromOutsider = scope.keyboardOwned(event as KeyboardEvent)
    },
    { once: true },
  )
  outsider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(ownedFromOutsider).toBe(false)

  let ownedFromInside = false
  inside.addEventListener(
    "keydown",
    (event) => {
      ownedFromInside = scope.keyboardOwned(event as KeyboardEvent)
    },
    { once: true },
  )
  inside.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(ownedFromInside).toBe(true)

  focused = false
  let ownedWhileUnfocused = true
  inside.addEventListener(
    "keydown",
    (event) => {
      ownedWhileUnfocused = scope.keyboardOwned(event as KeyboardEvent)
    },
    { once: true },
  )
  inside.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }))
  expect(ownedWhileUnfocused).toBe(false)
})

test("focusSurfaceComposer focuses only the registered scoped composer", () => {
  const scope = createSessionScope(() => "block-a", () => false)
  expect(focusSurfaceComposer(scope)).toBe(false)
  const composer = document.createElement("textarea")
  document.body.appendChild(composer)
  scope.setComposer(composer)
  expect(focusSurfaceComposer(scope)).toBe(true)
  expect(document.activeElement).toBe(composer)
})

test("context hooks throw outside their providers", () => {
  createRoot(() => {
    expect(() => useSessionScope()).toThrow("useSessionScope must be used within a SessionScopeProvider")
    expect(() => useSessionTarget()).toThrow("useSessionTarget must be used within a SessionTargetProvider")
  })
})
