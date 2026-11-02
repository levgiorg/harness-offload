# Commands

| | |
|---|---|
| **`offload read`** | Answers questions about big files, directories or `file:START-END` ranges. Files go to the worker line-numbered; answers must cite `path:Lx-Ly` with a verbatim quote, and every quote is verified locally (`⚠unverified` otherwise). |
| **`offload explore`** | A read-only cheap agent (read/grep/glob, never secrets) searches the repo itself: "where/how is X done?" |
| **`offload run -- CMD`** | Runs noisy commands. Short output passes through; long output becomes a digest — model summary + **verbatim error lines picked by a script** + tail + full-log path. Exit code preserved. |
| **`offload summarize`** | The same digest for stdin or a file: `git log -p \| offload summarize -q "what changed in auth?"` |
| **`offload write`** | Generates pattern-following code (tests, configs, stubs) from a reference file, optional `--check 'npm test …'`. |
| **Read guard** (hooks) | Blocks a *full* read of a file over 600 lines / ~6K tokens — Read tool and `cat`/`head`/`sed -n` dumps alike — and answers with a **symbol outline** plus ready-to-run options, so the agent jumps straight to a targeted slice. |
| **Output digest** (hooks) | When a successful command prints more than 250 lines, the agent gets the digest instead (full output kept in a log). |
| **MCP server** | `offload mcp` exposes `offload_read`, `offload_explore`, `offload_run`, `offload_summarize`, `offload_write`, `offload_ask`, `offload_outline` to any MCP client. |
| **Report** | `offload dashboard --open` writes an offline HTML report: tokens kept out of context per day, by kind and model, failures, and every delegation with its citation check. |

## Reference

```text
offload read -q QUESTION PATH...        offload setup               offload install <host...>
offload explore QUESTION                offload doctor [--ping]     offload uninstall <host...>
offload run [-q FOCUS] -- CMD...        offload models [BACKEND]    offload stats [--days N]
offload summarize [-q FOCUS] [FILE]     offload config show|set|trust offload mcp
offload dashboard [--open] [--sample]   offload demo
offload write --spec S --ref F [--out P] [--check CMD]
offload ask [--stdin|-f FILE] QUESTION  offload outline FILE           offload statusline · offload sync
```

Status line: add `"statusLine": {"type": "command", "command": "offload statusline"}` to your Claude Code
settings to see `▌offload 12 · ~48.2k saved today`.

Exit codes: `0` ok · `2` usage · `10` quota · `11` auth · `12` timeout · `13` unknown model ·
`14` worker error · `15` backend missing · `16` refused (secrets/size). `offload run` returns the
command's own code; `offload write --check` returns `1` when the check fails.

## Troubleshooting

`offload doctor` (add `--ping` for one live call per model, `--reset` to clear cooldowns) ·
`OFFLOAD_DEBUG=1` for hook errors · `OFFLOAD_DEBUG_DIR=/tmp/x` (bash hooks) keeps every hook input.
