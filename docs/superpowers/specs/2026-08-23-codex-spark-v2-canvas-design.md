# Codex Spark V2 Canvas Exposure Design

## Goal

Guarantee that `openai:gpt-5.3-codex-spark` is exposed through the Session V2 model catalog after a ChatGPT Plus/Pro OAuth connection and is selectable from the canvas primary model, Subagent, and OperatingAgent selectors.

## Existing Behavior

The authoritative models.dev catalog already contains `gpt-5.3-codex-spark` under the `openai` provider. The V2 ModelsDev plugin projects catalog models generically, Catalog exposes enabled models for connected providers, the server returns those available providers and models, and the app builds one shared canvas model catalog from connected providers.

The V2 session runner already detects an OpenAI OAuth credential, routes OpenAI Responses requests through the ChatGPT Codex backend, adds the `originator` and optional `ChatGPT-Account-Id` headers, and uses the OAuth access token as bearer authentication. Legacy OpenCode separately allows the same Spark model through its ChatGPT OAuth filter.

The implementation therefore formalizes and protects an existing path. It does not introduce a second model registration mechanism.

## Scope

- Cover the exact model identity `openai:gpt-5.3-codex-spark`.
- Require an active OpenAI connection created by either ChatGPT Plus/Pro OAuth method.
- Expose the model through the V2 provider and model catalog consumed by the app.
- Show the model in the canvas primary model, Subagent, and OperatingAgent selectors.
- Persist and dispatch the exact provider and model IDs selected in each surface.
- Route execution through the existing ChatGPT OAuth transport without model substitution.
- Preserve the current refresh and error behavior.

## Non-goals

- Do not hardcode a synthetic Spark entry in the app.
- Do not add a V2 copy of the legacy OpenAI OAuth allowlist.
- Do not add or change Protocol, Server HttpApi, Schema, or generated client types.
- Do not change the OpenCode Zen `opencode:gpt-5.3-codex-spark` path.
- Do not add a Spark-specific picker, badge, icon, default, fallback, or feature flag.
- Do not add reasoning-effort selection to the canvas model picker.
- Do not change model pricing, limits, or capabilities reported by models.dev.

## Architecture

The existing path remains the only source of truth:

```text
models.dev openai/gpt-5.3-codex-spark
  -> ModelsDevPlugin catalog projection
  -> Catalog.model.available()
  -> V2 provider/model endpoints
  -> normalizeProviderList()
  -> useProviders().connected()
  -> shared CanvasModelCatalogItem[]
  -> primary, Subagent, and OperatingAgent selectors
```

The model is available only when the OpenAI provider is available through an active integration connection. Canvas does not apply a second model eligibility policy. It receives the server-authoritative connected catalog and shares the same ordered array with all three selectors.

## Selection and Execution

The primary selector persists `openai:gpt-5.3-codex-spark` through the existing workspace model key path.

The Subagent selector persists:

```ts
{ providerID: "openai", modelID: "gpt-5.3-codex-spark" }
```

The OperatingAgent selector persists the same `openai:gpt-5.3-codex-spark` model key through the existing operating-agent configuration path.

When a V2 Session resolves this model with an OpenAI OAuth credential, the runner keeps the catalog API model ID `gpt-5.3-codex-spark`, changes the base URL to `https://chatgpt.com/backend-api/codex`, adds `originator: opencode`, adds `ChatGPT-Account-Id` when the credential contains an account ID, and applies bearer authentication with the OAuth access token. It must not silently substitute `gpt-5.3-codex` or another model.

## Refresh and Failure Behavior

- A successful provider refresh reloads models.dev and updates the shared picker catalog through the existing synchronization path.
- A refresh failure preserves the last usable catalog and the current selection.
- If Spark is absent, disabled, or no longer available for the connected provider, the app does not synthesize it.
- Selecting a model never changes authentication state or initiates OAuth.
- Missing or expired authorization uses the existing integration refresh and authorization errors.
- An unavailable selected model produces the existing model-unavailable error.
- No failure silently falls back to a different provider or model.

## Test Strategy

### V2 catalog contract

Add focused Core coverage proving that the models.dev OpenAI Spark entry projects to an enabled V2 model with the exact provider ID, model ID, display name, family, capabilities, limits, and OpenAI AI SDK package. With an active OpenAI OAuth integration connection, `Catalog.model.available()` must contain that entry.

### OAuth routing contract

Add focused Session runner coverage resolving the exact Spark model with an OAuth credential. Assert the exact model ID, ChatGPT Codex base URL, bearer token, `originator` header, and optional account header. Assert no model substitution.

### App synchronization contract

Extend provider normalization coverage with the exact Spark model and an active OpenAI credential connection. Assert the normalized OpenAI provider is connected and retains the exact Spark identity and catalog metadata.

### Canvas contract

Extend the canvas integration fixture with `GPT-5.3 Codex Spark`. Assert that the primary, Subagent, and OperatingAgent picker popups each list `openai:gpt-5.3-codex-spark`. Selecting it must call each existing persistence boundary with the exact value appropriate to that selector.

Existing generic refresh tests remain the authority for pending, success, failure, retry, and last-catalog preservation behavior; they should not be duplicated solely for the Spark model.

## Implementation Boundary

No production behavior change is expected. The implementation adds exact regression coverage around the existing catalog, OAuth route, app normalization, and shared canvas picker path. If a new test exposes a real gap, fix only the narrowest existing layer responsible for that contract; do not add model-specific UI data or a parallel registry.

Because no public Protocol or Server HttpApi changes are planned, the client generator must not run and generated sources must not be edited.

## Verification

Run Core checks from `packages/core`:

```sh
bun test test/plugin/models-dev.test.ts test/session-runner-model.test.ts
bun typecheck
```

Run app checks from `packages/app`:

```sh
bun test src/context/global-sync/utils.test.ts
bun test src/pages/canvas/master-agent.integration.browser.test.tsx
bun typecheck
```

The repository root test command must not run.
