import { skillMentionCandidates, createSkillMentionCatalog } from "@/components/prompt-input/mention-candidates"
import { CtxPackAttachmentPreview } from "@/context/ctxpack/attachment-preview"
import { createContextAttachmentStore, toSessionContextAttachmentInput } from "@/context/ctxpack/attachment-store"
import { CtxPackDropTarget, useMessageContextTargetRegistry } from "@/context/ctxpack/drop-target"
import { parseCtxPackDragPayload, type CtxPackDragPayloadV1 } from "@/context/ctxpack/drag"
import { attachmentStoreMaterializeFacade } from "@/context/ctxpack/sdk-facade"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { uuid } from "@/utils/uuid"
import {
  PromptInputV2,
  type PromptInputV2Attachment,
  type PromptInputV2PersistedState,
  type PromptInputV2SkillPart,
} from "@opencode-ai/session-ui/v2/prompt-input"
import {
  createPromptInputV2Controller,
  createPromptInputV2State,
} from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { createEffect, createMemo, createUniqueId, For, on, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { ChatRelayCommand, ChatRelayView } from "./runtime"
import { chatRelayError } from "./types"

export function ChatRelayComposer(props: {
  blockID: string
  current: Accessor<ChatRelayView>
  busy: Accessor<boolean>
  onDraft(command: Extract<ChatRelayCommand, { type: "set-draft" }>): Promise<void>
  onPrompt(command: Extract<ChatRelayCommand, { type: "prompt" }>): Promise<boolean>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const dialog = useDialog()
  const targets = useMessageContextTargetRegistry()
  const targetID = createUniqueId()
  const [draft, setDraft] = createStore(cloneDraft(props.current().draft))
  const [state, setState] = createStore<{
    messageID?: string
    verifiedSkills?: Record<string, string>
    validateSkills: boolean
  }>({ validateSkills: props.current().draft.prompt.some((part) => part.type === "skill") })
  const interaction = createPromptInputV2State()
  const owner = createMemo(() =>
    JSON.stringify([
      serverSDK().scope,
      props.current().relay.workspaceID,
      props.current().relay.blockID,
      props.current().relay.tabID,
    ]),
  )
  const workspaceID = createMemo(() => props.current().relay.workspaceID)
  const attachments = createContextAttachmentStore(workspaceID, attachmentStoreMaterializeFacade(serverSDK), owner)
  const selectedSkills = createMemo(() =>
    draft.prompt.filter((part): part is PromptInputV2SkillPart => part.type === "skill"),
  )
  const skills = createSkillMentionCatalog({
    identity: owner,
    open: () => interaction[0].popover.type === "context" || state.validateSkills,
    load: async (signal) =>
      (
        await serverSDK().client.v2.chatProxy.skills(
          { workspaceID: workspaceID(), blockID: props.blockID },
          { signal, throwOnError: true },
        )
      ).data,
  })
  let revision = props.current().draftRevision
  let persisted = JSON.stringify(props.current().draft)
  let submissionIdentity = JSON.stringify(props.current().draft.prompt)

  createEffect(
    on(
      owner,
      () => {
        revision = props.current().draftRevision
        persisted = JSON.stringify(props.current().draft)
        submissionIdentity = JSON.stringify(props.current().draft.prompt)
        setDraft(cloneDraft(props.current().draft))
        setState({
          messageID: undefined,
          verifiedSkills: undefined,
          validateSkills: props.current().draft.prompt.some((part) => part.type === "skill"),
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.current().draftRevision,
      (next) => {
        const value = JSON.stringify(props.current().draft)
        if (next <= revision || value === persisted) return
        revision = next
        persisted = value
        submissionIdentity = JSON.stringify(props.current().draft.prompt)
        setDraft(cloneDraft(props.current().draft))
        setState("messageID", undefined)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => JSON.stringify(draft),
      (value) => {
        if (value === persisted) return
        persisted = value
        const nextSubmissionIdentity = JSON.stringify(draft.prompt)
        if (nextSubmissionIdentity !== submissionIdentity) {
          submissionIdentity = nextSubmissionIdentity
          revision += 1
          setState("messageID", undefined)
        }
        void props.onDraft({ type: "set-draft", draft: cloneDraft(draft), revision })
      },
    ),
  )

  createEffect(() => {
    if (skills.loading()) {
      setState("verifiedSkills", undefined)
      return
    }
    if (skills.error()) {
      setState("validateSkills", false)
      return
    }
    if (interaction[0].popover.type !== "context" && !state.validateSkills) return
    const catalog = Object.fromEntries(skills.items().map((skill) => [skill.name, skill.contentHash]))
    setState({ verifiedSkills: catalog, validateSkills: false })
    if (!selectedSkills().some((skill) => !skill.contentHash && catalog[skill.name])) return
    setDraft(
      "prompt",
      draft.prompt.map((part) =>
        part.type === "skill" && !part.contentHash && catalog[part.name]
          ? { ...part, contentHash: catalog[part.name] }
          : part,
      ),
    )
  })

  const addCtxPack = async (payload: CtxPackDragPayloadV1) => {
    await attachments
      .addCtxPack(payload, { instanceID: props.blockID, functionalityID: "builtin:chat-relay" })
      .then(() => setState("messageID", undefined))
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("prompt.ctxpack.failed"),
          description: chatRelayError(error),
        }),
      )
  }
  const skillPayload = () => {
    const catalog = state.verifiedSkills
    if (!catalog) return
    if (selectedSkills().some((skill) => !skill.contentHash || catalog[skill.name] !== skill.contentHash)) return
    return selectedSkills()
      .filter((skill, index, all) => all.findIndex((item) => item.name === skill.name) === index)
      .map((skill) => ({ name: skill.name, contentHash: skill.contentHash! }))
  }
  const skillStatus = () =>
    !selectedSkills().length
      ? undefined
      : skills.loading()
        ? language.t("canvas.chat.relay.skills.loading")
        : skills.error()
          ? language.t("canvas.chat.relay.skills.error")
          : !skillPayload()
            ? language.t("canvas.chat.relay.skills.stale")
            : undefined
  const ready = () => {
    if (props.busy() || props.current().relay.status !== "idle" || attachments.pendingCount()) return false
    if (selectedSkills().length && !skillPayload()) return false
    return controller.canSubmit() || attachments.attachments().length > 0
  }
  const submit = async () => {
    if (!ready()) return
    const text = controller.value().trim()
    const files: PromptInputV2Attachment[] = controller.attachments()
    const admitted = attachments.attachments()
    const id = state.messageID ?? uuid()
    const submittedRevision = revision
    setState("messageID", id)
    const accepted = await props.onPrompt({
      type: "prompt",
      messageID: id,
      text,
      draftRevision: submittedRevision,
      ...(files.length
        ? { files: files.map((file) => ({ filename: file.filename, mime: file.mime, blob: file.blob })) }
        : {}),
      ...(skillPayload()?.length ? { skills: skillPayload() } : {}),
      ...(admitted.length ? { contextAttachments: admitted.map(toSessionContextAttachmentInput) } : {}),
    })
    if (!accepted) return
    attachments.clearAfterAdmission(admitted)
  }
  const openSkillPreview = async (skill: PromptInputV2SkillPart) => {
    if (!skill.contentHash) return
    const capturedOwner = owner()
    const result = await serverSDK()
      .client.v2.chatProxy.skillPreview(
        {
          workspaceID: workspaceID(),
          blockID: props.blockID,
          name: skill.name,
          contentHash: skill.contentHash,
        },
        { throwOnError: true },
      )
      .then((response) => response.data)
      .catch((error: unknown) => {
        showToast({ variant: "error", title: language.t("common.requestFailed"), description: chatRelayError(error) })
      })
    if (!result || capturedOwner !== owner()) return
    dialog.show(() => (
      <Dialog size="large">
        <DialogHeader closeLabel={language.t("common.close")}>
          <DialogTitleGroup
            title={`${language.t("canvas.chat.relay.skillPreview.title")}: ${result.name}`}
            description={language.t("canvas.chat.relay.skillPreview.description")}
          />
        </DialogHeader>
        <DialogBody class="max-h-[min(560px,calc(100vh-160px))] overflow-y-auto px-4 pb-4">
          <pre class="whitespace-pre-wrap text-12-regular">{result.content}</pre>
        </DialogBody>
      </Dialog>
    ))
  }
  const controller = createPromptInputV2Controller({
    store: [draft, setDraft],
    state: interaction,
    identity: owner,
    chatOnly: true,
    commands: () => [],
    context: () => skillMentionCandidates(skills.items()),
    searchContextFiles: () => [],
    attachments: {
      picker: platform.openAttachmentPickerDialog,
      directory: () => "",
      isDialogActive: () => !!dialog.active,
      warn: () =>
        showToast({
          title: language.t("prompt.toast.pasteUnsupported.title"),
          description: language.t("prompt.toast.pasteUnsupported.description"),
        }),
      duplicate: () => showToast({ title: language.t("prompt.toast.attachmentDuplicate.title") }),
      onError: (error) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      readClipboardImage: platform.readClipboardImage,
      getPathForFile: platform.getPathForFile,
      store: platform.draftStore?.putBlob,
    },
    onEditor(element) {
      element.dataset.input = "chat-relay-message"
      const markFocused = () => targets.markFocused(targetID)
      element.addEventListener("focusin", markFocused)
      element.addEventListener("pointerdown", markFocused)
    },
    view: {
      placeholder: () => language.t("canvas.chat.relay.placeholder"),
      contextStatus: () =>
        skills.loading()
          ? language.t("canvas.chat.relay.skills.loading")
          : skills.error()
            ? language.t("canvas.chat.relay.skills.error")
            : skillStatus(),
      contextAttachments: () => ({
        items: attachments.attachments(),
        totalEstimatedTokens: attachments.totalEstimatedTokens(),
      }),
      onRemoveAttachment(clientAttachmentID) {
        attachments.remove(clientAttachmentID)
        setState("messageID", undefined)
      },
      onPreviewAttachment(clientAttachmentID) {
        const attachment = attachments.attachments().find((item) => item.clientAttachmentID === clientAttachmentID)
        if (!attachment) return
        dialog.show(() => (
          <CtxPackAttachmentPreview workspaceID={workspaceID()} ctxPackID={attachment.source.ctxPackID} />
        ))
      },
      onDrop(event) {
        if (!event.dataTransfer) return false
        const payload = parseCtxPackDragPayload(event.dataTransfer)
        if (!payload) return false
        void addCtxPack(payload)
        return true
      },
      submit: {
        stopping: () => false,
        working: props.busy,
        onSubmit: () => void submit(),
        onStop: () => undefined,
      },
    },
  })
  const relayController = { ...controller, canSubmit: ready }

  return (
    <CtxPackDropTarget
      targetID={targetID}
      workspaceID={workspaceID()}
      instanceID={props.blockID}
      functionalityID="builtin:chat-relay"
      addCtxPack={addCtxPack}
      disabled={() => !props.current().relay.tabID || props.current().relay.status === "closed" || props.busy()}
      class="canvas-relay-context-composer"
    >
      <div onFocusIn={() => targets.markFocused(targetID)}>
        <Show when={skillStatus()}>
          {(status) => (
            <div data-component="chat-relay-skill-status" role="status">
              {status()}
            </div>
          )}
        </Show>
        <For each={selectedSkills()}>
          {(skill) => (
            <button type="button" data-action="chat-relay-skill-preview" onClick={() => void openSkillPreview(skill)}>
              @{skill.name}
            </button>
          )}
        </For>
        <PromptInputV2
          controller={relayController}
          chatOnly
          disabled={props.current().relay.status === "closed"}
          class="canvas-relay-composer"
        />
      </div>
    </CtxPackDropTarget>
  )
}

function cloneDraft(draft: PromptInputV2PersistedState): PromptInputV2PersistedState {
  return {
    ...draft,
    prompt: draft.prompt.map((part) => ({ ...part })),
    context: { items: draft.context.items.map((item) => ({ ...item })) },
  }
}
