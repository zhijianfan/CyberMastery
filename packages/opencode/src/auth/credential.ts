import { isDeepStrictEqual } from "node:util"
import { Credential } from "@opencode-ai/core/credential"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Effect, Layer, Semaphore } from "effect"
import { Auth } from "@/auth"

const openai = Integration.ID.make("openai")
const browser = Integration.MethodID.make("chatgpt-browser")

const layer = Layer.effect(
  Credential.Service,
  Effect.gen(function* () {
    const delegate = yield* Credential.Service
    const auth = yield* Auth.Service
    if (process.env.OPENCODE_AUTH_CONTENT) {
      // Environment credentials are authoritative for this process and read-only.
      // Keep native writes available underneath without copying the override to disk.
      const overrides = Effect.fn("AuthCredential.overrides")(function* () {
        return Object.entries(yield* auth.all().pipe(Effect.orDie)).flatMap(([integrationID, info]) =>
          projectAuth("auth_override", integrationID, info),
        )
      })
      const all = Effect.fn("AuthCredential.allOverrides")(function* () {
        const values = yield* overrides()
        const integrations = new Set(values.map((credential) => credential.integrationID))
        return [
          ...(yield* delegate.all()).filter((credential) => !integrations.has(credential.integrationID)),
          ...values,
        ]
      })
      const get = Effect.fn("AuthCredential.getOverride")(function* (id: Credential.ID) {
        return (yield* overrides()).find((credential) => credential.id === id) ?? (yield* delegate.get(id))
      })
      return Credential.Service.of({
        all,
        list: (integrationID) =>
          all().pipe(Effect.map((credentials) => credentials.filter((item) => item.integrationID === integrationID))),
        get,
        create: delegate.create,
        update: delegate.update,
        remove: delegate.remove,
      })
    }
    const semaphore = Semaphore.makeUnsafe(1)
    const legacy = Effect.fn("AuthCredential.legacy")(function* () {
      return Object.entries(yield* auth.all().pipe(Effect.orDie)).flatMap(([integrationID, info]) =>
        integrationID === openai ? [] : projectAuth("legacy", integrationID, info),
      )
    })

    const reconcile = Effect.fn("AuthCredential.reconcile")(function* () {
      const legacy = yield* auth.get("openai").pipe(Effect.orDie)
      const existing = (yield* delegate.list(openai))[0]
      const value = legacy ? fromAuth(legacy, existing?.value) : undefined
      if (!value) {
        if (existing) yield* delegate.remove(existing.id)
        return
      }
      if (!existing) {
        yield* delegate.create({ integrationID: openai, value })
        return
      }
      if (isDeepStrictEqual(existing.value, value)) return
      // Retire the old ID so a late token refresh cannot replace the new login.
      yield* delegate.create({ integrationID: openai, label: existing.label, value })
    })

    const reconcileLocked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      semaphore.withPermit(reconcile().pipe(Effect.andThen(effect)))

    return Credential.Service.of({
      all: () =>
        reconcileLocked(delegate.all()).pipe(
          Effect.flatMap((saved) =>
            legacy().pipe(
              Effect.map((values) => {
                const integrations = new Set(saved.map((credential) => credential.integrationID))
                return [...saved, ...values.filter((credential) => !integrations.has(credential.integrationID))]
              }),
            ),
          ),
        ),
      list: (integrationID) =>
        integrationID === openai
          ? reconcileLocked(delegate.list(openai))
          : Effect.gen(function* () {
              const saved = yield* delegate.list(integrationID)
              if (saved.length > 0) return saved
              const info = yield* auth.get(integrationID).pipe(Effect.orDie)
              return info ? projectAuth("legacy", integrationID, info) : []
            }),
      get: (id) =>
        Effect.gen(function* () {
          const existing = yield* delegate.get(id)
          if (existing?.integrationID === openai) return yield* reconcileLocked(delegate.get(id))
          if (existing) return existing
          return (yield* legacy()).find((credential) => credential.id === id)
        }),
      create: (input) => {
        if (input.integrationID !== openai)
          return delegate.create(input).pipe(Effect.tap(() => auth.remove(input.integrationID).pipe(Effect.orDie)))
        return semaphore.withPermit(
          auth.set("openai", toAuth(input.value)).pipe(Effect.orDie, Effect.andThen(delegate.create(input))),
        )
      },
      update: (id, updates) =>
        Effect.gen(function* () {
          const existing = yield* delegate.get(id)
          if (existing && existing.integrationID !== openai) return yield* delegate.update(id, updates)
          if (!existing) {
            const projected = (yield* legacy()).find((credential) => credential.id === id)
            if (!projected) return
            if (updates.label !== undefined) {
              yield* delegate.create({
                integrationID: projected.integrationID,
                label: updates.label,
                value: updates.value ?? projected.value,
              })
              return yield* auth.remove(projected.integrationID).pipe(Effect.orDie)
            }
            if (updates.value) yield* auth.set(projected.integrationID, toAuth(updates.value)).pipe(Effect.orDie)
            return
          }
          return yield* semaphore.withPermit(
            Effect.gen(function* () {
              const current = yield* delegate.get(id)
              if (current?.integrationID !== openai) return yield* delegate.update(id, updates)
              if (updates.value) {
                const legacy = yield* auth.get("openai").pipe(Effect.orDie)
                if (!legacy || !isDeepStrictEqual(toAuth(current.value), { ...legacy })) {
                  yield* reconcile()
                  return
                }
                yield* auth.set("openai", toAuth(updates.value)).pipe(Effect.orDie)
              }
              yield* delegate.update(id, updates)
            }),
          )
        }),
      remove: (id) =>
        Effect.gen(function* () {
          const existing = yield* delegate.get(id)
          if (existing && existing.integrationID !== openai) {
            yield* auth.remove(existing.integrationID).pipe(Effect.orDie)
            return yield* delegate.remove(id)
          }
          if (!existing) {
            const projected = (yield* legacy()).find((credential) => credential.id === id)
            if (projected) yield* auth.remove(projected.integrationID).pipe(Effect.orDie)
            return
          }
          return yield* semaphore.withPermit(
            Effect.gen(function* () {
              const current = yield* delegate.get(id)
              if (current?.integrationID !== openai) return yield* delegate.remove(id)
              yield* auth.remove("openai").pipe(Effect.orDie)
              yield* delegate.remove(id)
            }),
          )
        }),
    })
  }),
).pipe(Layer.provide(LayerNode.compile(Credential.node)))

// The delegate stays inside the layer to avoid replacing Credential.node recursively.
export const node = makeGlobalNode({ service: Credential.Service, layer, deps: [Auth.node] })
export const replacement = [Credential.node, node] as const

function projectAuth(prefix: "auth_override" | "legacy", integrationID: string, info: Auth.Info) {
  const id = Integration.ID.make(integrationID)
  const value = info.type === "api" || id === openai ? fromAuth(info) : undefined
  return value
    ? [
        new Credential.Info({
          id: Credential.ID.make(`cred_${prefix}_${encodeURIComponent(integrationID)}`),
          integrationID: id,
          label: "default",
          value,
        }),
      ]
    : []
}

function fromAuth(info: Auth.Info, existing?: Credential.Value): Credential.Value | undefined {
  if (info.type === "api") {
    const metadata = {
      ...(existing?.type === "key" && existing.key === info.key
        ? Object.fromEntries(Object.entries(existing.metadata ?? {}).filter((entry) => typeof entry[1] !== "string"))
        : undefined),
      ...info.metadata,
    }
    return Credential.Key.make({
      type: "key",
      key: info.key,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    })
  }
  if (info.type !== "oauth") return
  const sameLogin = existing?.type === "oauth" && existing.refresh === info.refresh
  const metadata = {
    ...(sameLogin
      ? Object.fromEntries(
          Object.entries(existing.metadata ?? {}).filter(([key]) => key !== "accountID" && key !== "enterpriseUrl"),
        )
      : undefined),
    ...(info.accountId ? { accountID: info.accountId } : {}),
    ...(info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : {}),
  }
  return Credential.OAuth.make({
    type: "oauth",
    methodID: sameLogin ? existing.methodID : browser,
    refresh: info.refresh,
    access: info.access,
    expires: info.expires,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  })
}

function toAuth(value: Credential.Value): Auth.Info {
  if (value.type === "key") {
    const metadata = Object.fromEntries(
      Object.entries(value.metadata ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    return {
      type: "api",
      key: value.key,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  }
  const accountId = value.metadata?.accountID
  const enterpriseUrl = value.metadata?.enterpriseUrl
  return {
    type: "oauth",
    refresh: value.refresh,
    access: value.access,
    expires: value.expires,
    ...(typeof accountId === "string" ? { accountId } : {}),
    ...(typeof enterpriseUrl === "string" ? { enterpriseUrl } : {}),
  }
}

export * as AuthCredential from "./credential"
