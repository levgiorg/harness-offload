# Validation runs

Mock-based suites run in CI on every push (conformance ×2 engines, routing table ×2, TS unit/adapter/MCP/installer tests).
Real-model runs are recorded here.

## 2026-11-02 — hook latency, with and without offload ([performance.md](performance.md))

- **Real Claude Code 2.1.316**, scripted mock API (instant answers), the same 17 tool calls per session,
  7 runs each: without offload 1,136 ms; with the previous plugin 5,707 ms (+257 ms per tool call); with this
  one 2,086 ms (**+56 ms per tool call**). Bytes of tool results the model reads: 228,648 → 26,763 in both
  plugin versions (same decisions).
- **Every hook, both engines** (`bench/hooks.mjs`, 30 runs, outcome-checked): a pass-through call 104–175 →
  **16–21 ms** (bash) and ~105 → **36–42 ms** (Node hooks); blocked read 233 → 79 / 109 → 52 ms; long-output
  digest with the stub worker 862 → 274 / 126 → 72 ms; `OFFLOAD_DISABLE=1` 35 → 5 / 115 → 5 ms.
- Inside real Claude Code with the stub worker: the guide reaches the model, a 900-line Read is stopped with
  the outline (923 chars), a 3,000-line output comes back as the digest (all four FAIL lines verbatim) inside
  Claude Code's 2 KB preview, a 20-line slice passes untouched.
- Not run: `tests/run.sh --e2e` (needs a real `opencode`, whose install is blocked here — decision #40).

## 2026-11-02 — your own tasks, `offload model`, every backend one by one

- **A custom task on the Claude plan, both engines:** `tasks.exit-codes` ("list every exit code constant…",
  `model: claude:haiku`) on `lib/opencode.sh` (531 lines): all 8 constants with numbers and meanings in both
  engines, **16/16 and 17/17 citations verified**, ~6,650 tokens kept out of context, 10–12 s; stats record
  `"task":"exit-codes"`. Worker cost per run ≈ 14.8k tokens in / 2.3k out on the plan.
- **Backend matrix** (`tests/e2e-backends.sh --live --claude-live`, both engines): **502/502** —
  16 HTTP presets + a custom endpoint against a mock (path, auth header, model id, tools, 401/429/404, model
  list, `offload model`); the 13 cloud presets' real URLs with a fake key → exit 11 (Fireworks → 13, it
  answers "model not found" for unknown keys); Ollama/LM Studio/vLLM with no server → exit 14 in ≤1 s;
  Codex, Gemini, Pi, Copilot, Qwen and Crush CLIs (real binaries, logged out) → flags accepted, exit 11;
  `claude -p` real call → `pong`. Cursor CLI not installed here (skipped).
- Found and fixed by that run: Qwen "No auth type is selected", Pi "No API key found" / "security token is
  invalid", Crush "No providers configured" were exit 14 → now 11; Gemini's login error (JSON on stderr) is
  shown verbatim; `offload models fireworks` with a bad key printed nothing → now `# fireworks: HTTP 401: …`.

## 2026-11-02 — same subscription (`@host`), more harnesses

- **Claude plan as the worker, bash engine only (no Node):** `OFFLOAD_HOST=claude offload read -q "what does co_route do?" lib/agents.sh`
  → `claude:haiku` via a lean `claude -p` (no settings/plugins/MCP), 311-line file, 11 s, **5/5 citations verified**,
  ~4,170 tokens kept out of context. Worker cost: 11,347 tokens in / 1,691 out on the plan.
- **Claude plan as the worker, bundled TypeScript CLI:** `offload ask` → `pong` from `claude:haiku` in 3 s.
- **GitHub Copilot CLI 1.0.105** (real binary, plugin installed from the local marketplace, scripted mock model):
  a 3,000-line `view` was denied with the outline; `seq 1 400` came back as a digest through `modifiedResult`;
  the guide arrived as session context; messages name the CLI by absolute path.
- **Crush 0.99.0** (real binary, `offload install crush`, scripted mock model): `view` of the 3,000-line file blocked
  (`Tool call blocked by hook`), `bash seq 1 400` replaced by the digest (`updated_output`), guide in the system prompt
  via `global_context_paths`.
- **Qwen Code 0.26.5** (real binary, `qwen extensions install` of the plugin, scripted mock model): `read_file` denied
  with the outline, guide injected as session-start context; shell output untouched (Qwen can't replace it — documented).
- Worker in those three runs: the stub agent CLI (`claude:haiku` stand-in), so the hosts were real and the model was not.

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
