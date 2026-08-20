---
name: parallel-master
description: Orchestrate parallel implementation of a coding assignment or a folder of task files. A stronger-model master (DeepSeek v4 Pro) plans and oversees; each task is implemented in parallel by a weaker-model worker subagent (gpt-5.3-codex-spark, agent parallel-worker) restricted to only its own task's files; the master integrates and runs typecheck/tests only after ALL workers have returned. Use when a coding assignment, or a directory of task files, should be executed in parallel.
---

# ParallelMaster

You are the master agent in a parallel implementation run. Your job is to
plan, fan out, integrate, and test — never to implement task code yourself
while workers are running.

## Model tiering (do not change mid-run)

- **Master (you)**: run on the strong model. The `parallel-master` agent pins
  `inferai/deepseek-v4-pro` (DeepSeek v4 Pro).
- **Workers**: spawned via `task` with `subagent_type: "parallel-worker"` —
  the agent pins `openai/gpt-5.3-codex-spark` (opencode's built-in
  ChatGPT/Codex OAuth provider) and denies `task`/`skill` plus all repo
  exploration tools (`read`, `glob`, `grep`, `list`, `webfetch`,
  `websearch`) — only `edit` and `bash` (targeted validation) are allowed.
- Prerequisite: the worker model needs the openai provider authorized once
  (`opencode auth login` → OpenAI → ChatGPT Pro/Plus). If it is not logged
  in, stop before Phase 2 and tell the user.
- If the user's providers differ, edit `.opencode/agent/parallel-master.md`
  and `.opencode/agent/parallel-worker.md` first and say so.

## Inputs (either one)

1. **A coding assignment** — a description of what to build.
2. **A folder of task files** — e.g. `devplan/`, `specs/<plan>/tracks/`, or a
   user-given directory where each file describes one task/track.

## Context discipline (the core rule of this skill)

**The master provides ALL the context a worker needs — and ONLY that context.
Workers are prohibited from exploring the repository and must implement from
the brief alone.**

- Every task file is a SELF-CONTAINED brief. Before writing it, the master
  reads the relevant existing code itself and INLINES into the brief:
  1. goal + exact acceptance criteria
  2. the exact owned-file list (paths the worker may create/edit)
  3. pinned contracts verbatim — function signatures, type/interface shapes,
     union members, endpoint names, event names, schemas. Cross-task contracts
     (e.g. an implementer and a consumer of the same API) must appear
     IDENTICAL in both briefs.
  4. dependency APIs the worker must call — method names, parameter shapes,
     return types — copied from the master's reads, never as "look at file X"
  5. only the repo conventions relevant to this task (import style, Effect
     patterns, naming), with a concrete snippet from the repo where useful
  6. the targeted validation command(s) the worker may run (one package, one
     test file) — never repo-wide
- Rule of thumb: if the worker would need to open a file to learn something,
  the master opens it first and pastes the relevant part into the brief. If
  the brief contains a path that isn't an owned file, that's a bug in the
  brief.
- Do NOT paste unrelated context ("and only that"). Extra context makes the
  weaker model drift.

## Phase 1 — Plan

1. For an assignment: decompose it into N small, independent tasks with
   disjoint file ownership. For a task folder: each file is one task.
2. For every task extract: goal, in-scope files (explicit list), acceptance
   criteria, dependencies on other tasks (prefer none).
3. For every task, gather the context per the Context discipline above (read
   the existing code, capture pinned contracts and dependency APIs).
4. Write a manifest to `.opencode/parallel/<run-id>/MANIFEST.md`:

   ```markdown
   # <run-id>
   | # | task | source | worker | files (owned) | acceptance |
   |---|---|---|---|---|---|
   | 1 | ... | tasks/1.md | 1 | src/a.ts | ... |
   ```

   Re-balance here until tasks have disjoint file ownership. Split any task
   that owns too many files. Show the manifest to the user before Phase 2.

## Phase 2 — Execute (parallel)

For EVERY task, in ONE turn, call the `task` tool once per task:

- `description`: 3-5 words, unique per task
- `subagent_type`: `parallel-worker`
- `background`: `true`
- `prompt`: the task's spec (or the task file's content) plus this exact block:

  ```
  You are worker N of M. Implement ONLY this task.
  - Your ONLY context is this brief. Everything you need — contracts,
    dependency APIs, conventions, snippets — is included below. Do NOT explore
    the repository: your exploration tools (read/glob/grep/list/webfetch/
    websearch) are denied. Do not read files that are not quoted in this
    brief, and do not run repo-wide builds, typechecks, or tests — the master
    integrates and tests.
  - Edit ONLY the files listed as your owned files. Never touch other files,
    shared configs, lockfiles, or generated code.
  - If a detail you need is missing from the brief, do NOT search for it —
    implement against the brief and list the gap as "uncertain" in your
    report.
  - You may run the targeted validation command(s) listed in the brief for
    your own code.
  - Do not wait for, check on, or communicate with other workers.
  - When done, reply with: files changed, what was implemented, what was left
    undone or uncertain.
  ```

Then STOP. Do not poll, sleep, or duplicate any worker's work — you will be
notified as each background task completes.

Requirement: parallel background tasks need
`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` in the environment. If it is
not set, stop after the manifest and tell the user to set it (or run
sequentially, stating that parallelism is lost).

## Phase 3 — Integrate (after ALL workers returned)

1. Verify you received exactly M `task_result`s (one per manifest row).
   A `task_error` counts as returned — treat it in step 3.
2. Review each result: read the diffs (`git status`, `git diff`) for each
   worker's owned files. Reject code that edited files outside its ownership.
   Check the worker's transcript for exploration (grep/glob/read calls) — a
   worker that explored instead of implementing from the brief either got an
   incomplete brief or ignored it; fix the brief and re-spawn that task.
3. Overlapping/conflicting edits, merge errors, or failed tasks: fix as
   master, or re-spawn that single task with a FULLER self-contained brief
   (add whatever the worker's report listed as missing), same
   `subagent_type`; foreground is fine for a single re-run.

## Phase 4 — Test (master only)

1. `bun run typecheck` at the repo root.
2. Run tests for affected packages FROM their package directories (never
   `bun test` at the repo root — the root test script fails by design):
   `bun test` in each changed `packages/*` directory.
3. Fix failures yourself; re-run until green.

## Phase 5 — Report

Table: task → status (✅/❌) → files changed → tests. List anything
unverified. Leave the working tree uncommitted unless the user asked for a
commit; committing is the user's call.
