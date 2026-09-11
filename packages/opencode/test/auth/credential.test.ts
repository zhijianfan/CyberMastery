import { describe, expect, test } from "bun:test"
import { Credential } from "@opencode-ai/core/credential"
import { CredentialTable } from "@opencode-ai/core/credential/sql"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { AuthCredential } from "../../src/auth/credential"
import { testEffect } from "../lib/effect"

const layer = LayerNode.compile(LayerNode.group([AuthCredential.node, Auth.node, Database.node]))
const it = testEffect(layer)
const openai = Integration.ID.make("openai")
const anthropic = Integration.ID.make("anthropic")

describe("AuthCredential", () => {
  it.effect("replaces a stale V2 OpenAI key with the canonical ChatGPT OAuth login", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      const stale = yield* credentials.create({
        integrationID: openai,
        label: "Personal",
        value: Credential.Key.make({ type: "key", key: "stale-key" }),
      })
      yield* auth.set("openai", {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: 4_000_000_000_000,
        accountId: "account-1",
      })

      const current = yield* credentials.list(openai)

      expect(current).toHaveLength(1)
      expect(current[0].id).not.toBe(stale.id)
      expect(current[0].label).toBe("Personal")
      expect(current[0].value).toEqual({
        type: "oauth",
        methodID: Integration.MethodID.make("chatgpt-browser"),
        refresh: "refresh-token",
        access: "access-token",
        expires: 4_000_000_000_000,
        metadata: { accountID: "account-1" },
      })
      expect((yield* credentials.list(openai))[0].id).toBe(current[0].id)
    }),
  )

  it.effect("mirrors explicit OpenAI key and OAuth switches to legacy auth", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      const key = yield* credentials.create({
        integrationID: openai,
        value: Credential.Key.make({ type: "key", key: "api-key", metadata: { tenant: "work", retries: 2 } }),
      })

      expect(yield* auth.get("openai")).toEqual({ type: "api", key: "api-key", metadata: { tenant: "work" } })
      expect((yield* credentials.get(key.id))?.value).toEqual(
        Credential.Key.make({ type: "key", key: "api-key", metadata: { tenant: "work", retries: 2 } }),
      )
      yield* auth.set("openai", { type: "api", key: "api-key" })
      const reconciledKey = (yield* credentials.list(openai))[0]
      expect(reconciledKey.value).toEqual(
        Credential.Key.make({ type: "key", key: "api-key", metadata: { retries: 2 } }),
      )

      yield* credentials.update(reconciledKey.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-headless"),
          refresh: "new-refresh",
          access: "new-access",
          expires: 4_000_000_000_001,
          metadata: { accountID: "account-2", enterpriseUrl: "https://chatgpt.example", region: "us" },
        }),
      })

      expect(yield* auth.get("openai")).toEqual({
        type: "oauth",
        refresh: "new-refresh",
        access: "new-access",
        expires: 4_000_000_000_001,
        accountId: "account-2",
        enterpriseUrl: "https://chatgpt.example",
      })
      expect((yield* credentials.get(reconciledKey.id))?.value).toMatchObject({
        methodID: Integration.MethodID.make("chatgpt-headless"),
        metadata: { accountID: "account-2", enterpriseUrl: "https://chatgpt.example", region: "us" },
      })

      yield* auth.set("openai", {
        type: "oauth",
        refresh: "new-refresh",
        access: "new-access",
        expires: 4_000_000_000_001,
      })
      const withoutAccount = (yield* credentials.list(openai))[0]
      expect(withoutAccount.value).toMatchObject({
        methodID: Integration.MethodID.make("chatgpt-headless"),
        metadata: { region: "us" },
      })

      yield* auth.set("openai", {
        type: "oauth",
        refresh: "another-refresh",
        access: "another-access",
        expires: 4_000_000_000_002,
      })
      expect((yield* credentials.list(openai))[0].value).toEqual(
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "another-refresh",
          access: "another-access",
          expires: 4_000_000_000_002,
        }),
      )
    }),
  )

  it.effect("keeps V2 OAuth refreshes visible to legacy auth", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      const current = yield* credentials.create({
        integrationID: openai,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "before-refresh",
          access: "before-access",
          expires: 1,
        }),
      })

      yield* credentials.update(current.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "after-refresh",
          access: "after-access",
          expires: 4_000_000_000_000,
        }),
      })

      expect(yield* auth.get("openai")).toMatchObject({
        type: "oauth",
        refresh: "after-refresh",
        access: "after-access",
        expires: 4_000_000_000_000,
      })

      yield* auth.remove("openai")
      yield* credentials.update(current.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "stale-refresh",
          access: "stale-access",
          expires: 4_000_000_000_001,
        }),
      })
      expect(yield* auth.get("openai")).toBeUndefined()
      expect(yield* credentials.get(current.id)).toBeUndefined()

      const switched = yield* credentials.create({
        integrationID: openai,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "old-refresh",
          access: "old-access",
          expires: 1,
        }),
      })
      yield* auth.set("openai", {
        type: "oauth",
        refresh: "other-refresh",
        access: "other-access",
        expires: 4_000_000_000_002,
      })
      const replacement = (yield* credentials.list(openai))[0]
      expect(replacement.id).not.toBe(switched.id)
      yield* credentials.update(switched.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          refresh: "late-refresh",
          access: "late-access",
          expires: 4_000_000_000_003,
        }),
      })
      expect(yield* auth.get("openai")).toMatchObject({ refresh: "other-refresh", access: "other-access" })
      expect((yield* credentials.get(replacement.id))?.value).toMatchObject({
        refresh: "other-refresh",
        access: "other-access",
      })
    }),
  )

  it.effect("removes OpenAI without resurrecting stale credentials", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      const byGet = yield* credentials.create({
        integrationID: openai,
        value: Credential.Key.make({ type: "key", key: "remove-me" }),
      })
      yield* auth.remove("openai")
      expect(yield* credentials.get(byGet.id)).toBeUndefined()

      const byAll = yield* credentials.create({
        integrationID: openai,
        value: Credential.Key.make({ type: "key", key: "remove-me" }),
      })
      yield* auth.remove("openai")
      expect((yield* credentials.all()).some((credential) => credential.id === byAll.id)).toBeFalse()

      const byList = yield* credentials.create({
        integrationID: openai,
        value: Credential.Key.make({ type: "key", key: "remove-me" }),
      })
      yield* auth.remove("openai")
      expect(yield* credentials.list(openai)).toEqual([])
      expect(yield* credentials.get(byList.id)).toBeUndefined()

      const explicit = yield* credentials.create({
        integrationID: openai,
        value: Credential.Key.make({ type: "key", key: "remove-me" }),
      })
      yield* credentials.remove(explicit.id)
      expect(yield* auth.get("openai")).toBeUndefined()
      expect(yield* credentials.list(openai)).toEqual([])
    }),
  )

  it.effect("delegates unrelated providers unchanged", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      yield* auth.remove("anthropic")
      const current = yield* credentials.create({
        integrationID: anthropic,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "anthropic-key", metadata: { tenant: 2 } }),
      })

      expect(yield* credentials.list(anthropic)).toEqual([current])
      expect(yield* auth.get("anthropic")).toBeUndefined()
    }),
  )

  it.effect("serializes concurrent OpenAI imports around one stable credential", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove("openai")
      yield* auth.set("openai", {
        type: "oauth",
        refresh: "shared-refresh",
        access: "shared-access",
        expires: 4_000_000_000_000,
      })

      const results = yield* Effect.all([credentials.list(openai), credentials.list(openai)], {
        concurrency: "unbounded",
      })

      expect(results[0]).toHaveLength(1)
      expect(results[1]).toHaveLength(1)
      expect(results[0][0].id).toBe(results[1][0].id)
      expect(results[0][0].value).toMatchObject({ type: "oauth", access: "shared-access" })
      expect(results[1][0].value).toMatchObject({ type: "oauth", access: "shared-access" })
    }),
  )

  test("exposes an ephemeral auth override without copying it into the database", async () => {
    const previous = process.env.OPENCODE_AUTH_CONTENT
    delete process.env.OPENCODE_AUTH_CONTENT
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          const credentials = yield* Credential.Service
          yield* auth.remove("openai")
          yield* credentials.list(openai)
        }).pipe(Effect.provide(layer)),
      )
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "override-refresh",
          access: "override-access",
          expires: 4_000_000_000_000,
        },
      })

      await Effect.runPromise(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const database = yield* Database.Service
          const current = yield* credentials.list(openai)
          expect(current).toHaveLength(1)
          expect(current[0].value).toEqual({
            type: "oauth",
            methodID: Integration.MethodID.make("chatgpt-browser"),
            refresh: "override-refresh",
            access: "override-access",
            expires: 4_000_000_000_000,
          })
          expect(
            (yield* database.db.select().from(CredentialTable).all()).filter(
              (credential) => credential.integration_id === openai,
            ),
          ).toEqual([])
        }).pipe(Effect.provide(layer)),
      )
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      if (previous !== undefined) process.env.OPENCODE_AUTH_CONTENT = previous
    }
  })
})
