# Superpowers integration

Superpowers is tracked as the `vendor/superpowers` Git submodule from
<https://github.com/obra/superpowers.git>. The initial revision is v6.3.0
(`b36e0829c6d0140e93cfef2ca599b1b07d4a7797`). The parent repository pins the
revision; builds do not follow upstream automatically.

Initialize the submodule before developing or building:

```sh
git submodule update --init --recursive -- vendor/superpowers
```

Remote Nix source installs use a Git flake URL with `submodules=1`, as shown in
the contributor guide. Nix's `github:` archive fetcher does not include
submodules ([upstream issue](https://github.com/NixOS/nix/issues/14982)). CI
initializes the submodule before builds; Nix sources include it explicitly.

To update deliberately, check out a reviewed upstream revision inside the
submodule, rerun the Core checks, and commit the updated Git link in the parent
repository. Keep local adaptations outside the submodule.

## Runtime integration

Core's native `superpowers` plugin embeds selected upstream Markdown through
the existing skill service. These instructions remain available when the built
application opens a different project or runs without the source checkout.
The upstream legacy OpenCode plugin is not loaded: its config hooks and `task`
mapping do not match this project's V2 runtime.

| Agent                                   | Skills and scope                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MasterAgent (`parallel-master`)         | `superpowers:dispatching-parallel-agents` for independent task decomposition, self-contained worker briefs, and result review.                                                                                          |
| OperatingAgent (the OperatingChat host) | `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:systematic-debugging`, and `superpowers:verification-before-completion` for operations, research, planning, design, diagnosis, and verification. |

MasterAgent loads its skill before dispatching. The host's existing contract
remains authoritative: one `task_batch` call per dependency wave, disjoint owned
paths, a manifest, and the exact result barrier before the next wave. Skill
access does not grant shell access, direct implementation, or new worker types.

OperatingAgent's host instructions prohibit writing application code, tests,
scripts, or implementation snippets inside plans. It may write planning and
design documents and perform authorized non-coding operations. It describes
implementation requirements and acceptance checks in prose, then hands coding
work to MasterAgent and its workers. Upstream instructions to implement or use
coding workflows do not expand this role.

This is a host instruction boundary, not a new filesystem sandbox. Existing
OperatingChat tool permissions remain in force so authorized operations and
document editing continue to work. Ordinary coding sessions keep their existing
role. The persisted OperatingChat context includes the instructions so existing sessions
refresh their private baseline without a reset.

Only the five selected skill documents are bundled. Upstream helper scripts,
visual-companion servers, and auxiliary files are not runtime assets. The adapter
instructs agents to use available native tools and not resolve synthetic
`/builtin` paths as real files. Coding execution, TDD, worktree management, and
branch finishing are not installed as part of this integration.

## Verification

Run from `packages/core`:

```sh
bun test test/plugin/superpowers.test.ts test/agent.test.ts test/session-runner-system-context.test.ts
bun typecheck
```

The checks cover native skill registration, MasterAgent skill permissions,
OperatingChat-only guidance, and upgrades of existing private context baselines.
Local validation also confirms that a Bun bundle embeds all five upstream skill
documents. Nix evaluation requires a host with Nix installed.
