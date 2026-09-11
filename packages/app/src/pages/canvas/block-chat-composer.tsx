import {
  PromptInputV2Composer,
  usePromptInputV2Controller,
  type PromptInputV2ControllerProps,
} from "@/components/prompt-input-v2"
import { createPromptInputHistory } from "@/components/prompt-input/history-store"
import { useLanguage } from "@/context/language"
import { useContextAttachmentStore } from "@/context/ctxpack/attachment-store"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { mergeProps, Show } from "solid-js"
import { createStore } from "solid-js/store"

export type BlockChatComposerProps = Omit<
  PromptInputV2ControllerProps,
  "workspaceModels" | "history" | "chatOnly" | "placeholder"
> & {
  role: "operating" | "master" | "relay"
  class?: string
}

export function BlockChatComposer(props: BlockChatComposerProps) {
  const language = useLanguage()
  const prompt = props.state ?? usePrompt()
  const attachments = useContextAttachmentStore()
  const sync = useSync()
  const [state, setState] = createStore({ preparing: false })
  const hasPlan = () =>
    attachments.attachments().some((item) => item.status === "ready" && item.tags?.includes("ParallelPlan"))
  const disabled = () =>
    state.preparing || attachments.pendingCount() > 0 || sync().data.session_working(props.controls.session.id ?? "")
  const controller = usePromptInputV2Controller(
    mergeProps(props, {
      chatOnly: true,
      history: createPromptInputHistory(),
      beforeSubmit: async () => {
        setState("preparing", true)
        try {
          await props.beforeSubmit?.()
        } finally {
          setState("preparing", false)
        }
      },
      get workspaceModels() {
        return props.role !== "relay"
      },
      get placeholder() {
        return language.t(`canvas.chat.${props.role}.placeholder`)
      },
    }),
  )

  const execute = () => {
    if (props.role !== "master" || !hasPlan() || disabled()) return
    const prefix = `${language.t("canvas.chat.master.executePrompt")}\n\n`
    const current = prompt.current()
    if (current[0]?.type !== "text" || !current[0].content.startsWith(prefix)) {
      prompt.set(
        [
          { type: "text", content: prefix, start: 0, end: prefix.length },
          ...current.map((part) =>
            part.type === "image"
              ? part
              : { ...part, start: part.start + prefix.length, end: part.end + prefix.length },
          ),
        ],
        (prompt.cursor() ?? 0) + prefix.length,
      )
    }
    controller.submit()
  }

  return (
    <div data-component="block-chat-composer" data-role={props.role} class={props.class}>
      <Show when={props.role === "master" && hasPlan()}>
        <div class="block-chat-plan-action">
          <span>{language.t("canvas.chat.master.planAttached")}</span>
          <button type="button" data-action="execute-plan" disabled={disabled()} onClick={execute}>
            {language.t("canvas.chat.master.execute")}
          </button>
        </div>
      </Show>
      <PromptInputV2Composer controller={controller} />
    </div>
  )
}
