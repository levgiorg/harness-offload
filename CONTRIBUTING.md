# Contributing

1. `cd packages/cli && bun install && bun run build && bun test`
2. `bash plugins/code-offload/tests/run.sh` and the same with `OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node`
3. `bash evals/run.sh` and `bash evals/run.sh --ts`

Rules of the road:
- Behaviour lives in **both engines**. Change the bash engine (`plugins/code-offload/lib`, `hooks`) and the TypeScript engine (`packages/cli/src`) together; the conformance suite must pass on both.
- Shared assets (prompts, `config/defaults.json`, `config/outline.json`) live in `plugins/code-offload/` and are generated into the TS package — don't copy them.
- Hooks must fail open: any error → no output, exit 0.
- New connector or host? Add a mock-based test (no real model calls in CI) and a row in the README tables.
- Bash must run on macOS's bash 3.2 and BSD tools (CI runs the suite there).
