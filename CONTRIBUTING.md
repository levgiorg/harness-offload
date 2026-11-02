# Contributing

Thanks for helping. A pull request can merge when the **`ci-ok`** check is green and a code owner
approves. `ci-ok` is green only when every job below passed:

| Job | What it checks |
|---|---|
| TypeScript (Ubuntu, macOS, Windows) | typecheck, build, unit + adapter + MCP + installer tests (smoke test on Windows) |
| Bash engine + conformance (Ubuntu, macOS with bash 3.2) | the black-box conformance suite against **both** engines, the routing table against both |
| shellcheck + manifests | shellcheck, every JSON manifest parses, versions agree, the bundled `plugins/harness-offload/dist` matches the sources, `claude plugin validate` |
| hosts-e2e (when hooks, connectors or host code change) | the real Copilot CLI, Crush and Qwen Code, driven by a mock model |

No test calls a paid model.

## Before you push

```bash
cd packages/cli && bun install && bun run build && bun test && cd ../..
bash plugins/harness-offload/tests/run.sh
OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node bash plugins/harness-offload/tests/run.sh
bash evals/run.sh && bash evals/run.sh --ts
```

`bun run build` also refreshes `plugins/harness-offload/dist/`; commit it with your change (CI fails
when it is stale).

## Rules of the road

- Behaviour lives in **both engines**: the bash engine (`plugins/harness-offload/lib`, `hooks`, `bin`)
  and the TypeScript engine (`packages/cli/src`). Change them together; the conformance suite must
  pass on both.
- Shared assets (prompts, `config/*.json`) live in `plugins/harness-offload/` and are generated into the
  TypeScript package — don't copy them.
- Hooks and in-process plugins fail open: any error → no output, exit 0.
- Workers never act: a new connector runs read-only (or with no tools) and gets `OFFLOAD_DISABLE=1`.
- New connector or harness? Add a stub-based test (`tests/stub-agent`, `tests/mock_openai.py`) and a
  row in `docs/hosts.md` / `docs/backends.md`.
- Bash must run on macOS's bash 3.2 and BSD tools, and never needs jq regex support.
- Keep the README short: details go to `docs/`.

## Maintainers

Set the GitHub owner once with `scripts/set-owner.sh <owner>`, then protect `main` with
`scripts/protect-main.sh <owner>/harness-offload` (requires `gh` with admin rights): pull requests only,
`ci-ok` required on an up-to-date branch, one code-owner review, linear history, no force pushes.
