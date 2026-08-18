# OpenCode Backend — Feature Spec (compacted context)

Generated: 2026-08-18. Verified against the installed CLI (`opencode --help` + subcommand helps), not docs. Injection-ready for agent sessions orchestrating OpenCode.

## 0. Source / versions
| Item | Value |
|---|---|
| Binary | `C:\Users\Administrator\AppData\Roaming\npm\opencode` (v1.18.18) |
| Hermes skill | `…\skills\autonomous-ai-agents\opencode\SKILL.md` (v1.2.0) — flags consistent ✅; skill omits newer server/auth flags below |

## 1. Entry points
| Command | Purpose | Notes |
|---|---|---|
| `opencode [project]` | TUI (default) | needs `pty=true`; exit **Ctrl+C**, never `/exit` (opens agent picker) |
| `opencode run [msg..]` | One-shot non-interactive | no pty; `--format json` = raw event stream |
| `opencode serve` | Headless server | `--port`(0=random) `--hostname`(127.0.0.1) `--mdns`/`--mdns-domain opencode.local` `--cors` |
| `opencode web` | Server + web UI | same server flags |
| `opencode attach <url>` | Client to running server | e.g. `http://localhost:4096`; pairs with `run --attach` |
| `opencode acp` | Agent Client Protocol server | default cwd here = `D:\OpencodeDev` |
| `opencode mcp` | MCP mgmt | `add/list(ls)/auth/logout/debug <name>` (OAuth-capable) |
| `opencode agent` | Agent mgmt | `create/list` |
| `opencode providers` (alias `auth`); `models [provider]` | Providers, creds, model list | |
| `opencode stats` | Token usage + cost | e.g. `stats --days 7 --models <m>` |
| `opencode session`, `db [query]` | `list/delete <id>`; sqlite shell (`db path`, `--format json\|tsv`) | |
| `opencode export [id]` / `import <file\|url>` | Session JSON handoff | cross-machine portable |
| `opencode pr <number>`; `github` | PR checkout + review; GitHub agent | |
| `opencode plugin <module>`; `debug`; `upgrade`; `uninstall`; `completion` | Ops | `--pure` disables plugins |

## 2. `run` flags (machine-orchestration surface)
`-m/--model provider/model` · `-c/--continue` · `-s/--session <id>` · `--fork`(needs -c/-s) · `-f/--file`(array) · `--format default|json` · `--agent` · `--variant high|max|minimal` · `--thinking` · `--title/--share` · `--attach <url>`(then `--dir`=**remote** path) · `-p/--password`+`-u/--username` (env `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME`, default user `opencode`) · `--port` · `--dir` · `-i/--interactive` · `--auto`(auto-approve **dangerous** ❌)

## 3. Verdicts (Hermes-orchestration)
| Option | Verdict | Rationale / effort |
|---|---|---|
| One-shot `opencode run` bounded tasks | ✅ | simplest, no pty, json parseable — default |
| Background TUI iterative work | ✅ | `pty=true` + `process(submit/poll/log)`; exit `\x03`/kill |
| `serve` + `attach` long-lived farm | ✅ 1–2d setup | stateless clients, basic-auth; needs port/hostname planning |
| `acp` bridge | ⚠️ niche | only for ACP-speaking clients; host cwd `D:\OpencodeDev` |
| `--auto` permission bypass | ❌ | silently grants everything, defeats sandboxing |
| `/exit` in TUI | ❌ | not a command — opens agent selector; use Ctrl+C |

## 4. Caveats
- TUI needs pty; `run` doesn't. Enter may need 2 presses in TUI.
- PATH may resolve wrong binary — pin (`which -a opencode`; `$HOME/.opencode/bin/opencode`).
- Parallel sessions: isolated workdirs/worktrees only (shared dir = collisions).
- `--attach`+`--dir` = remote paths; no local file transfer implied.
- Skill v1.2.0 predates `--fork/--share/--variant/--interactive`, `export/import`, `github` → trust CLI flags for surface, skill for workflows (PR review, resume, cost).

## 5. Recommendation ladder
1. Bounded → `opencode run '<prompt>' -f <file> --format json` in repo workdir; verify `OPENCODE_SMOKE_OK`.
2. Iterative → background TUI (`pty=true`), monitor with `process`, exit `\x03`.
3. Persistent farm → `serve --port 4096` + `run --attach`, basic-auth via env.
4. Cross-machine → `export`/`import` session JSON.

Next action: smoke-test `opencode run 'Respond with exactly: OPENCODE_SMOKE_OK'` before first real delegation.