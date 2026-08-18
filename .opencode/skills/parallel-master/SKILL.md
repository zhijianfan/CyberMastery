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
  ChatGPT/Codex OAuth provider) and disables `task`/`skill`.
- Prerequisite: the worker model needs the openai provider authorized once
  (`opencode auth login` → OpenAI → ChatGPT Pro/Plus). If it is not logged
  in, stop before Phase 2 and tell the user.
- If the user's providers differ, edit `.opencode/agent/parallel-master.md`
  and `.opencode/agent/parallel-worker.md` first and say so.

## Inputs (either one)

1. **A coding assignment** — a description of what to build.
2. **A folder of task files** — e.g. `devplan/`, `specs/<plan>/tracks/`, or a
   user-given directory where each file describes one task/track.

## Phase 1 — Plan

1. For an assignment: decompose it into N small, independent tasks with
   disjoint file ownership. For a task folder: each file is one task.
2. For every task extract: goal, in-scope files (explicit list), acceptance
   criteria, dependencies on other tasks (prefer none).
3. Write a manifest to `.opencode/parallel/<run-id>/MANIFEST.md`:

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
  - Edit ONLY the files listed as your owned files. Never touch other files,
    shared configs, lockfiles, or generated code.
  - Read any existing code you need first; follow the repo conventions in the
    effect skill (Effect v4 patterns, .js import suffixes, bun workspace).
  - Do not run repo-wide builds, typechecks, or tests — the master integrates
    and tests. Running a quick targeted check of your own code is allowed.
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
3. Overlapping/conflicting edits, merge errors, or failed tasks: fix as
   master, or re-spawn that single task with corrective context (same
   `subagent_type`, foreground is fine for a single re-run).

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
