# Validation runs

Mock-based suites run in CI on every push (conformance ×2 engines, routing table ×2, TS unit/adapter/MCP/installer tests).
Real-model runs are recorded here.

## 2026-11-01 — real worker model, both engines

Worker: Claude Haiku (the only real model reachable from the build container) — through OpenCode 2.2.5's
`claude-agent` provider for the bash engine, and through the `claude:` connector for the TypeScript engine.
In normal use the worker is a cheap model from your own subscription (OpenCode Go/Zen, ChatGPT via Codex/Pi,
Gemini CLI, OpenRouter, local…).

`evals/benchmark.sh` (chars/4 of what the agent would have read vs. what offload returned; facts = required
facts present in the answer):

| scenario | without | bash engine | TS engine | facts |
|---|---|---|---|---|
| large-module-facts (919-line module) | 9,666 | 453 (95%) | 454 (95%) | 4/4 · 4/4 |
| cross-file (service + tests, small) | 1,230 | 665 (45%) | 544 (55%) | 3/3 · 3/3 |
| ci-log-digest (2,323-line CI log, 2 failures) | 32,771 | 659 (97%) | 660 (97%) | 3/3 · 3/3 |
| tests-from-reference (pytest for pricing.py) | 759 | 54 (92%) | 52 (93%) | 2/2 · 2/2 |

- The CI-log digest named both failing tests with exact messages and `file:line`, plus the counts; the
  verbatim key-line section carried the same facts independently of the model.
- The generated pytest file (bash engine run) **passed 28/28** against `pricing.py` without edits.
- Small inputs save little (the cross-file case is ~1.2K tokens) — the read guard doesn't fire there by design.

## 2026-11-01 — real hosts (mock models)

- **Claude Code 2.1.316** (real binary, scripted mock API): SessionStart guide reaches the model; full Read of a
  602-line file denied with outline; `cat` denied; 23 KB Bash output replaced by a 1 KB digest; >30 KB output
  read from `persistedOutputPath` with the ERROR line first in the 2 KB preview; `offload` CLI on the Bash PATH.
- **Claude Code with a real model** (Sonnet orchestrator, Haiku worker): on "what are the exports of this
  602-line file?" Claude used `offload read` directly (no deny needed), then a 40-line targeted read to
  double-check: ~4 KB entered its context instead of 48 KB. On a debugging task it correctly did not delegate.
- **OpenCode 1.19.5 and 2.2.5**: the plugin blocks a 1,200-line read; the model sees the outline message.
- **Pi 1.4.0**: the extension registers `offload_*` tools, appends the guide, blocks the read; Pi works as a worker
  (`pi:` connector, auth error → exit 11).
- **Codex 0.166 / Claude Code**: `offload install` registers the bundled marketplace; plugin installed + enabled.
