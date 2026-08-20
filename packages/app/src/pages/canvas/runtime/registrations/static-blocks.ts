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
  text: string
}

export interface VoiceView {
  listening: boolean
}

export type NotesCommand = { type: "set-text"; text: string }

export type VoiceCommand = { type: "toggle" }

type NotesResolved = NotesBlockDescriptor & { text?: string }

type VoiceResolved = VoiceBlockDescriptor & { listening?: boolean }

const staticRegistration = (functionalityID: string, mode: "native" | "static" = "static") =>
  ({
    functionalityID,
    mode,
    resolve: async ({ block }) => block,
    select: () => undefined,
  }) satisfies BlockRuntimeRegistration<unknown, undefined, never>

export const notesRuntimeRegistration: BlockRuntimeRegistration<NotesResolved, NotesView, NotesCommand> = {
  functionalityID: "builtin:notes",
  mode: "local",
  resolve: async ({ block, services }) => {
    const state = services.localView.read<{ text?: string }>(block.id)
    return { id: block.id, functionalityID: "builtin:notes", text: state?.text }
  },
  select: ({ resolved }) => ({ text: resolved.text ?? "" }),
  dispatch: async ({ resolved, command, services }) => {
    if (command.type === "set-text") {
      services.localView.write(resolved.id, { text: command.text })
    }
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
