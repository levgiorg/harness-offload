# Development

```bash
cd packages/cli && bun install && bun run build && bun test   # TypeScript: unit, adapters, MCP, installers
bash plugins/harness-offload/tests/run.sh                         # conformance suite (bash engine)
OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node bash plugins/harness-offload/tests/run.sh   # … TS engine
bash plugins/harness-offload/tests/run.sh --e2e                   # + real Claude Code against a mock API
bash plugins/harness-offload/tests/e2e-backends.sh                # every HTTP preset in both engines (mock; CI)
bash plugins/harness-offload/tests/e2e-backends.sh --live --agents   # + real URLs with a fake key, real CLIs logged out
bash evals/run.sh [--ts]                                       # host-neutral routing table (49 cases)
bash evals/benchmark.sh -m <model>                             # token savings with a real model
node bench/hooks.mjs [--engine bash|ts] [--budget-ms N]           # hook latency, both engines (CI: --budget-ms)
bash bench/claude-e2e.sh [RUNS]                                # real Claude Code with vs without the plugin
```

## Trying your checkout in Claude Code (both engines)

```bash
claude plugin install harness-offload --marketplace ~/path/to/harness-offload   # once; Claude reads the checkout live
claude                        # bash engine: the plugin's own hooks (what users get)
OFFLOAD_ENGINE=ts claude      # same plugin, the TypeScript engine answers every hook and `offload` command
OFFLOAD_DISABLE=1 claude      # offload off, to compare (/context, /cost)
claude plugin uninstall harness-offload@harness-offload && claude plugin marketplace remove harness-offload
```

`offload doctor` inside a session shows which engine answered (the TypeScript one prints its own report).
Other agents from the checkout: `node packages/cli/dist/cli.js install` (every agent found, pointing at the
checkout) and `… uninstall` to undo. Installs from npm/npx copy their files to `~/.local/share/harness-offload`
first (the npx cache can vanish) and install Claude Code, Codex and Copilot from GitHub.

## Performance

Hooks run before and after every tool call, so keep them cheap: decide from what is already known (sizes,
the command's shape) before loading worker code, start as few processes as possible (bash) or as little
JavaScript as possible (`dist/hook.cjs`), and re-run `node bench/hooks.mjs` after touching a hook. See
[performance.md](performance.md).

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
