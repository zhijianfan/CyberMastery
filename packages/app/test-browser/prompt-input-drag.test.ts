import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptInputV2Attachments } from "../../session-ui/src/v2/components/prompt-input/attachments"

test("clears sibling drag indicators when a composer consumes the drop or a drag is cancelled", async () => {
  const source = document.createElement("div")
  document.body.append(source)
  const dispose: VoidFunction[] = []
  const dragging: (string | null)[] = [null, null]
  const additions: unknown[] = []
  const dataTransfer = new DataTransfer()
  dataTransfer.setData("text/plain", "Context pack")
  const event = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
    return event
  }
  try {
    dragging.forEach((_, index) =>
      createRoot((stop) => {
        dispose.push(stop)
        createPromptInputV2Attachments({
          capture: () => ({ current: () => [], cursor: () => 0, set: (value) => additions.push(value) }),
          editor: () => source,
          focusEditor: () => {},
          addPart: () => false,
          directory: () => "/repo",
          isDialogActive: () => false,
          warn: () => {},
          duplicate: () => {},
          onError: (error) => {
            throw error
          },
          setDraggingType: (value) => {
            dragging[index] = value
          },
        })
      }),
    )
    await Promise.resolve()
    source.dispatchEvent(event("dragover"))
    expect(dragging).toEqual(["@mention", "@mention"])
    source.addEventListener("drop", (event) => event.stopPropagation())
    source.dispatchEvent(event("drop"))
    expect(dragging).toEqual([null, null])
    expect(additions).toEqual([])
    source.dispatchEvent(event("dragover"))
    source.dispatchEvent(event("dragend"))
    expect(dragging).toEqual([null, null])
  } finally {
    dispose.forEach((stop) => stop())
    source.remove()
  }
})
