import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { CredentialTable } from "@opencode-ai/core/credential/sql"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { LLM } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import { DateTime, Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import { AppNodeBuilderV1 } from "../../src/effect/app-node-builder-v1"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilderV1.build(
    LayerNode.group([
      Auth.node,
      Credential.node,
      Catalog.node,
      Integration.node,
      SessionRunnerModel.node,
      Database.node,
    ]),
    [
      [Database.node, Database.layerFromPath(":memory:")],
      [
        Location.node,
        Layer.succeed(Location.Service, {
          directory: AbsolutePath.make(import.meta.dir),
          project: { id: ProjectV2.ID.global, directory: AbsolutePath.make(import.meta.dir) },
        }),
      ],
    ],
  ),
)
const providerID = ProviderV2.ID.openai
const integrationID = Integration.ID.make(providerID)
const legacyProviderID = "anthropic"
const legacyIntegrationID = Integration.ID.make(legacyProviderID)
const modelID = ModelV2.ID.make("gpt-5.6-terra")
const oauth = {
  type: "oauth" as const,
  access: "legacy-access",
  refresh: "legacy-refresh",
  expires: 9_000_000_000_000,
  accountId: "test-account",
}

const setup = Effect.fn(function* () {
  const auth = yield* Auth.Service
  const credentials = yield* Credential.Service
  const integrations = yield* Integration.Service
  const catalog = yield* Catalog.Service
  yield* auth.remove(providerID)
  for (const credential of yield* credentials.list(integrationID)) yield* credentials.remove(credential.id)
  yield* integrations.transform((draft) => draft.update(integrationID, () => {}))
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.api = { type: "aisdk", package: "@ai-sdk/openai" }
    })
    draft.model.update(providerID, modelID, () => {})
  })
})

describe("legacy credential compatibility", () => {
  it.live("preserves legacy API credentials for other providers", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.remove(legacyProviderID)
      for (const credential of yield* credentials.list(legacyIntegrationID)) yield* credentials.remove(credential.id)
      yield* auth.set(legacyProviderID, { type: "api", key: "legacy-anthropic" })

      const credential = (yield* credentials.list(legacyIntegrationID))[0]!
      expect(credential.value).toEqual({ type: "key", key: "legacy-anthropic" })
      yield* auth.set(legacyProviderID, { type: "api", key: "updated-anthropic" })
      expect((yield* credentials.get(credential.id))?.value).toEqual({ type: "key", key: "updated-anthropic" })
      yield* credentials.remove(credential.id)
      expect(yield* auth.get(legacyProviderID)).toBeUndefined()
      expect(yield* credentials.list(legacyIntegrationID)).toEqual([])
    }),
  )

  it.live("uses the canonical OpenAI bridge in the legacy app graph", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const database = yield* Database.Service
      yield* auth.set(providerID, oauth)

      const credential = (yield* credentials.list(integrationID))[0]!
      expect(credential).toBeDefined()
      expect((yield* database.db.select().from(CredentialTable).all()).map((row) => row.id)).toContain(credential.id)
    }),
  )

  it.live("honors an explicit credential service replacement", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Injected credentials")
    }).pipe(
      Effect.provide(
        AppNodeBuilderV1.build(Credential.node, [
          [
            Credential.node,
            Layer.mock(Credential.Service, {
              list: () =>
                Effect.succeed([
                  new Credential.Info({
                    id: Credential.ID.make("cred_injected"),
                    integrationID,
                    label: "Injected credentials",
                    value: Credential.Key.make({ type: "key", key: "injected-key" }),
                  }),
                ]),
            }),
          ],
        ]),
      ),
    ),
  )

  it.live("makes legacy API keys available to the native catalog", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const integrations = yield* Integration.Service
      const catalog = yield* Catalog.Service
      yield* auth.set(providerID, { type: "api", key: "legacy-key", metadata: { tenant: "test" } })

      expect((yield* catalog.model.available()).map((model) => model.id)).toContain(modelID)
      const connection = yield* integrations.connection.active(integrationID)
      expect(connection).toBeDefined()
      expect(yield* integrations.connection.resolve(connection!)).toEqual({
        type: "key",
        key: "legacy-key",
        metadata: { tenant: "test" },
      })
    }),
  )

  it.live("maps legacy OpenAI OAuth to the native refresh method and account metadata", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      const models = yield* SessionRunnerModel.Service
      yield* auth.set(providerID, oauth)

      expect((yield* catalog.model.available()).map((model) => model.id)).toContain(modelID)
      expect((yield* credentials.list(integrationID))[0]?.value).toEqual({
        type: "oauth",
        methodID: Integration.MethodID.make("chatgpt-browser"),
        access: oauth.access,
        refresh: oauth.refresh,
        expires: oauth.expires,
        metadata: { accountID: oauth.accountId },
      })
      const resolved = yield* models.resolve(
        SessionV2.Info.make({
          id: SessionV2.ID.make("ses_legacy_oauth_model"),
          projectID: ProjectV2.ID.global,
          title: "Legacy OAuth model",
          model: { providerID, id: modelID },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
          location: { directory: AbsolutePath.make(import.meta.dir) },
        }),
      )
      expect(resolved.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(resolved.route.defaults.headers).toMatchObject({ "ChatGPT-Account-Id": oauth.accountId })
      const prepared = yield* LLMClient.prepare(LLM.request({ model: resolved, prompt: "Hello" }))
      expect(prepared.body).toMatchObject({ model: modelID, store: false })
      expect(JSON.stringify(prepared.body)).not.toContain(oauth.access)
    }),
  )

  it.live("observes canonical auth updates and revocation through the app graph", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* auth.set(providerID, { type: "api", key: "first-key" })
      const credential = (yield* credentials.list(integrationID))[0]!
      expect(credential).toBeDefined()
      yield* auth.set(providerID, { type: "api", key: "second-key" })
      const updated = (yield* credentials.list(integrationID))[0]!
      expect(updated.id).not.toBe(credential.id)
      expect(updated.value).toEqual({ type: "key", key: "second-key" })
      expect(yield* credentials.get(credential.id)).toBeUndefined()
      yield* auth.remove(providerID)
      expect(yield* credentials.get(updated.id)).toBeUndefined()
      expect(yield* catalog.model.available()).toEqual([])
    }),
  )

  it.live("writes native OAuth refreshes and revocation back to legacy auth", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.set(providerID, oauth)
      const credential = (yield* credentials.list(integrationID))[0]!
      expect(credential).toBeDefined()
      yield* credentials.update(credential.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "refreshed-access",
          refresh: "refreshed-refresh",
          expires: oauth.expires + 1,
          metadata: { accountID: "refreshed-account" },
        }),
      })
      expect(yield* auth.get(providerID)).toEqual({
        type: "oauth",
        access: "refreshed-access",
        refresh: "refreshed-refresh",
        expires: oauth.expires + 1,
        accountId: "refreshed-account",
      })
      yield* credentials.remove(credential.id)
      expect(yield* auth.get(providerID)).toBeUndefined()
    }),
  )

  it.live("keeps native credentials and canonical auth synchronized", () =>
    Effect.gen(function* () {
      yield* setup()
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      const database = yield* Database.Service
      yield* auth.set(providerID, oauth)
      const native = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "native-key" }),
      })
      expect((yield* database.db.select().from(CredentialTable).all()).map((row) => row.id)).toContain(native.id)
      expect(yield* auth.get(providerID)).toEqual({ type: "api", key: "native-key" })
      yield* auth.set(providerID, oauth)
      const replacement = (yield* credentials.list(integrationID))[0]!
      expect(replacement.id).not.toBe(native.id)
      expect(replacement.value).toMatchObject({ type: "oauth", access: oauth.access })
      yield* credentials.remove(replacement.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
      expect(yield* auth.get(providerID)).toBeUndefined()
    }),
  )
})
