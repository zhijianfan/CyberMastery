import { describe, expect, test } from "bun:test"
import { createComponent, createRoot } from "solid-js"
import { createCtxPackComposerIdentity } from "./composer-id"

describe("CtxPack composer identity", () => {
  test("mounted V1 and V2 identity owners allocate stable distinct unsaved fallbacks", () => {
    const identities: Record<string, Array<ReturnType<typeof createCtxPackComposerIdentity>>> = {
      "v1-composer": [],
      "v2-composer": [],
    }
    const IdentityOwner = (props: { prefix: string }) => {
      identities[props.prefix].push(createCtxPackComposerIdentity(props.prefix))
      return null
    }

    createRoot((dispose) => {
      createComponent(IdentityOwner, { prefix: "v1-composer" })
      createComponent(IdentityOwner, { prefix: "v1-composer" })
      createComponent(IdentityOwner, { prefix: "v2-composer" })
      createComponent(IdentityOwner, { prefix: "v2-composer" })

      Object.values(identities).forEach(([first, second]) => {
        const firstUnsaved = first(undefined)
        const secondUnsaved = second(undefined)

        expect(firstUnsaved).not.toBe(secondUnsaved)
        expect(first(undefined)).toBe(firstUnsaved)
        expect(second(undefined)).toBe(secondUnsaved)
      })
      dispose()
    })
  })

  test("session IDs override unsaved fallback deterministically", () => {
    const identity = createCtxPackComposerIdentity("v2-composer")

    expect(identity(undefined)).toContain("v2-composer-composer-")
    expect(identity("session-123")).toBe("v2-composer-session-123")
    expect(identity("session-123")).toBe(identity("session-123"))
    expect(identity(undefined)).not.toBe(identity("session-123"))
  })
})
