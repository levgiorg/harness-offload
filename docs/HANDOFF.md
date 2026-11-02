# Handoff — where Harness Offload stands (2026-11-02)

A summary for the next working session. Details: `docs/autopilot/` (GOALS, PROGRESS, DECISIONS #1–40),
`docs/VALIDATION.md`, `docs/design/`.

## The idea
Coding agents waste their (expensive) context on bulk: whole files read to answer one question,
thousands of lines of test output, repo-wide greps. Harness Offload intercepts those moves with the
harness's own hooks and hands the bulk to a cheap worker model — by default **the harness's own small
model on the plan the user already pays for** (`@host`: Claude Code → Haiku via `claude -p`, Codex →
`codex exec`, Gemini CLI → Flash-Lite, Copilot CLI / Qwen Code / Crush → themselves). The agent gets
an outline, an answer with machine-checked `path:Lx-Ly` citations, or a digest with verbatim error lines.
It started from studying Spotify's "shunt" plugin (credited in README; no code copied).

## What exists
- **Two engines, same behaviour.** Bash (+jq, curl) runs the Claude Code plugin with no Node; TypeScript
  (`harness-offload` npm) adds the setup wizard, MCP server, dashboard, Windows, in-process plugins.
  A black-box conformance suite (~335 checks) runs against both; the routing table (49 cases) too;
  `tests/e2e-backends.sh` checks every backend one by one (mock in CI; `--live` real URLs; `--agents` real CLIs).
- **Harnesses:** Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, Qwen Code, Crush, OpenCode v1/v2,
  Kilo, Pi, Devin/Windsurf, Aider (conventions file), MCP clients (Cline, Zed, Continue, Goose, Kiro,
  VS Code, Claude Desktop). Amp exists but is **hidden** (never run live). Copilot, Crush and Qwen are
  verified end to end with their real binaries (`tests/e2e-hosts.sh`, 16/16).
- **Worker backends:** OpenCode, the agent CLIs (claude, codex, gemini, cursor, pi, copilot, qwen,
  crush), 18 HTTP presets + custom endpoints, local models; fallback chains with cooldowns; `@host-api`
  (the harness's model family through an API key) as a backup if a plan route stops working; `offload key`.
- **Commands:** `read`, `explore`, `run`, `summarize`, `write`, `ask`, `outline`, `task`/`tasks` (the
  user's own tasks), `model` (show/switch models, validated), `setup`, `doctor`, `install/uninstall/sync`,
  `stats` (`--json`, sparkline), `dashboard`, `mcp`, `config` (incl. `trust`).
- **Your own tasks:** `tasks.<name>` (user or repo config) = instructions + offload's citation rules + optional
  model + `tools: none|read`; reachable as `offload task`, MCP/Pi `offload_task`, listed in the session guide.
- **Security** (after a 12-finding review, all fixed): untrusted project config, sandboxed explore tools,
  redaction everywhere (inputs, command lines, answers), bounded citation checks, process-tree cleanup,
  Windows spawning without a shell, Crush worker locked down (its `crush run` auto-approves tools).
- **UI** (built with the impeccable skill's playbooks + Claude Code design skills): landing page `site/`
  and the offline `offload dashboard` report (Standard layout in the landing page's colour and type, fonts
  embedded); two independent design reviews, regressions fixed.
- **Performance** (docs/performance.md): hooks cost ~15–20 ms (bash) / ~40 ms (Node) per tool call they let
  through; real Claude Code +56 ms per tool call (was +257). `bench/hooks.mjs` runs in CI with a budget.
- **Repo hygiene:** MIT, CI (TS on 3 OSes, conformance ×2 incl. macOS bash 3.2, lint, dist freshness,
  plugin validate, single `ci-ok` gate), real-harness e2e on relevant PRs, release workflow (binaries +
  npm), CODEOWNERS, `scripts/protect-main.sh`, short README with a real-output demo GIF.

## Numbers (real worker model)
919-line module: 9,666 → 453 tokens, 4/4 facts · 2,323-line CI log: 32,771 → 659, both failures named ·
generated pytest 28/28 · real Claude Code session: ~4 KB instead of 48 KB entered context.

## Open
- Owner must run `scripts/set-owner.sh <github-user>`, push, then `scripts/protect-main.sh <owner>/harness-offload`.
- impeccable's direction roll: its launcher ran once, then the auto-mode classifier blocked the
  downloaded engine. Needs an explicit permission rule (or the owner runs `/impeccable` locally).
- UI redesign: four directions (Line Map, Squeeze, Patch, Standard) await the owner's pick in the private
  artifact https://claude.ai/artifact/3BFu4ygXC2b49QNM9SUAse (choice stored in its database, collection
  `choice`, doc `current`). Then build the chosen one into `site/index.html` and `packages/cli/src/ui/dashboard.html`,
  with a dark theme, and record its direction contract in `docs/design/`.
- OpenCode live re-run: installing `opencode-ai` from npm was blocked by the same classifier; covered by
  stubs + the earlier real 1.19.5/2.2.5 runs. Cursor CLI was not installed for the matrix.
- Ideas not built: context-aware thresholds (from `transcript_path`), `offload serve` (warm OpenCode
  server), Amp live verification, a Kilo-native worker.

## How to resume
Read `CLAUDE.md`, then `docs/autopilot/GOALS.md` (unchecked items) and the tail of `PROGRESS.md`.
Run the commands in `CLAUDE.md` before changing anything; keep both engines in step.
