import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Integration } from "@opencode-ai/core/integration"
import { Effect, Layer, Schema } from "effect"
import { Auth } from "."

const layer = Layer.effect(
  Credential.Service,
  Effect.gen(function* () {
    const stored = yield* Credential.Service
    const auth = yield* Auth.Service
    const legacy = Effect.fn(function* () {
      return Object.entries(yield* auth.all().pipe(Effect.orDie)).flatMap(([integrationID, value]) => {
        const credential =
          value.type === "api"
            ? Credential.Key.make({ type: "key", key: value.key, metadata: value.metadata })
            : value.type === "oauth" && integrationID === "openai"
              ? Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("chatgpt-browser"),
                  access: value.access,
                  refresh: value.refresh,
                  expires: value.expires,
                  metadata: value.accountId ? { accountID: value.accountId } : undefined,
                })
              : undefined
        return credential
          ? [
              new Credential.Info({
                id: Credential.ID.make(`cred_legacy_${encodeURIComponent(integrationID)}`),
                integrationID: Integration.ID.make(integrationID),
                label: "default",
                value: credential,
              }),
            ]
          : []
      })
    })
    const all = Effect.fn(function* () {
      const saved = yield* stored.all()
      const integrations = new Set(saved.map((credential) => credential.integrationID))
      return [...saved, ...(yield* legacy()).filter((credential) => !integrations.has(credential.integrationID))]
    })
    const get = Effect.fn(function* (id: Credential.ID) {
      return (yield* all()).find((credential) => credential.id === id)
    })
    return Credential.Service.of({
      all,
      list: (integrationID) =>
        all().pipe(Effect.map((items) => items.filter((item) => item.integrationID === integrationID))),
      get,
      create: Effect.fn(function* (input) {
        const credential = yield* stored.create(input)
        yield* auth.remove(input.integrationID).pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn(function* (id, updates) {
        if (yield* stored.get(id)) return yield* stored.update(id, updates)
        const credential = yield* get(id)
        if (!credential) return
        if (updates.label !== undefined) {
          yield* stored.create({
            integrationID: credential.integrationID,
            label: updates.label,
            value: updates.value ?? credential.value,
          })
          return yield* auth.remove(credential.integrationID).pipe(Effect.orDie)
        }
        if (!updates.value) return
        const value = updates.value
        yield* auth
          .set(
            credential.integrationID,
            value.type === "key"
              ? Schema.decodeUnknownSync(Auth.Api)({ type: "api", key: value.key, metadata: value.metadata })
              : new Auth.Oauth({
                  type: "oauth",
                  access: value.access,
                  refresh: value.refresh,
                  expires: value.expires,
                  accountId: typeof value.metadata?.accountID === "string" ? value.metadata.accountID : undefined,
                }),
          )
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn(function* (id) {
        const credential = yield* get(id)
        if (!credential) return
        yield* auth.remove(credential.integrationID).pipe(Effect.orDie)
        yield* stored.remove(id)
      }),
    })
  }),
).pipe(Layer.provide(Credential.layer))

// The host still signs in through Auth; read it on demand instead of copying
// tokens into the native database, where refreshes and revocations would drift.
export const node = makeGlobalNode({ service: Credential.Service, layer, deps: [Auth.node, Database.node] })
export const replacement = [Credential.node, node] as const

export * as CredentialCompat from "./credential-compat"
