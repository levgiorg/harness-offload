<div align="center">

# Harness Offload

**Keep huge files, long logs and repo-wide searches out of your coding agent's context.**<br>
A small model on the plan you already pay for reads them and hands back the answer, with every line reference checked.

[![ci](https://github.com/levgiorg/harness-offload/actions/workflows/ci.yml/badge.svg)](https://github.com/levgiorg/harness-offload/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/harness-offload)](https://www.npmjs.com/package/harness-offload)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Claude Code · Codex · Gemini CLI · Copilot CLI · Cursor · OpenCode · Pi · Qwen Code · Crush · Kilo · Windsurf · any MCP client

<img src="docs/assets/demo.gif" width="860" alt="A coding agent tries to read a 919-line file; Harness Offload blocks it with an outline, Haiku answers the question with seven checked citations, and a 2,323-line CI log becomes a short digest">

<sub>Real outputs, replayed: worker <code>claude:haiku</code> on a Claude plan.</sub>

</div>

## Install

**Claude Code** — needs only `bash` and `jq`:

```text
/plugin marketplace add levgiorg/harness-offload
/plugin install harness-offload@harness-offload
```

**Any other harness** (or several at once):

```bash
npm i -g harness-offload
offload setup
```

That's all. By default each harness uses **its own small model on your own plan** (`@host`):
Claude Code → Haiku, Codex → gpt-6-luna, Gemini CLI → Flash-Lite, Copilot CLI, Qwen Code and Crush → themselves.
Prefer OpenCode Zen/Go, an API key or a local model? One command: `offload model groq:llama-3.3-70b`
([18 providers + local](docs/backends.md), each tested one by one). If your agent's own route ever stops
working, an API key takes over: `offload key anthropic` ([how](docs/backends.md#if-your-agents-own-route-stops-working-an-api-key-takes-over)).

## What it saves

| Your agent asked for | Would have read | Got back | Facts found |
|---|---:|---:|---:|
| Questions about a 919-line module | 9,666 tokens | 453 | 4 / 4 |
| A 2,323-line CI log with two failures | 32,771 | 659 | 3 / 3 |
| Pytest file written from a reference test | 759 | 54 | 28 / 28 tests pass |

Measured with a real worker model — [docs/VALIDATION.md](docs/VALIDATION.md).

## How you use it

You mostly don't: hooks catch the expensive moves and steer the agent. When you or the agent want it directly:

```bash
offload read -q "how are late fees applied?" src/ledger.ts   # answer + checked path:line citations
offload explore "where is the retry policy configured?"      # read-only search across the repo
offload run -- npm test                                      # long output → digest + verbatim errors
offload task review-sql src/db/                             # your own task: your instructions, checked citations
offload dashboard --open                                     # what stayed out of your context
```

Your own tasks are a few lines of config — [docs/commands.md](docs/commands.md#your-own-tasks).

<img src="docs/assets/dashboard.png" width="860" alt="The offload dashboard: tokens kept out of context per day, breakdowns by kind and model, and citation checks (example data)">

## How it works

1. **A hook holds the big read back.** A full read over 600 lines (or a `cat` of one) gets an outline and cheaper options instead.
2. **A small model reads it.** `offload` sends the file to the worker with deny-all permissions and secrets removed.
3. **The answer is checked.** Every `path:Lx-Ly` must quote text that really is there, or it is flagged.
4. **Noisy output becomes a digest.** Verbatim error lines and the tail come from a script; the model only adds a summary.

Everything fails open: if no worker is available, your agent's tools work as before.

## Docs

| | |
|---|---|
| [Harnesses](docs/hosts.md) | what each integration does, install notes |
| [Backends](docs/backends.md) | `@host`, OpenCode, Codex, Gemini, Copilot, Qwen, Crush, Pi, API keys, local models, fallbacks |
| [Commands](docs/commands.md) | every command, exit codes, troubleshooting |
| [Configuration](docs/configuration.md) | thresholds, guard modes, per-project settings, privacy |
| [How it works](docs/how-it-works.md) | design, caveats, why the numbers are estimates |
| [Performance](docs/performance.md) | what the hooks cost per tool call, with and without offload (measured) |
| [Security](SECURITY.md) | trust model, worker lockdown, known limits |
| [Development](docs/development.md) | tests, layout, releases |

## Contributing

PRs welcome — CI runs both engines' conformance suites, the routing table, the TypeScript tests on three OSes and lint on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Harness Offload is original MIT-licensed code. Its ideas were shaped by Spotify's "shunt" plugin
(Apache-2.0, in `spotify/portal-ai-plugins`), which routes large reads to cheaper models through
coding-agent hooks; OpenCode's headless `opencode run`; the hook and plugin systems of Claude Code,
Codex, Cursor, Gemini CLI and Pi; Boris Cherny's notes on goal- and loop-driven agent workflows; and
community research on token savings (JetBrains' study of output compressors, the LogDx-CI benchmark).
No third-party source code is included.
The stats report embeds latin subsets of the Archivo, Public Sans and Courier Prime typefaces
(SIL Open Font License 1.1; notices in [LICENSE-FONTS](LICENSE-FONTS)).

## License

[MIT](LICENSE)
