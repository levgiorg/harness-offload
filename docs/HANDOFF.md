# Handoff — where Harness Offload stands (2026-11-02)

A summary for the next working session. Details: `docs/autopilot/` (GOALS, PROGRESS, DECISIONS #1–32),
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
  A black-box conformance suite (~250 checks) runs against both; the routing table (49 cases) too.
- **Harnesses:** Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, Qwen Code, Crush, OpenCode v1/v2,
  Kilo, Pi, Devin/Windsurf, Aider (conventions file), MCP clients (Cline, Zed, Continue, Goose, Kiro,
  VS Code, Claude Desktop). Amp exists but is **hidden** (never run live). Copilot, Crush and Qwen are
  verified end to end with their real binaries (`tests/e2e-hosts.sh`, 16/16).
- **Worker backends:** OpenCode, the agent CLIs (claude, codex, gemini, cursor, pi, copilot, qwen,
  crush), 16 HTTP presets + custom endpoints, local models; fallback chains with cooldowns.
- **Commands:** `read`, `explore`, `run`, `summarize`, `write`, `ask`, `outline`, `setup`, `doctor`,
  `install/uninstall/sync`, `stats` (`--json`, sparkline), `dashboard`, `mcp`, `config` (incl. `trust`).
- **Security** (after a 12-finding review, all fixed): untrusted project config, sandboxed explore tools,
  redaction everywhere (inputs, command lines, answers), bounded citation checks, process-tree cleanup,
  Windows spawning without a shell, Crush worker locked down (its `crush run` auto-approves tools).
- **UI** (built with the impeccable skill's playbooks + Claude Code design skills): landing page `site/`
  and the offline `offload dashboard` report; two independent design reviews, regressions fixed.
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
- Ideas not built: context-aware thresholds (from `transcript_path`), `offload serve` (warm OpenCode
  server), Amp live verification, a Kilo-native worker.

## How to resume
Read `CLAUDE.md`, then `docs/autopilot/GOALS.md` (unchecked items) and the tail of `PROGRESS.md`.
Run the commands in `CLAUDE.md` before changing anything; keep both engines in step.
