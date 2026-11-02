<div align="center">

# ▌harness offload

**The harness offloader.** Keep bulk I/O out of your expensive coding agent's context —
let the models you already pay for do the heavy lifting.

[![ci](https://github.com/OWNER/harness-offload/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/harness-offload/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/harness-offload)](https://www.npmjs.com/package/harness-offload)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Claude Code · Codex · Cursor · Gemini CLI · Copilot CLI · OpenCode · Pi · Qwen Code · Crush · Kilo · Amp · Devin/Windsurf · Aider · any MCP client

</div>

---

Your agent reads a 4,000-line file to answer one question. It dumps 30 KB of test output to find one
failing assertion. It greps through forty files to learn where auth happens. Every one of those tokens
sits in its context for the rest of the session, on the most expensive model you use.

**Harness Offload** hands that bulk work to a cheap worker model — by default **your harness's own small
model on the plan you already pay for** (Claude Code → Haiku, Codex → gpt-6-luna, Gemini CLI → Flash-Lite),
or OpenCode, Pi, any OpenAI-compatible API or a local model — and gives your agent back only the answer:

```text
$ offload read -q "what does applyLateFee do and when?" src/ledger.ts
applyLateFee adds a 2.5% fee to receivables more than 30 days overdue; the fee is uncapped (TODO).
- Rate is `LATE_FEE_RATE` — src/ledger.ts:L6 `export const LATE_FEE_RATE = 0.025;`
- No fee up to 30 days — src/ledger.ts:L417 `if (daysOverdue <= 30) return 0 as Money;`
- TODO to cap at 50.00 — src/ledger.ts:L415 `TODO: cap the fee at 50.00`

[offload read · opencode-go/deepseek-v4.1-flash · 1 file(s), 919 lines (~9,666 tokens) kept out of your context · 6s · citations: 3 verified, 0 unverified]
```

Every citation's quote is **checked against the file** before your agent sees it.

## Quickstart

**Claude Code, zero setup** — the plugin needs only `bash` and `jq`, and by default reads with Haiku on
your own Claude plan:

```text
/plugin marketplace add OWNER/harness-offload
/plugin install harness-offload@harness-offload
```

**Everything else** (and the setup wizard):

```bash
npm install -g harness-offload          # or: curl -fsSL https://raw.githubusercontent.com/OWNER/harness-offload/main/install.sh | sh
offload demo                         # 10-second tour of the guard and the digest — no model calls
offload setup                        # pick worker backends, API keys, models, and the agents to wire up
```

The wizard first asks who should do the cheap work — **your agent's own subscription** (`@host`, the
default), the same plus a fallback, or backends you pick (OpenCode Zen/Go, ChatGPT, API keys, local
models) — then sets the read guard, installs the integrations and runs a live test. Scripted:
`offload setup --yes --hosts claude,codex` (defaults to `@host`) or `--model openrouter:qwen/qwen3-coder`.

Codex can also use the marketplace directly: `codex plugin marketplace add OWNER/harness-offload` (then
trust the hooks in `/hooks`). A landing page for the project lives in [`site/`](site/index.html).

## What it does

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

## Agent harnesses

| Harness | Install | Read guard | Output digest | Guidance | Tools |
|---|---|---|---|---|---|
| **Claude Code** | plugin (`offload install claude`) | ✓ Read + Bash | ✓ | SessionStart | `offload` CLI on PATH |
| **Codex CLI** | plugin + hooks (`offload install codex`, trust in `/hooks`) | ✓ Bash (Codex reads via shell) | ✓ | SessionStart + skill | MCP tools (Codex sandboxes shell network) |
| **Cursor** | local plugin (`offload install cursor`) | ✓ Read + Shell | — (Cursor can't replace shell output) | always-on rule | MCP tools |
| **Gemini CLI** | extension (`offload install gemini`) | ✓ `read_file` + shell | ✓ | GEMINI.md + SessionStart | MCP tools |
| **Pi** | package (`offload install pi`) | ✓ read + bash | ✓ | system prompt | native `offload_*` tools |
| **OpenCode** (v1 & v2) | plugin (`offload install opencode`) | ✓ read + shell | ✓ | system prompt | `offload` CLI |
| **Kilo Code CLI** | plugin (`offload install kilo`) | ✓ read + bash | ✓ | system prompt | `offload` CLI |
| **GitHub Copilot CLI** | Claude plugin (`offload install copilot`) | ✓ view + bash | ✓ | SessionStart | `offload` CLI (absolute path) |
| **Qwen Code** | extension converted from the plugin (`offload install qwen`) | ✓ read_file + shell | — (no output replacement) | SessionStart | `offload` CLI |
| **Crush** | hooks in `crush.json` (`offload install crush`) | ✓ view + bash | ✓ | global context file | `offload` CLI |
| **Amp** *(experimental)* | plugin (`offload install amp`) | ✓ Read + Bash | ✓ | — | `offload` CLI |
| **Devin Desktop / Windsurf** | Claude plugin (`offload install devin`) | ✓ (Claude hooks) | — | — | `offload` CLI |
| **Aider** | conventions file (`offload install aider`, then `aider --read …`) | — | — | conventions | `/run offload …` |
| **MCP clients** (Cline, Zed, Continue, Goose, Kiro, VS Code, Claude Desktop) | `offload install mcp` prints each client's config | — | — | server instructions | MCP tools |

Copilot CLI, Crush and Qwen Code were verified end to end with their real binaries.

Details per host: [docs/hosts.md](docs/hosts.md).

## Worker backends ("connectors")

Models are written `BACKEND:MODEL`. A bare `provider/model` means OpenCode. **`@host`** means "the
calling harness's own cheap model" and is the default.

| Backend | Example model ref | Uses |
|---|---|---|
| **Same subscription** | `@host` | Claude Code → `claude:haiku`, Codex → `codex:gpt-6-luna`, Gemini CLI → `gemini:flash-lite`, Cursor → `cursor:`, Pi → `pi:`, OpenCode/Kilo/Copilot/Qwen/Crush → OpenCode's default (`host_models.<host>` overrides) |
| **OpenCode** (v1/v2) | `opencode-go/deepseek-v4.1-flash` | OpenCode Zen/Go, ChatGPT Plus/Pro, Copilot, coding plans (GLM, Kimi, MiniMax…), local |
| **Pi** | `pi:openai-codex/gpt-6-luna` | Pi's logins (ChatGPT, Copilot, Kimi, xAI, OpenRouter…) and API keys |
| **Codex CLI** | `codex:gpt-6-luna` | your ChatGPT plan |
| **Gemini CLI** | `gemini:flash` | your Google account (free daily quota) |
| **Cursor CLI** | `cursor:<model>` | your Cursor plan |
| **Claude Code** | `claude:haiku` | your Claude plan, through a lean `claude -p` (no settings, plugins or MCP; its own short prompt). It counts toward your plan's limits at Haiku's rate; the saving is your main session's context. |
| **HTTP APIs** | `openrouter:qwen/qwen3-coder`, `openai:…`, `anthropic:…`, `google:gemini-…`, `groq:…`, `deepseek:…`, `mistral:…`, `together:…`, `fireworks:…`, `cerebras:…`, `xai:…`, `zai:glm-…`, `moonshot:kimi-…` | API keys (`offload setup` stores them `0600`, or use the usual env vars) |
| **Local** | `ollama:qwen3:8b`, `lmstudio:…`, `vllm:…` | your machine |
| **Your own endpoint** | `mygw:model` | `endpoints.mygw = {type: "openai"\|"anthropic", base_url, api_key_env}` |

`explore` works on every backend: HTTP models get a sandboxed read-only tool loop (read_file, grep,
glob, list_dir — confined to the project's real directory, symlinks not followed, `.git` and secrets
refused, every result redacted). The bash engine runs agent CLIs and HTTP APIs itself (curl); only
`explore` over an HTTP API uses the bundled Node CLI.

Per task you can pick a different model, plus a **fallback chain across backends** (default:
`@host`, then OpenCode's default model; an explicit `-m MODEL` is used alone): a quota wall
(OpenCode retries those silently forever — offload stops after two retries) cools that model down
for 5 min, auth errors 30 min, unknown models 1 h, and the next model takes over.

## Commands

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

## How it works

```
agent ── Read huge.ts ──────► guard ─► deny + outline + "offload read -q … huge.ts"
agent ── cat/head/sed huge ─► guard ─► same
agent ── npm test ──────────► digest ─► summary + verbatim error lines + log path
agent ── offload read/explore/run/write (CLI, MCP or native tools)
            └─► worker: OpenCode │ Pi │ Codex │ Gemini │ Cursor │ HTTP API │ local
                deny-all permissions (explorer: read/grep/glob only), secrets redacted
```

- **Deterministic first.** Error lines, counts, tails and outlines come from scripts; the model
  only adds an overview, and its citations are checked.
- **Fail open.** No backend, broken config, quota walls, `OFFLOAD_DISABLE=1` → hooks step aside.
- **Workers never act.** No edits, no shell; workers run with `OFFLOAD_DISABLE=1` so they can't
  trigger offload's own hooks.
- **Two engines, one behaviour.** The Claude Code hooks and CLI are dependency-free bash (+`jq`, `curl`
  for HTTP APIs); the `harness-offload` package is TypeScript (CLI, wizard, MCP server, report, other
  hosts, Windows) and is also bundled inside the plugin (`dist/`). Both run the same black-box
  conformance suite in CI.

More in [docs/DESIGN.md](docs/DESIGN.md).

## Configuration

`~/.config/harness-offload/config.json` (user) and `<repo>/.harness-offload.json` (project). Edit
with `offload config set KEY VALUE [--project]`; inspect with `offload config show`. A repository's file
is **untrusted**: it may set models, thresholds and hook behaviour and add secret globs, but not
binaries, endpoints, the backend, the state directory or privacy relaxations — unless you run
`offload config trust` in it (`offload doctor` lists ignored keys). Defaults:
[`plugins/harness-offload/config/defaults.json`](plugins/harness-offload/config/defaults.json).

| Key | Default | Meaning |
|---|---|---|
| `models.{default,read,explore,summarize,write,ask}` | `default`: `@host` | `BACKEND:MODEL` per task; empty → `default` |
| `models.fallback` | `["@default"]` | tried in order when a model fails |
| `host_models.<host>` | see connectors | what `@host` means in each harness |
| `trusted_projects` | `[]` | project dirs whose `.harness-offload.json` is fully trusted (`offload config trust`) |
| `backend` | `opencode` | backend for bare `provider/model` refs |
| `endpoints.<name>` | presets | `{type, base_url, api_key_env}` for your own gateways |
| `variants.<task>` | `""` | reasoning effort per task (`low`, `high`, …) |
| `hooks.read_guard` | `block` | `block` · `ask` · `suggest` (allow + advice) · `off` |
| `hooks.read_threshold_lines` / `_tokens` | `600` / `6000` | a full read above either is guarded |
| `hooks.read_max_chunk_lines` | `600` | largest slice allowed (`Read` offset/limit, `head -n`, `sed -n`) |
| `hooks.summarize_bash_output` | `true` | post-command digests |
| `hooks.bash_output_threshold_lines` / `_bytes` | `250` / `20000` | when output gets digested |
| `hooks.bash_never_summarize` | viewers regex | commands whose output is never digested (`grep`, `cat`, `git diff`, …) |
| `hooks.autowrap` | `false` | rewrite noisy commands to `offload run -c '…'` (changes what permission rules see) |
| `hooks.subagents` | `true` | also guard subagents' tool calls |
| `hosts.<codex\|cursor>.call` | `mcp` | how the agent should call offload there (`mcp` or `shell`) |
| `opencode.timeout_seconds` | `180` | per-call ceiling (all backends) |
| `explore.max_steps` | `40` | tool budget of the explorer |
| `digest.use_model` | `true` | `false` = deterministic digests only |
| `privacy.secret_globs` / `redact` | `.env*`, keys, … / `true` | never sent; credential shapes masked |
| `mcp.run_tool` / `mcp.run_timeout_seconds` | `true` / `1800` | expose `offload_run` (runs outside a host's sandbox) and its limit |

Environment: `OFFLOAD_MODEL`, `OFFLOAD_READ_GUARD`, `OFFLOAD_MIN_LINES`, `OFFLOAD_TIMEOUT`,
`OFFLOAD_DISABLE`, `OFFLOAD_CONFIG`, `OFFLOAD_STATE_DIR`, `OFFLOAD_NO_MODEL=1`. Prefix a command
with `OFFLOAD_RAW=1 ` to bypass the shell guard and digest.

## Privacy & safety

- Files matching `privacy.secret_globs` (`.env*`, `*.pem`, `*.key`, `id_rsa*`, credentials, tfstate…)
  are refused — matched case-insensitively and on symlink targets — (`--allow-secrets` to override) and
  the explorer can't read them.
- Cloud/GitHub/GitLab/npm/Stripe/OpenAI/Slack/Google keys, Bearer/Basic auth, URL credentials, JWTs,
  `password=…` values and private-key blocks are masked in everything sent to a worker, in command
  lines, log names and stats, and in worker answers.
- Trust model, safeguards and known limits: [SECURITY.md](SECURITY.md).
- Some providers train on prompts — pick ones that don't for private code.
- API keys stored by `offload setup` live in `~/.config/harness-offload/credentials.json` (mode `600`).

## Honest caveats

- **Measure the bill, not the tool result.** A blocked read can cost your agent an extra turn, and
  each turn re-reads its context (cheaply, from cache). Savings grow with file size, session length
  and model price. Compare `/usage` with and without; tune `hooks.read_threshold_*`. `offload stats`
  shows bytes/4 estimates.
- Failing commands' output can't be replaced by hooks on most hosts; use `offload run`.
- Each delegation costs ~1.5–3 s of start-up plus model time.
- Cheap models are wrong more often. Citations are verified — still read the cited lines before
  editing, and review `offload write` output.

## Troubleshooting

`offload doctor` (add `--ping` for one live call per model, `--reset` to clear cooldowns) ·
`OFFLOAD_DEBUG=1` for hook errors · `OFFLOAD_DEBUG_DIR=/tmp/x` (bash hooks) keeps every hook input.

## Development

```bash
cd packages/cli && bun install && bun run build && bun test   # TypeScript: unit, adapters, MCP, installers
bash plugins/harness-offload/tests/run.sh                         # conformance suite (bash engine)
OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node bash plugins/harness-offload/tests/run.sh   # … TS engine
bash plugins/harness-offload/tests/run.sh --e2e                   # + real Claude Code against a mock API
bash evals/run.sh [--ts]                                       # host-neutral routing table (49 cases)
bash evals/benchmark.sh -m <model>                             # token savings with a real model
```

No test ever calls a paid model: `tests/mock_openai.py` stands in for providers and
`tests/mock_anthropic.py` scripts Claude Code's tool calls. Releases (`git tag vX.Y.Z`) build
standalone binaries for macOS/Linux/Windows and publish to npm. Set the GitHub owner once with
`scripts/set-owner.sh <owner>`.

```
plugins/harness-offload/     Claude Code plugin (bash hooks, CLI, prompts, config) + Codex/Cursor/Gemini host files
packages/cli/             TypeScript package: CLI, wizard, MCP server, connectors, host adapters, Pi/OpenCode integrations
evals/                    routing table, fixtures, benchmarks
docs/                     design notes, host details, research, autopilot logs
```

## Acknowledgements

Harness Offload is original MIT-licensed code. Its ideas were shaped by:

- **Spotify's "shunt" plugin** (Apache-2.0, in `spotify/portal-ai-plugins`) — using coding-agent hooks
  to route large reads to cheaper worker models through scripts and skills.
- **OpenCode** (MIT) — the headless `opencode run` interface that makes subscription models usable
  as workers; and the hook/plugin systems of Claude Code, Codex, Cursor, Gemini CLI and Pi.
- Boris Cherny's public notes on goal-driven, loop-driven agent workflows, and community research on
  token savings (JetBrains' study of output compressors; the LogDx-CI log-reduction benchmark).

No third-party source code is included.

## License

[MIT](LICENSE)
