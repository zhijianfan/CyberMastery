import { ChatProxyRequestError } from "@opencode-ai/protocol/groups/chat-proxy"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ChatProxyService } from "../chat-proxy"
import { requestUser } from "../middleware/authorization"

export const ChatProxyHandler = HttpApiBuilder.group(Api, "server.chatProxy", (handlers) =>
  Effect.succeed(
    handlers
      .handle("chatProxy.list", () =>
        requestUser.pipe(Effect.flatMap((user) => request(() => ChatProxyService.list(user.id)))),
      )
      .handle("chatProxy.connect", () =>
        requestUser.pipe(Effect.flatMap((user) => request(() => ChatProxyService.connect(user.id)))),
      )
      .handle("chatProxy.open", () =>
        requestUser.pipe(Effect.flatMap((user) => request(() => ChatProxyService.open(user.id)))),
      )
      .handle("chatProxy.disconnect", () =>
        requestUser.pipe(Effect.flatMap((user) => request(() => ChatProxyService.disconnect(user.id)))),
      )
      .handle("chatProxy.relay", (ctx) =>
        requestUser.pipe(Effect.flatMap((user) => request(() => ChatProxyService.relay(user.id, ctx.params.relayID)))),
      )
      .handle("chatProxy.prompt", (ctx) =>
        requestUser.pipe(
          Effect.flatMap((user) =>
            request(() =>
              ChatProxyService.prompt(
                user.id,
                ctx.params.relayID,
                ctx.payload.text,
                ctx.payload.model,
                ctx.payload.effort,
              ),
            ),
          ),
        ),
      ),
  ),
)

function request<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ChatProxyRequestError({
        name: "ChatProxyRequestError",
        data: { message: cause instanceof Error ? cause.message : String(cause) },
      }),
  })
}
