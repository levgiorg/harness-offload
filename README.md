# Code Offload

> **The harness offloader.** Keep bulk I/O out of your expensive coding agent's context — let the models you already pay for do the heavy lifting.

A Claude Code plugin that hands bulk I/O work — reading big files, digesting noisy command output, exploring a codebase, writing boilerplate — to **cheap models through the [OpenCode](https://opencode.ai) CLI**, using the subscriptions you already have there (OpenCode Go/Zen, ChatGPT Plus/Pro, Copilot, coding plans, local models…). Claude keeps the judgment work; the bulk never enters its context.

No backend service: every delegation is a local call to a tool or API you control.

## What it does

```
Claude ── Read big.ts ───────► [pre-read hook] ── deny + outline + ready-made command
Claude ── cat/head/sed big ──► [pre-bash hook] ── same, for the Bash side door
Claude ── npm run build ─────► [post-bash hook] ─ 30K chars of output ─► digest (+ log path)
Claude ── offload read/explore/run/write ──► opencode run (cheap model, no/readonly tools) ──► short answer
```

| Piece | What happens |
|---|---|
| **`offload read -q Q PATH…`** | Files (or dirs, or `file:START-END`) go to a cheap model with line numbers; the answer cites `path:Lx-Ly` plus a verbatim quote, and **every quote is checked locally** — mismatches are flagged `⚠unverified`. |
| **`offload explore Q`** | A read-only OpenCode agent (read/grep/glob only, secrets denied) searches the repo itself and answers with verified citations. |
| **`offload run -- CMD`** | Runs a noisy command (tests, builds, installs, linters). Small output passes through untouched; large output becomes a digest: cheap-model `STATUS` summary + **verbatim error lines picked by a script** + tail + full-log path. Exit code preserved. |
| **`offload summarize`** | Same digest for text on stdin or a file (`git log -p \| offload summarize -q "what changed in auth?"`). |
| **`offload write --spec S --ref FILE --out NEW`** | Generates pattern-following code (tests, configs, stubs) from a reference file; refuses to overwrite; optional `--check 'npm test -- NEW'`. |
| **`offload ask Q`** | One-off question to the cheap model. |
| **`offload outline FILE`** | Symbol outline with line numbers (no model). |
| **pre-read hook** | Blocks a *full* `Read` of a file over 600 lines or ~6K tokens and tells Claude its options, with a symbol outline so it can jump straight to a targeted `Read(offset, limit)`. Slices up to 600 lines pass. |
| **pre-bash hook** | Catches `cat`/`nl`/`bat`/`less`/`more`, `head`/`tail -n N` and `sed -n 'A,Bp'` dumps of big files. Pipes, redirects and chains are left alone. |
| **post-bash hook** | When a *successful* command prints more than 250 lines / 20 KB, Claude gets the digest instead (full output kept in a log). Viewer commands (`grep`, `cat`, `git diff`, `jq`, … — judged by the last pipe segment) are never touched. |
| **SessionStart hook** | ~200 tokens telling Claude what offload offers (sits in the cached prefix). |

Design choices worth knowing:

- **Deterministic first.** Error lines, counts and tails are extracted by awk; the model only adds an overview. A wrong or missing summary can't hide a failure.
- **Fail open.** No `opencode`, no `jq`, every model in cooldown, offload disabled → hooks get out of the way. Nothing ever wedges Claude.
- **Locked-down workers.** offload injects its own OpenCode agents (via `OPENCODE_CONFIG_CONTENT`, merged over your config, nothing written to your OpenCode settings). Every worker is deny-all; only the explorer may read/grep/glob, and never files matching the secret globs. Workers can't edit files or run commands no matter what the model tries.
- **Secrets stay home.** `.env*`, keys, `*.pem`, credentials etc. are refused (`--allow-secrets` to override); common token shapes (AWS/GitHub/OpenAI keys, JWTs, `password=…`, private-key blocks) are masked in anything sent out.
- **Model chain with cooldowns.** Per-task models plus `models.fallback`. A quota/rate-limit wall (OpenCode retries those silently forever — offload cuts it after 2 retries) cools the model down for 5 min, auth errors for 30 min, unknown models for 1 h; the next model takes over.
- **Works with OpenCode 1.x and 2.x** (auto-detected; 2.x runs `--standalone` so the injected agents apply).
- Worker sessions are deleted after each run so they don't clutter your OpenCode session list.

## Requirements

- Claude Code **2.1.x** (tested on 2.1.316 — needs `updatedToolOutput` for the post-bash hook).
- OpenCode **1.x or 2.x** (tested 1.19.5 and 2.2.5) with at least one provider logged in (`opencode auth login`).
- `jq` (macOS 15+ ships it; otherwise `brew install jq` / `apt install jq`), `bash` (macOS's 3.2 is fine), standard `awk`/`sed`/`grep`.
- macOS or Linux (or WSL). Native Windows is not supported.

## Install

```bash
# 1. get the repo somewhere permanent
unzip code-offload.zip -d ~/src          # or: git clone <your fork> ~/src/code-offload

# 2. register it as a local marketplace and install the plugin
claude plugin marketplace add ~/src/code-offload
claude plugin install code-offload@code-offload

# (just trying it? no install needed:)
claude --plugin-dir ~/src/code-offload/plugins/code-offload
```

Once the repo is on GitHub, others can use `/plugin marketplace add <owner>/<repo>` and `/plugin install code-offload@code-offload`.

Optional — use the CLI from your own terminal too (inside Claude Code it is already on the Bash tool's PATH):

```bash
ln -s ~/src/code-offload/plugins/code-offload/bin/offload ~/.local/bin/offload
```

## Configure models

In Claude Code run **`/code-offload:setup`** (it lists your `opencode models`, proposes a model per task and writes the config), or do it by hand:

```bash
opencode models                                   # what your subscriptions give you
offload config set models.default  opencode-go/deepseek-v4.1-flash
offload config set models.explore  opencode-go/glm-5.3-flash
offload config set models.write    opencode-go/kimi-k2.7-code
offload config set models.fallback '["openai/gpt-5.4-mini"]'   # e.g. via ChatGPT Plus
offload doctor --ping                             # checks everything, one tiny call per model
```

The ids above are examples — model line-ups change monthly, so pick from your own `opencode models`. Good picks:

- `read` / `summarize`: a fast "flash"/"mini" model with a big context window, non-reasoning (reasoning variants hallucinate more on grounded summaries).
- `explore`: fast and good at tool calling.
- `write`: the best coder among your cheap models.
- `fallback`: something from a **different** provider, so one plan's quota wall doesn't stop delegation.
- Privacy: some providers/models train on prompts — prefer ones that don't for private code.

With no model configured, offload uses OpenCode's own default model.

Config lives in `~/.config/code-offload/config.json` (user) and `<project>/.code-offload.json` (project, overrides user); `offload config set … --project` writes the latter. `offload config show` prints the merged result. Full reference with defaults: [`plugins/code-offload/config/defaults.json`](plugins/code-offload/config/defaults.json).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch (`OFFLOAD_DISABLE=1` for one session). |
| `models.{default,read,explore,summarize,write,ask}` | `""` | Model per task, `provider/model`. Empty → `default` → OpenCode's default. |
| `models.fallback` | `[]` | Tried in order when a model fails. |
| `variants.<task>` | `""` | Reasoning effort/variant (`high`, `low`, …) per task. |
| `opencode.bin` | `opencode` | Path to the CLI. |
| `opencode.timeout_seconds` | `180` | Per-call ceiling. |
| `opencode.max_stream_errors` | `2` | Provider retries tolerated before giving up on a model. |
| `opencode.keep_sessions` | `false` | Keep worker sessions in OpenCode's history. |
| `opencode.disable_claude_code_compat` | `true` | Stop OpenCode from loading your CLAUDE.md / `~/.claude/skills` into workers. |
| `read.max_input_bytes` | `1500000` | Refuse bigger `offload read` payloads. |
| `read.verify_citations` | `true` | Check quoted citations. |
| `explore.max_steps` | `40` | Tool-call budget of the explorer. |
| `digest.threshold_lines` / `threshold_bytes` | `150` / `12000` | Below this `offload run`/`summarize` just print the output. |
| `digest.use_model` | `true` | `false` = deterministic digests only. |
| `hooks.read_guard` | `block` | `block` · `ask` (permission prompt) · `suggest` (allow + advice) · `off`. |
| `hooks.read_threshold_lines` / `read_threshold_tokens` | `600` / `6000` | A full read above either is guarded. |
| `hooks.read_max_chunk_lines` | `600` | Largest `Read(offset,limit)` / `head -n` / `sed -n` slice allowed. |
| `hooks.bash_read_guard` | `true` | Guard `cat`/`head`/`sed -n`… on big files. |
| `hooks.summarize_bash_output` | `true` | Post-bash digests. |
| `hooks.bash_output_threshold_lines` / `_bytes` | `250` / `20000` | When a Bash output gets digested. |
| `hooks.digest_timeout_seconds` | `90` | Model budget inside the post-bash hook (falls back to the deterministic digest). |
| `hooks.bash_never_summarize` | viewers regex | Last-segment commands whose output is never digested. |
| `hooks.autowrap` | `false` | Rewrite noisy commands (`hooks.autowrap_pattern`: npm test, pytest, cargo, make, …) to `offload run -c '…'`. Off by default: the rewritten command is what your Bash permission rules see. |
| `hooks.subagents` | `true` | Also guard tool calls made inside subagents. |
| `hooks.ignore_globs` | `[]` | Paths the read guards never touch. |
| `privacy.secret_globs` / `secret_allow_globs` / `redact` | see defaults | Secret handling. |
| `log_retention_days` | `7` | Digest logs under `~/.local/state/code-offload/logs`. |

Environment overrides: `OFFLOAD_MODEL`, `OFFLOAD_READ_GUARD`, `OFFLOAD_TIMEOUT`, `OFFLOAD_OPENCODE_BIN`, `OFFLOAD_DISABLE`, `OFFLOAD_STATE_DIR`, `OFFLOAD_CONFIG`, `OFFLOAD_NO_MODEL=1` (deterministic digests). Prefix a Bash command with `OFFLOAD_RAW=1 ` to bypass both Bash hooks.

## Slash commands

- `/code-offload:setup` — guided model setup.
- `/code-offload:doctor [--ping] [--reset]` — health check; `--reset` clears model cooldowns.
- `/code-offload:stats [--days N]` — delegations, estimated Claude tokens kept out of context, worker tokens, citation accuracy, hook events.

## Exit codes

`0` ok · `2` usage · `10` quota/rate limit · `11` auth · `12` timeout · `13` unknown model · `14` other worker error · `15` opencode missing · `16` refused (secret/size). `offload run` returns the command's own exit code; `offload write --check` returns `1` when the check fails (the file is still written).

## Honest caveats

- **Measure the bill, not the tool result.** Token savings per tool call are real, but a deny that costs Claude an extra turn re-reads the whole context (cheaply, via the cache). Third-party studies of similar tools found that savings can evaporate when they add turns. offload tries to avoid extra turns (outline + ready command in the deny, generous thresholds), but compare `/usage` with and without it on your real work, and tune `hooks.read_threshold_*` / `read_guard` accordingly. `offload stats` numbers are bytes/4 estimates.
- **Failing commands can't be digested by the hook.** Claude Code gives hooks no way to replace the output of a non-zero exit (it already trims it to ~10K chars). That's what `offload run` (and opt-in `hooks.autowrap`) are for.
- Each delegation costs ~1.5–3 s of OpenCode start-up plus model time.
- Cheap models are wrong more often. Citations are verified, but read the cited lines before editing; review `offload write` output.
- On OpenCode 2.x the `skill` tool stays listed for workers (its use is still denied).

## Troubleshooting

- `offload doctor` first. `--ping` makes one tiny real call per model.
- Hooks seem inactive → `OFFLOAD_DISABLE` set? opencode on Claude Code's PATH? (`/code-offload:doctor` runs inside Claude Code's environment.)
- Everything "cooling down" → `offload doctor --reset`.
- See what the hooks receive: `OFFLOAD_DEBUG_DIR=/tmp/offload-debug claude …` stores every hook input.
- Turn a part off: `offload config set hooks.read_guard suggest`, `offload config set hooks.summarize_bash_output false`, …

## Development

```bash
bash plugins/code-offload/tests/run.sh                 # offline: stub opencode, ~150 checks, ~30 s
bash plugins/code-offload/tests/run.sh --integration   # + real opencode against a local mock model (python3)
bash plugins/code-offload/tests/run.sh --e2e           # + real Claude Code against a mock Anthropic API
bash evals/run.sh                                   # host-neutral routing table against the hooks
bash evals/benchmark.sh                             # token savings with your real model
claude plugin validate ./plugins/code-offload
```

The integration and e2e suites never call a real model: `tests/mock_openai.py` stands in for the provider and `tests/mock_anthropic.py` scripts Claude Code's tool calls, so hook behaviour is verified inside the real binary at zero token cost.

Layout:

```
.claude-plugin/marketplace.json     single-plugin marketplace
plugins/code-offload/
  .claude-plugin/plugin.json
  bin/offload                       the CLI (on Claude's Bash PATH while the plugin is enabled)
  hooks/                            hooks.json, pre-read, pre-bash, post-bash, session-start
  lib/                              common, opencode transport, digest, outline, citation verifier
  prompts/                          system prompts of the worker agents
  skills/                           /code-offload:setup, /code-offload:doctor, /code-offload:stats
  config/defaults.json
  tests/                            run.sh, stub-opencode, mock_openai.py, mock_anthropic.py, e2e-claude.sh
docs/DESIGN.md                      research notes, design decisions, real-model test results
```

## Acknowledgements

Code Offload is original MIT-licensed code. Its ideas were shaped by:

- **Spotify's "shunt" plugin** (Apache-2.0, in `spotify/portal-ai-plugins`) — the original idea of
  using Claude Code hooks to route large reads to cheaper worker models via scripts and skills.
- **OpenCode** (MIT) — the headless `opencode run` interface that makes subscription models usable
  as workers.
- Public write-ups on loop-driven agent workflows by Boris Cherny, and community research on token
  savings (JetBrains' study of output compressors, the LogDx-CI log-reduction benchmark).

No third-party source code is included.

## License

MIT — see [LICENSE](LICENSE).
