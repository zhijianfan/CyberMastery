import { expect, test } from "bun:test"

import {
  BlockRuntimeRegistration,
  BlockRuntimeServices,
  CanvasBlockDescriptor,
  RuntimeBlockHandle,
  RuntimeProjectionPatch,
  RuntimeStatus,
} from "./contracts"

type NativeChatCommand = { type: "session.prompt"; text: string; delivery: "steer" | "queue" }
type NotesCommand = { type: "notes.save"; content: string }
type FutureResourceCommand = { type: "resource.refresh"; revision: number }

const _nativeSessionBackedRegistration: BlockRuntimeRegistration<{ sessionID: string }, { model: "native" }, NativeChatCommand> = {
  functionalityID: "builtin:chat-relay",
  mode: "native",
  resolve: async ({ workspaceID, block }) => ({
    sessionID: `${workspaceID}:${block.id}`,
  }),
  select: ({ resolved }) => ({
    model: "native",
  }),
  dispatch: async ({ command }) => {
    command.type
  },
}

const _notesLocalRegistration: BlockRuntimeRegistration<{ noteDraft: string }, { noteCount: number }, NotesCommand> = {
  functionalityID: "builtin:notes",
  mode: "local",
  resolve: async () => ({
    noteDraft: "",
  }),
  select: ({ projection }) => ({
    noteCount: 0,
  }),
  dispatch: async ({ command }) => {
    command.type
  },
}

const _futureResourceProjectedRegistration: BlockRuntimeRegistration<
  { revision: number },
  { isReady: boolean },
  FutureResourceCommand
> = {
  functionalityID: "builtin:future-resource",
  mode: "projected",
  resolve: async () => ({ revision: 0 }),
  select: ({ projection }) => ({
    isReady: false,
  }),
  dispatch: async ({ command }) => {
    command.revision
  },
}

const _nativeHandle: RuntimeBlockHandle<unknown, NativeChatCommand> = {
  status: () => "ready",
  view: () => undefined,
  error: () => undefined,
  refresh: async () => {},
  dispatch: async (command) => {
    command.text
  },
  dispose: () => {},
}

const _notesHandle: RuntimeBlockHandle<unknown, NotesCommand> = {
  status: () => "ready",
  view: () => undefined,
  error: () => undefined,
  refresh: async () => {},
  dispatch: async (command) => {
    command.content
  },
  dispose: () => {},
}

void _nativeHandle.dispatch({ type: "session.prompt", text: "hello", delivery: "steer" })
void _notesHandle.dispatch({ type: "notes.save", content: "write" })

// @ts-expect-error
void _nativeHandle.dispatch({ type: "notes.save", content: "wrong" })
// @ts-expect-error
void _notesHandle.dispatch({ type: "session.prompt", text: "wrong", delivery: "queue" })

const _replacePatch: RuntimeProjectionPatch = { op: "replace", value: { value: "payload" }, revision: 3 }
const _mergePatch: RuntimeProjectionPatch = { op: "merge", value: { nested: true }, revision: 4 }
const _appendPatch: RuntimeProjectionPatch = { op: "append", path: ["items", "0"], value: 1 }
const _removePatch: RuntimeProjectionPatch = { op: "remove" }

// @ts-expect-error
const _invalidMergePatch: RuntimeProjectionPatch = { op: "merge", value: "bad value" }
// @ts-expect-error
const _invalidAppendPatch: RuntimeProjectionPatch = { op: "append", value: [1, 2, 3] }
// @ts-expect-error
const _invalidPatchWithPath: RuntimeProjectionPatch = { op: "replace", value: 123, path: ["a"] }

const _badBlockDescriptorIncludesSessionID: CanvasBlockDescriptor = {
  id: "block-1",
  functionalityID: "builtin:notes",
  transform: { x: 1, y: 2, w: 3, h: 4, z: 0 },
  // This field must not exist on CanvasBlockDescriptor.
  // @ts-expect-error
  sessionID: "session-1",
}

test("runtime contracts compile-time guards and runtime smoke", async () => {
  const status: RuntimeStatus = "ready"
  expect(status).toBe("ready")

  const workspace: BlockRuntimeServices["workspace"] = {
    id: () => undefined,
    epoch: () => 0,
    connected: () => false,
    awaitDescriptorPersisted: async () => {},
  }
  const services: Pick<BlockRuntimeServices, "workspace"> = {
    workspace,
  }

  expect(typeof services.workspace.id()).toBe("undefined")

  void workspace.awaitDescriptorPersisted("block-1", new AbortController().signal)
})
