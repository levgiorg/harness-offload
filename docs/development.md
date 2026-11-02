# Development

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
