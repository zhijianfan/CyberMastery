import { Credential } from "@opencode-ai/core/credential"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Location } from "@opencode-ai/schema/location"
import { DateTime, Effect, Layer } from "effect"
import { messageParts, messageRole } from "../resource-snapshot"
import {
  NativeSessionRuntimeService,
  PermissionRuntimeService,
  ProviderAuthRuntimeService,
} from "./opencode-chat"

// Native provider/auth runtime. Device-flow OAuth is owned by the provider
// plugin running in the client (see packages/opencode/src/plugin/openai/codex.ts);
// the server-side block runtime only observes credential presence. auth.start
// intentionally fails with guidance rather than reimplementing device flows.
export const ProviderAuthRuntimeLive = Layer.effect(
  ProviderAuthRuntimeService,
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    return ProviderAuthRuntimeService.of({
      start: () =>
        Effect.fail(
          new Error("auth.start is driven by the native provider surface; use the session surface to complete login"),
        ),
      status: (providerID) =>
        Effect.gen(function* () {
          const info = yield* credentials.get(providerID as Credential.ID)
          return {
            providerID,
            status: info ? ("ready" as const) : ("missing" as const),
          }
        }),
    })
  }),
)

// Native session runtime over SessionV2. Busy-ness comes from the process-local
// active set. modelID/agentID in session.create are deliberately not forwarded
// yet: constructing brand-safe Model.Ref/Agent IDs requires provider context
// the adapter does not hold (documented integration follow-up).
export const NativeSessionRuntimeLive = Layer.effect(
  NativeSessionRuntimeService,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const permissions = yield* PermissionV2.Service
    return NativeSessionRuntimeService.of({
      create: (input) =>
        Effect.gen(function* () {
          const active = yield* sessions.active
          const directory = process.cwd() as Location.Ref["directory"]
          const info = yield* sessions.create({ location: { directory } })
          return {
            id: info.id,
            status: active.has(info.id) ? "busy" : "idle",
            directory: directory as string,
            modelID: info.model?.id,
            agentID: info.agent ?? undefined,
          }
        }),
      get: (sessionID) =>
        Effect.gen(function* () {
          const active = yield* sessions.active
          const info = yield* sessions.get(sessionID as SessionV2.ID)
          return {
            id: info.id,
            status: active.has(info.id) ? "busy" : "idle",
            modelID: info.model?.id,
            agentID: info.agent ?? undefined,
          }
        }),
      prompt: (sessionID, input) =>
        sessions
          .prompt({
            sessionID: sessionID as SessionV2.ID,
            prompt: { text: input.text } as PromptInput.Prompt,
            delivery: input.delivery,
          })
          .pipe(Effect.as(undefined)),
      abort: (sessionID) => sessions.interrupt(sessionID as SessionV2.ID),
      messages: (sessionID) =>
        Effect.gen(function* () {
          const messages = yield* sessions.messages({ sessionID: sessionID as SessionV2.ID })
          return messages.flatMap((message) => {
            const role = messageRole(message)
            if (!role) return []
            return [
              {
                id: message.id,
                sessionID,
                role,
                timeCreated: DateTime.toEpochMillis(message.time.created),
              },
            ]
          })
        }),
      parts: (input) =>
        Effect.gen(function* () {
          const message = yield* sessions.message({
            sessionID: input.sessionID as SessionV2.ID,
            messageID: input.messageID as SessionMessage.ID,
          })
          if (!message) return []
          return messageParts(message).map((part) => ({ ...part }))
        }),
      pendingPermissions: (sessionID) =>
        Effect.gen(function* () {
          const requests = yield* permissions.forSession(sessionID as SessionV2.ID)
          return requests.map((request) => ({
            id: request.id,
            requestID: request.id,
            sessionID,
            status: "pending" as const,
          }))
        }),
    })
  }),
)

// Native permission runtime over PermissionV2's reply vocabulary.
export const PermissionRuntimeLive = Layer.effect(
  PermissionRuntimeService,
  Effect.gen(function* () {
    const permissions = yield* PermissionV2.Service
    return PermissionRuntimeService.of({
      respond: (requestID, response) =>
        permissions.reply({
          requestID: requestID as PermissionV2.ID,
          reply: response === "allow-always" ? "always" : response === "deny" ? "reject" : "once",
        }),
    })
  }),
)
