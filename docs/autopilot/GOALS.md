# Code Offload — autopilot goals

The owner is away. Work through these goals in order, autonomously, in loops:
**pick the next unmet acceptance criterion → build it → verify it with a test → commit → log it.**
Never claim a goal is met without a passing check. Prefer finishing one goal well over starting three.

## Mission
Code Offload ("the harness offloader") keeps bulk I/O — huge file reads, long command output,
codebase exploration, boilerplate — out of expensive coding agents' context by delegating it to
cheap models the user already pays for (OpenCode, Pi, Codex, Gemini, any OpenAI-compatible API,
local models). It plugs into every popular agent harness: Claude Code, Codex, Cursor, Pi, Gemini
CLI, OpenCode, Windsurf, and anything that speaks MCP.

## Ground rules
- Repo: `/home/user/code-offload` (git, branch `main`). Commit after every verified step with a
  clear message ending in the attribution lines from the session reminder.
- Owner-specific values are placeholders: `OWNER` (GitHub owner), `REPO` = `code-offload`.
- License MIT. No third-party code copied verbatim; ideas credited in README "Acknowledgements".
  No references to other projects inside source files.
- Two engines kept in sync ("both"): **bash** (Claude Code plugin hooks + `offload` CLI, zero
  deps beyond jq) and **TypeScript** (`code-offload` npm package: CLI, setup wizard, MCP server,
  connectors, host installers, Windows). Shared: `config/defaults.json` schema, `prompts/*.md`,
  state dir layout, stats format, exit codes, and a black-box conformance suite run against both.
- Verification first (Boris Cherny's rule: give the agent a way to check its work). Every feature
  lands with a test. Mock backends/hosts for free tests; real-model tests sparingly (Haiku/Sonnet,
  a few per milestone — owner approved "with measure").
- Never break: `bash plugins/code-offload/tests/run.sh` must stay green.
- Record open questions and the answer chosen in `DECISIONS.md` instead of waiting for the owner.
- Log each loop iteration in `PROGRESS.md` (what changed, what was verified, what's next).

## Milestones & acceptance criteria
### M0 Identity & legal
- [ ] Renamed everywhere (no "sidecar"/"shunt"/"spotify" in source); CLI `offload`, package `code-offload`.
- [ ] MIT `LICENSE`; README "Acknowledgements" crediting ideas (Spotify shunt, OpenCode, survey sources).
- [ ] Original eval cases + fixtures (written from scratch) replace third-party ones.
- [ ] `scripts/set-owner.sh OWNER` rewrites placeholders.

### M1 Repo & CI
- [ ] Monorepo layout: `plugins/code-offload` (Claude Code), `packages/cli` (TS), `integrations/*`, `docs/`, `scripts/`.
- [ ] `.github/workflows/ci.yml`: bash suite on ubuntu + macos (real bash 3.2), shellcheck, TS typecheck+tests on ubuntu/macos/windows, plugin validate.
- [ ] `.github/workflows/release.yml`: on tag → bun-compiled binaries (linux x64/arm64, macOS x64/arm64, windows x64) + npm publish (dry-run without token) + GitHub release.
- [ ] `install.sh` / `install.ps1` one-liners (placeholder URLs).

### M2 TypeScript engine (parity)
- [ ] `offload read|explore|run|summarize|write|ask|outline|doctor|stats|config` with the same flags, outputs and exit codes as bash.
- [ ] Conformance suite passes against both engines.

### M3 Connectors (worker backends)
- [ ] opencode (v1/v2), openai-compatible HTTP (OpenRouter, Ollama, LM Studio, vLLM, Groq, DeepSeek, Together, Mistral, Gemini-OpenAI, …), anthropic API, pi, codex exec, gemini CLI, claude -p. Per-task backend+model, fallback chain across backends, cooldowns.
- [ ] Each connector tested against a mock (no real calls in CI).

### M4 Setup wizard & aesthetics
- [ ] `offload setup`: detects harnesses + backends, asks backend/API key/models per task, writes config (keys stored 0600 or as env references), installs chosen host integrations. Non-interactive flags for CI.
- [ ] Beautiful CLI: banner, colors (NO_COLOR respected), spinners, tables (stats, doctor), `--json` output for scripts.

### M5 Host integrations
- [ ] Claude Code (plugin, done) · Codex (plugin + hooks/AGENTS.md/MCP) · Cursor (plugin/hooks/rules/MCP) · Pi (package + extension) · Gemini CLI (extension + hooks) · OpenCode (plugin) · Windsurf (hooks/rules/MCP) · generic MCP server (`offload mcp`).
- [ ] `offload install <host>` / `uninstall <host>` idempotent; tested with fixture home dirs.

### M6 Docs & polish
- [ ] README with quickstart per host, demo GIF placeholder, comparison table, FAQ; docs/ per host; CHANGELOG; CONTRIBUTING; SECURITY.
- [ ] Real-model validation report updated (sparingly).

## Loop protocol (every iteration, including the 30-minute /loop wake-ups)
1. Read GOALS.md, the tail of PROGRESS.md and DECISIONS.md; `git log --oneline | head`.
2. Run the fast checks (bash suite; TS tests once they exist). Fix red before anything else.
3. Pick the highest-value unchecked criterion; implement; verify; tick it here; commit.
4. If idle-worthy (waiting on a research agent), do a polish item from M6 instead of stopping.
5. Append a PROGRESS.md entry. Never stop while unchecked criteria remain.
