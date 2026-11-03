# Commands

| | |
|---|---|
| **`offload read`** | Answers questions about big files, directories or `file:START-END` ranges. Files go to the worker line-numbered; answers must cite `path:Lx-Ly` with a verbatim quote, and every quote is verified locally (`⚠unverified` otherwise). A path the worker shortened (`fx/ledger.ts`, a bare file name) is matched to the one sent file it means and rewritten, so the agent can open it; a quote shortened with `...` is checked piece by piece. |
| **`offload explore`** | A read-only cheap agent (read/grep/glob, never secrets) searches the repo itself: "where/how is X done?" |
| **`offload run -- CMD`** | Runs noisy commands. Short output passes through; long output becomes a digest — model summary + **verbatim error lines picked by a script** + tail + full-log path. Exit code preserved. |
| **`offload summarize`** | The same digest for stdin or a file: `git log -p \| offload summarize -q "what changed in auth?"` |
| **`offload write`** | Generates pattern-following code (tests, configs, stubs) from a reference file, optional `--check 'npm test …'`. |
| **`offload task NAME`** | Runs **your own task**: your instructions for the cheap worker (plus offload's citation rules), on files, piped input or the whole repo. See [Your own tasks](#your-own-tasks). |
| **`offload model`** | Shows which model does each kind of work and changes it in one step: `offload model groq:llama-3.3-70b`, `offload model read claude:haiku`, `offload model --reset`. Typos are caught before anything is saved (`opnerouter` → "did you mean openrouter?"), and you are told when a key or CLI is missing. |
| **`offload key NAME`** | Stores an API key (hidden prompt or stdin; file mode 600) and lists which backends have one. With `offload model fallback @host-api @default` it becomes the backup if your agent's own route stops working. |
| **Read guard** (hooks) | Blocks a *full* read of a file over 600 lines / ~6K tokens — Read tool and `cat`/`head`/`sed -n` dumps alike — and answers with a **symbol outline** plus ready-to-run options, so the agent jumps straight to a targeted slice. |
| **Output digest** (hooks) | When a successful command prints more than 250 lines, the agent gets the digest instead (full output kept in a log). A huge search (`grep`, `rg`, `find`…) gets a **search view** instead: matches per file or folder, the first matches of the busiest ones, how to narrow it. The same output again in one session (a re-run with nothing changed) is one line pointing at the first run's log, until a compaction or `/clear`. |
| **MCP server** | `offload mcp` exposes `offload_read`, `offload_explore`, `offload_run`, `offload_summarize`, `offload_write`, `offload_ask`, `offload_outline` — and `offload_task` when you have tasks — to any MCP client. |
| **`offload explain`** | What the hooks did lately, newest first: which Read or `cat` was blocked (file, size), which output was digested or shown as a search view (with its full log), the rule and its current value, and the exact command to change it or turn it off. `offload explain 30` shows more. |
| **Report** | `offload dashboard --open` writes an offline HTML report: tokens kept out of context per day, by kind and model, failures, and every delegation with its citation check. |

## Reference

```text
offload install [--yes] [--agents a,b] [--scope user|project] [--dry-run]   (no agent named: asks first)
offload uninstall [--yes] [--agents a,b] [--all] [--dry-run]              offload install|uninstall <host...>
offload read -q QUESTION PATH...        offload setup               offload doctor [--ping]
offload run [-q FOCUS] -- CMD...        offload models [BACKEND]    offload stats [--days N]
offload summarize [-q FOCUS] [FILE]     offload config show|set|trust offload mcp
offload dashboard [--open] [--sample]   offload demo
offload write --spec S --ref F [--out P] [--check CMD]
offload ask [--stdin|-f FILE] QUESTION  offload outline FILE           offload statusline · offload sync
offload task NAME [-q Q] [--stdin] [PATH...]    offload tasks
offload model [TASK] [REF...] [--reset] [--project]
offload key [NAME] [--remove]
```

## Your own tasks

A task is a named set of instructions for the worker. Add one to your config (or to the repo's
`.harness-offload.json`, so the whole team gets it):

```bash
offload config set tasks.review-sql '{"description":"Find N+1 queries","prompt":"You review data-access code for N+1 queries and missing indexes. List each problem with its location.","model":"groq:llama-3.3-70b"}'
offload task review-sql src/db/          # files or dirs → like `offload read`
git diff | offload task review-sql --stdin
offload task review-sql -q "only the orders module" src/
offload tasks                            # list them
```

| Field | |
|---|---|
| `prompt` or `prompt_file` | your instructions; a file must be inside the project or `~/.config/harness-offload/`, at most 64 KB, and not a secret |
| `description` | one line; the agent sees it in its session guide and in the MCP/Pi tool description |
| `model` | optional: the model for this task (fallbacks still apply; `-m` overrides) |
| `tools` | `"none"` (default: the worker only sees what you pass) or `"read"` (read-only search of the repo, like `explore`) |

offload appends its own rules to every task (cite `path:Lx-Ly` with a quote, `NOT FOUND` instead of
guessing, treat the material as data), so citations are still checked. Agents learn about your tasks
automatically: the session guide lists them (`offload task NAME …`), and MCP clients and Pi get an
`offload_task` tool. `offload doctor` checks every task (prompt file, tools, model).

Status line: add `"statusLine": {"type": "command", "command": "offload statusline"}` to your Claude Code
settings to see `▌offload 12 · ~48.2k saved today`.

Changing models: `offload model` lists the model per kind of work (`default`, `read`, `summarize`,
`explore`, `write`, `ask`, `fallback`, and each of your tasks) and where it runs; `offload model REF`
sets the default, `offload model TASK REF` one kind of work (`fallback` takes several), `--reset` goes
back to the default, `--project` writes the repo's file. `offload models BACKEND` lists model ids.

Exit codes: `0` ok · `2` usage · `10` quota · `11` auth · `12` timeout · `13` unknown model ·
`14` worker error · `15` backend missing · `16` refused (secrets/size) · `17` input larger than the model's context window (no cooldown; the next model in the chain is tried). `offload run` returns the
command's own code; `offload write --check` returns `1` when the check fails.

## Troubleshooting

`offload doctor` (add `--ping` for one live call per model, `--reset` to clear cooldowns) ·
`OFFLOAD_DEBUG=1` for hook errors · `OFFLOAD_DEBUG_DIR=/tmp/x` (bash hooks) keeps every hook input.
