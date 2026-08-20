import {
  subscribePromptDelivery,
  type PromptDeliveryEvent,
} from "@/components/prompt-input/delivery-events"
import { createSignal, onCleanup, Show, type ParentProps } from "solid-js"

type Failure = PromptDeliveryEvent & { status: "failed" }

export function ChatRelayDeliveryStatus(props: ParentProps<{ directory: string; sessionID: string }>) {
  const [failure, setFailure] = createSignal<Failure>()
  const unsubscribe = subscribePromptDelivery((event) => {
    if (event.directory !== props.directory || event.sessionID !== props.sessionID) return
    if (event.status === "sending") {
      setFailure(undefined)
      return
    }
    setFailure(event as Failure)
  })
  onCleanup(unsubscribe)

  return (
    <div class="canvas-relay-session">
      <Show when={failure()}>
        {(value) => (
          <div class="canvas-relay-delivery-error" role="alert" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" aria-label="Dismiss server error" onClick={() => setFailure(undefined)}>
              Close
            </button>
            <strong>Message failed</strong>
            <span class="canvas-relay-delivery-message">Sent: {value().message}</span>
            <span class="canvas-relay-delivery-detail">{value().error ?? "The server rejected the message."}</span>
          </div>
        )}
      </Show>
      {props.children}
    </div>
  )
}
