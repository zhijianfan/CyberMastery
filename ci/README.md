# CI — Parallel Test Pipeline

Implementation of `devplan/testing/AutomationTestPlan_Parallel.md` (testing plan for the
custom OpenCode web server, parallel development model).

## Layout

```
ci/
├── README.md            # this file
├── tracks.json          # single source of truth: CI job -> concrete test commands
├── workflows/
│   └── test.yml         # GitHub Actions workflow: 9 parallel jobs + gates
└── scripts/
    └── run-track.sh     # executes one job's commands from tracks.json
```

## How it works

1. `ci/tracks.json` declares each CI job as a list of commands
   (`label`, `cwd`, `run`, `timeoutMinutes`, optional `env`, optional `disabled`).
   This is where the plan's generic tracks were filled out with the actual
   packages and test commands of this repository.
2. `ci/workflows/test.yml` runs the 9 jobs from the plan in parallel and a
   10th `gates` job that only passes when all 9 pass (use it as the single
   required status check for branch protection).
3. Each job calls `bash ci/scripts/run-track.sh <job-id>`, which executes the
   commands sequentially with per-command timeouts.

## Job → plan → repository mapping

| Job | Plan section | Where it runs in this repo |
| --- | --- | --- |
| 1. static-analysis | #3 Job 1 | `oxlint` + `bun typecheck` (turbo, all packages) |
| 2. contract | #5 | schema tests, protocol tests, sdk-next tests, `check:generated` (client), `test:httpapi` gates |
| 3. backend-unit | #3 Job 3 | core, llm, effect-drizzle-sqlite, http-recorder, httpapi-codegen, codemode, enterprise |
| 4. frontend-unit | #3 Job 4 | ui, session-ui, client, tui, app `test:unit` |
| 5. platform-integration | #6–#9, #12 | full opencode suite (workspace/layout, functionality runtime, permission, operation/event, storage, server) |
| 6. feature-integration | #10–#11 | chat (`test/session`, `test/agent`), MCP (`test/mcp`), screenshot (`test/image`), canvas (`app test:browser`) |
| 7. browser-e2e | #3 Job 7 | playwright suite in packages/app |
| 8. security | #8, #13 | gitleaks secret scan, `bun audit`, permission enforcement tests |
| 9. performance | #10, #14 | `bench:test` (backend), `test:bench` (frontend) |
| 10. integration-gates | #17 | requires all 9; aggregates contract/boundary/regression/security gates |

## Activation

GitHub only executes workflows from `.github/workflows/`. Copy the workflow:

```sh
cp ci/workflows/test.yml .github/workflows/test-parallel.yml
```

It intentionally coexists with the existing `test.yml` (legacy sequential
pipeline) while the parallel one is validated.

## Local usage

```sh
# requires bash, jq, bun
bash ci/scripts/run-track.sh contract
bash ci/scripts/run-track.sh backend-unit
bash ci/scripts/run-track.sh security   # requires gitleaks on PATH
```

## Missing parts filled out

The plan was generic; these were filled in against this repository:

- Mapped every plan track to concrete package test commands in `tracks.json`.
- Added `"test"` scripts to packages that had tests but no script:
  `packages/schema`, `packages/protocol`, `packages/enterprise`
  (`bun test --only-failures` with package-appropriate timeouts).
- Contract job wires `packages/client check:generated` (generated SDK
  correctness, plan #5 SDK Contract Tests) and `packages/opencode test:httpapi`
  (endpoint compatibility exerciser gates).
- Security job uses a pinned gitleaks binary, `bun audit` for dependency
  scanning, and the opencode permission enforcement tests for the
  grant/revoke/forge/cross-workspace matrix (plan #8).
- Performance job uses the existing `bench:test` / `test:bench` suites and
  the metrics defined in `perf/test-suite.md`.

## Known gaps (TODO)

- **Failure injection track (#15)**: no chaos suite exists. `tracks.json`
  already defines the `failure-injection` job as `disabled` with the planned
  home `packages/opencode/test/failure-injection`; implement it, then enable.
- **Phase 0 mocks (#T0.3)**: Mock LLM / MCP server / artifact store / event
  server / SDK are not implemented yet. The opencode suite uses its own
  fixtures (`test/fake`, `test/fixture`); a shared mock layer is still TBD.
- **Canvas perf measurements (#10)**: 12-block render, FPS, memory, suspended
  blocks are not measured yet; only `app test:bench` exists.
- **App stream placeholder (#11)**: block/unavailable-state tests TBD when the
  `builtin:application-window-stream` functionality lands.
- **Client cache / IndexedDB organizer tracks (#12)**: covered partially by
  `opencode test/storage` and `effect-drizzle-sqlite`; a dedicated organizer
  suite does not exist yet.
- **API fuzzing (#13)**: only the httpapi exerciser gates exist; property-based
  fuzzing of the HTTP API is TBD.
- **Packages with no tests at all**: `server`, `web`, `desktop`, `function`,
  `plugin`, `sdk`, `stats`, `identity`, `console`, `slack` — add suites, then
  register them in the matching job in `tracks.json`.
- **OS matrix**: the parallel workflow runs Linux only. The existing `test.yml`
  keeps Windows coverage; add a matrix to `ci/workflows/test.yml` if the
  parallel pipeline should own it.
