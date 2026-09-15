import type { PromptInputV2Suggestion } from "@opencode-ai/session-ui/v2/prompt-input"
import type { ReferenceInfo } from "@opencode-ai/sdk/v2/client"
import { createEffect, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

type SkillCandidate = { name: string; description?: string; contentHash: string }

export function contextMentionCandidates(input: {
  references: readonly ReferenceInfo[]
  agents: readonly { name: string; mode: string; hidden?: boolean }[]
  resources: readonly { name: string; server: string; uri: string; description?: string; mimeType?: string }[]
  recent: readonly string[]
  skills: readonly SkillCandidate[]
}): PromptInputV2Suggestion[] {
  return [
    ...input.references
      .filter((reference) => !reference.hidden)
      .map(
        (reference): PromptInputV2Suggestion => ({
          id: `reference:${reference.name}`,
          kind: "reference",
          label: `@${reference.name}`,
          path: reference.path,
          description:
            reference.description ??
            (reference.source.type === "git" ? reference.source.repository : reference.source.path),
          mention: {
            type: "file",
            path: reference.path,
            content: `@${reference.name}`,
            start: 0,
            end: 0,
            mime: "application/x-directory",
            filename: reference.name,
          },
        }),
      ),
    ...input.agents
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map(
        (agent): PromptInputV2Suggestion => ({
          id: `agent:${agent.name}`,
          kind: "agent",
          label: `@${agent.name}`,
          mention: { type: "agent", name: agent.name, content: `@${agent.name}`, start: 0, end: 0 },
        }),
      ),
    ...input.resources.map(
      (resource): PromptInputV2Suggestion => ({
        id: `resource:${resource.server}:${resource.uri}`,
        kind: "resource",
        label: `@${resource.name}`,
        path: resource.uri,
        description: resource.description,
        mention: {
          type: "file",
          path: resource.uri,
          content: `@${resource.name}`,
          start: 0,
          end: 0,
          mime: resource.mimeType ?? "text/plain",
          filename: resource.name,
          url: resource.uri,
          source: {
            type: "resource",
            text: { value: `@${resource.name}`, start: 0, end: resource.name.length + 1 },
            clientName: resource.server,
            uri: resource.uri,
          },
        },
      }),
    ),
    ...skillMentionCandidates(input.skills),
    ...input.recent.map(
      (path): PromptInputV2Suggestion => ({
        id: `file:${path}`,
        kind: "file",
        label: path,
        path,
        recent: true,
        mention: { type: "file", path, content: `@${path}`, start: 0, end: 0 },
      }),
    ),
  ]
}

export function skillMentionCandidates(skills: readonly SkillCandidate[]): PromptInputV2Suggestion[] {
  return skills.map((skill) => ({
    id: `skill:${skill.name}`,
    kind: "skill",
    label: `@${skill.name}`,
    description: skill.description,
    mention: {
      type: "skill",
      name: skill.name,
      contentHash: skill.contentHash,
      content: `@${skill.name}`,
      start: 0,
      end: 0,
    },
  }))
}

export function createSkillMentionCatalog(input: {
  identity: Accessor<unknown>
  open: Accessor<boolean>
  load: (signal: AbortSignal) => Promise<readonly SkillCandidate[]>
}) {
  const [state, setState] = createStore<{ items: SkillCandidate[]; loading: boolean; error: boolean }>({
    items: [],
    loading: false,
    error: false,
  })
  createEffect(
    on([input.identity, input.open], ([, open]) => {
      setState({ items: [], loading: open, error: false })
      if (!open) return
      const abort = new AbortController()
      onCleanup(() => abort.abort())
      void input.load(abort.signal).then(
        (items) => {
          if (!abort.signal.aborted) setState({ items: [...items], loading: false })
        },
        () => {
          if (!abort.signal.aborted) setState({ items: [], loading: false, error: true })
        },
      )
    }),
  )
  return { items: () => state.items, loading: () => state.loading, error: () => state.error }
}
