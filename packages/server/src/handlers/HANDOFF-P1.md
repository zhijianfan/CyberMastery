# HANDOFF — Task P1 (Typed Protocol Group + Thin Server Handlers)

Base commit: `2d913472a` (feature/CyberMaster). Effect pinned at `4.0.0-beta.83`
(catalog), Bun 1.3.14. Wave 1 lane S1 (`packages/schema/src/ctxpack.ts`) is the
schema source of truth; this task touches only the five owned files below.

## Files changed

All NEW files; nothing else was modified, and no git writes were made.

- `packages/protocol/src/groups/ctxpack.ts` — frozen group `server.workspace.ctxpack`,
  root `/api/workspace/:workspaceID/ctxpack`, with the seven frozen endpoints
  (create/get/list/patch/remove/restore/materialize), the ten frozen error classes
  (TaggedErrorClass, httpApiStatus per the brief), the list query schema with the
  frozen defaults, the CAS revision payload, and the materialize request/result
  schemas.
- `packages/server/src/handlers/ctxpack.ts` — thin handler layer: derives the actor
  from `requestUser` + path params, forwards each endpoint's decoded payload to
  exactly one method of the two frozen local handler-service interfaces, and maps
  domain `_tag`s onto the protocol error schemas. No business logic.
- `packages/protocol/test/ctxpack-group.test.ts` — 19 tests (group surface, paths,
  params/payload/success/error schemas, list-query defaults + validation, materialize
  key set, error round-trips).
- `packages/server/test/ctxpack-handler.test.ts` — 11 tests through the in-memory
  HttpApiTest client with recording fakes (one-service-method-per-endpoint, actor
  derivation, `includeDeleted=false`, no header/token leakage, 409/404 error mapping,
  materializer never touches the pack service).
- `packages/server/src/handlers/HANDOFF-P1.md` — this file.

## Tests

Gates (both green, 30/30):

```bash
cd packages/protocol && $BUN test --only-failures test/ctxpack-group.test.ts   # 19 pass
cd packages/server  && $BUN test --only-failures test/ctxpack-handler.test.ts  # 11 pass
```

`$BUN` = `$HOME/.bun-npm/node_modules/@oven/bun-windows-x64/bin/bun.exe`.
Full-package typecheck: `bun run tsgo --noEmit` in both packages reports **0 errors**.

## Public exports

- From `@opencode-ai/protocol/groups/ctxpack` (all exported): `CtxPackGroup`,
  `CtxPackNotFoundError`, `CtxPackDeletedError`, `CtxPackRevisionConflictError`,
  `CtxPackContentChangedError`, `CtxPackInvalidSelectionError`,
  `CtxPackBudgetExceededError`, `CtxPackSecretSourceDeniedError`,
  `CtxPackCrossWorkspaceDeniedError`, `CtxPackPermissionDeniedError`,
  `CtxPackSearchCursorInvalidError`, `CtxPackListQuery`, `CtxPackRevisionPayload`,
  `CtxPackMaterializeRequest`, `CtxPackMaterializeResult`.
- From `packages/server/src/handlers/ctxpack.ts`: `CtxPackHandler` (handler layer),
  `CtxPackHandlerService` + `CtxPackMaterializerHandlerService` (the two local
  handler-service Effect Context tags, ids `@opencode/v2/CtxPackHandlerService` and
  `@opencode/v2/CtxPackMaterializerHandlerService`), and the two frozen interfaces
  (exported so the handler test can type its fakes).
- SDK surface after M1: `client.v2.workspace.ctxpack.<name>`.

## Central integration actions (for M1 — list only, NOT done here)

1. Add `CtxPackGroup` to `packages/protocol/src/api.ts` (group id
   `server.workspace.ctxpack`).
2. Mount `CtxPackHandler` in the server composition (e.g. alongside
   `WorkspaceMasterAgentHandler`). The group service key
   (`effect/httpapi/HttpApiGroup/server.workspace.ctxpack`) derives solely from the
   group identifier, so the layer mounts unchanged; once composed, the handler can
   be rebuilt against the shared server `Api` (see Assumptions/Limitations).
3. Swap the handler-local service tags: re-provide `CtxPackHandlerService` /
   `CtxPackMaterializerHandlerService` from `@opencode-ai/core/ctxpack/service`
   (`CtxPackService.Service`) and `@opencode-ai/core/ctxpack/materialize`
   (`CtxPackMaterializer.Service`); the handler file itself does not change.
4. Regenerate / hand-mirror the SDK.

## Assumptions

- **Local Api in the handler** (deviation from the inlined pattern, required for
  today's gates): `HttpApiBuilder.group` resolves `api.groups[groupName]` at layer
  build time and `handlers.handle` reads `group.endpoints[name]` from it, so the
  layer cannot be built against the composed server `Api` until M1 composes the
  group. `CtxPackHandler` is therefore built against
  `HttpApi.make("server").add(CtxPackGroup)` (a local Api holding the frozen group).
  The master-agent handler's own comment confirms the group service key derives
  solely from the group identifier, so this mounts unchanged at M1; swapping the
  `Api` import to the composed one afterwards is a one-line cleanup.
- **Effect 4 beta idioms** (the brief's `.pipe(Schema.optional, Schema.withDefault)`
  is effect-3 syntax): defaults use `Schema.withDecodingDefaultTypeKey(Effect.succeed(v))`;
  there is no `BooleanFromString`, so `includeDeleted` is a
  `Schema.Literals(["true","false"])` → `Schema.Boolean` transform via the two-arg
  `Schema.decodeTo(to, { decode, encode })` with `SchemaGetter.transform`
  (mirrors `NumberFromString`); `Schema.Union`/`Schema.Literals` take arrays.
- **Every endpoint declares the full frozen error set** because the handler's
  `toHttpError` maps the full domain union (service errors are `unknown` per the
  frozen interface) and the endpoint error list must be a superset of the handler's
  error type. M1 may refine per-endpoint lists.
- **Cursor format**: wire-level cursor is a plain string validated as non-empty
  base64url at decode time (decode failure → typed `InvalidRequestError` via
  `SchemaErrorMiddleware`), matching the repo's session-cursor convention
  (`groups/session.ts`). Semantic cursor validity stays with the service
  (`CtxPackSearchCursorInvalidError`). If C1's real cursors are not base64url, relax
  `CtxPackListCursor` in the group during M1.
- **Error-schema id fields are plain `Schema.String`** (not branded `CtxPack.ID`):
  domain errors carry plain strings and the handler must construct the error
  payloads without re-validating.
- **Materialize request shape is provisional**: the schema package (S1) does not
  define `CtxPackMaterializeRequest`, so the group defines
  `{ label: string; fragmentIDs?: FragmentID[] }` locally. The five-field result
  shape is frozen and never carries capsule contents. Reconcile the request shape
  with C1 during M1.
- **Handler-service tags are function-style `Context.Service` keys** rather than
  class declarations: in effect 4.0.0-beta.83, class-style
  `Context.Service<Self, Shape>()(id)` requires a Shape type distinct from the
  frozen interface name (a same-named merged interface would make `Layer.succeed`
  demand the class instance type). Function-style keys have identical runtime
  semantics and the same ids.
- **Request-size limit**: the create body rides the repository's existing bounded
  JSON middleware; no extra body reading in the handler.

## Known limitations

- The CtxPack group is not yet part of `packages/protocol/src/api.ts` or the server
  composition (that is M1's action 1–2); the SDK is not generated.
- `get` is `includeDeleted=false`-only by contract; list `includeDeleted` filtering
  is the service's concern.
- `CtxPackMaterializeRequest.fragmentIDs` uses `Schema.optional` (absent-OR-undefined
  key on the wire) — provisional until C1 lands.
- Unknown/foreign domain error `_tag`s map to `CtxPackPermissionDeniedError`
  (operation "unknown") as a safe 4xx fallback, mirroring the master-agent handler's
  default branch; C1's errors are expected to be exactly the ten frozen tags.

## Prohibited-pattern scan

`grep` over the owned handler file for forbidden logic: no `search`, no permission
checks (no `requireAccess`/authorization service), no SQL/FTS (no `sql`/`fts`/`like`/
`query(` builders), no materialization logic — the materialize handler only forwards
to `CtxPackMaterializerHandlerService.materialize`. Handlers contain exactly the
actor derivation, one service call per endpoint, and error mapping; the tests prove
the single-seam property by making every un-stubbed service method die on invocation
and by providing no other dependencies.
