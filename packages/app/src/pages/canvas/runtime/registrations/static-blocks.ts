import type { BlockRuntimeRegistration } from "../contracts"

export interface NotesBlockDescriptor {
  id: string
  functionalityID: "builtin:notes"
}

export interface VoiceBlockDescriptor {
  id: string
  functionalityID: "builtin:voice"
}

export interface NotesView {
  workspaceID: string
  workspaceEpoch: number
  blockID: string
  draft: string
  messages: NotesMessage[]
}

export interface NotesMessage {
  id: string
  text: string
  createdAt: number
}

export interface VoiceView {
  listening: boolean
}

export type NotesCommand = { type: "set-draft"; text: string } | { type: "submit"; id: string; createdAt: number }

export type VoiceCommand = { type: "toggle" }

type NotesResolved = NotesBlockDescriptor & NotesView

type NotesStoredView = {
  text?: string
  draft?: string
  messages?: NotesMessage[]
}

type VoiceResolved = VoiceBlockDescriptor & { listening?: boolean }

const staticRegistration = (functionalityID: string, mode: "native" | "static" = "static") =>
  ({
    functionalityID,
    mode,
    resolve: async ({ block }) => block,
    select: () => undefined,
  }) satisfies BlockRuntimeRegistration<unknown, undefined, never>

const notesViewKey = (workspaceID: string, blockID: string) =>
  `notes:${encodeURIComponent(workspaceID)}:${encodeURIComponent(blockID)}`

export const notesRuntimeRegistration: BlockRuntimeRegistration<NotesResolved, NotesView, NotesCommand> = {
  functionalityID: "builtin:notes",
  mode: "local",
  resolve: async ({ workspaceID, block, services }) => {
    if (!workspaceID)
      return {
        id: block.id,
        functionalityID: "builtin:notes",
        workspaceID,
        workspaceEpoch: services.workspace.epoch(),
        blockID: block.id,
        draft: "",
        messages: [],
      }

    const key = notesViewKey(workspaceID, block.id)
    const scoped = services.localView.read<NotesStoredView>(key)
    const legacy = scoped === undefined ? services.localView.read<NotesStoredView>(block.id) : undefined
    const state = scoped ?? legacy

    if (legacy !== undefined) {
      services.localView.write(key, {
        draft: legacy.draft ?? legacy.text ?? "",
        messages: legacy.messages ?? [],
      })
      services.localView.delete(block.id)
      services.localView.flush?.()
    }

    return {
      id: block.id,
      functionalityID: "builtin:notes",
      workspaceID,
      workspaceEpoch: services.workspace.epoch(),
      blockID: block.id,
      draft: state?.draft ?? state?.text ?? "",
      messages: state?.messages ?? [],
    }
  },
  select: ({ resolved }) => ({
    workspaceID: resolved.workspaceID,
    workspaceEpoch: resolved.workspaceEpoch,
    blockID: resolved.blockID,
    draft: resolved.draft,
    messages: resolved.messages,
  }),
  dispatch: async ({ resolved, command, services }) => {
    if (!resolved.workspaceID) throw new Error("Cannot update notes without a workspace")
    const key = notesViewKey(resolved.workspaceID, resolved.blockID)
    const previous = services.localView.read<NotesStoredView>(key)
    const state = previous ?? services.localView.read<NotesStoredView>(resolved.blockID)
    const messages = state?.messages ?? resolved.messages

    if (command.type === "set-draft") {
      services.localView.write(key, { draft: command.text, messages })
      return
    }
    if (messages.some((message) => message.id === command.id)) return
    const text = (state?.draft ?? resolved.draft).trim()
    if (!text) return
    services.localView.write(key, {
      draft: "",
      messages: [...messages, { id: command.id, text, createdAt: command.createdAt }],
    })
    if (services.localView.flush?.() !== false) return

    services.localView.delete(key)
    if (previous !== undefined) services.localView.write(key, previous)
    throw new Error("Failed to persist note")
  },
}

export const voiceRuntimeRegistration: BlockRuntimeRegistration<VoiceResolved, VoiceView, VoiceCommand> = {
  functionalityID: "builtin:voice",
  mode: "local",
  resolve: async ({ block, services }) => {
    const state = services.localView.read<{ listening?: boolean }>(block.id)
    return { id: block.id, functionalityID: "builtin:voice", listening: state?.listening }
  },
  select: ({ resolved }) => ({ listening: resolved.listening ?? false }),
  dispatch: async ({ resolved, command, services }) => {
    if (command.type === "toggle") {
      const current = services.localView.read<{ listening?: boolean }>(resolved.id)?.listening ?? false
      services.localView.write(resolved.id, { listening: !current })
    }
  },
}

export const builtinStaticRegistrations: Record<string, BlockRuntimeRegistration<unknown, unknown, unknown>> = {
  "builtin:chat": staticRegistration("builtin:chat", "native"),
  "builtin:context": staticRegistration("builtin:context"),
  "builtin:tools": staticRegistration("builtin:tools"),
  "builtin:files": staticRegistration("builtin:files"),
  "builtin:notes": notesRuntimeRegistration,
  "builtin:voice": voiceRuntimeRegistration,
}
