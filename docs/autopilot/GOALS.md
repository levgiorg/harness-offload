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
- [x] Renamed everywhere (no "sidecar"/"shunt"/"spotify" in source); CLI `offload`, package `code-offload`.
- [x] MIT `LICENSE`; README "Acknowledgements" crediting ideas (Spotify shunt, OpenCode, survey sources).
- [x] Original eval cases + fixtures (written from scratch) replace third-party ones.
- [x] `scripts/set-owner.sh OWNER` rewrites placeholders.

### M1 Repo & CI
- [x] Monorepo layout: `plugins/code-offload` (Claude Code), `packages/cli` (TS), `integrations/*`, `docs/`, `scripts/`.
- [x] `.github/workflows/ci.yml`: bash suite on ubuntu + macos (real bash 3.2), shellcheck, TS typecheck+tests on ubuntu/macos/windows, plugin validate.
- [x] `.github/workflows/release.yml`: on tag → bun-compiled binaries (linux x64/arm64, macOS x64/arm64, windows x64) + npm publish (dry-run without token) + GitHub release.
- [x] `install.sh` / `install.ps1` one-liners (placeholder URLs).

### M2 TypeScript engine (parity)
- [x] `offload read|explore|run|summarize|write|ask|outline|doctor|stats|config` with the same flags, outputs and exit codes as bash.
- [x] Conformance suite passes against both engines.

### M3 Connectors (worker backends)
- [x] opencode (v1/v2), openai-compatible HTTP (OpenRouter, Ollama, LM Studio, vLLM, Groq, DeepSeek, Together, Mistral, Gemini-OpenAI, …), anthropic API, pi, codex exec, gemini CLI, claude -p. Per-task backend+model, fallback chain across backends, cooldowns.
- [x] Each connector tested against a mock (no real calls in CI).

### M4 Setup wizard & aesthetics
- [x] `offload setup`: detects harnesses + backends, asks backend/API key/models per task, writes config (keys stored 0600 or as env references), installs chosen host integrations. Non-interactive flags for CI.
- [ ] Beautiful CLI: banner, colors (NO_COLOR respected), spinners, tables (stats, doctor), `--json` output for scripts.

### M5 Host integrations
- [x] Claude Code (plugin, done) · Codex (plugin + hooks/AGENTS.md/MCP) · Cursor (plugin/hooks/rules/MCP) · Pi (package + extension) · Gemini CLI (extension + hooks) · OpenCode (plugin) · Windsurf (hooks/rules/MCP) · generic MCP server (`offload mcp`).
- [x] `offload install <host>` / `uninstall <host>` idempotent; tested with fixture home dirs.

### M6 Docs & polish
- [x] README with quickstart per host, demo GIF placeholder, comparison table, FAQ; docs/ per host; CHANGELOG; CONTRIBUTING; SECURITY.
- [ ] Real-model validation report updated (sparingly).

### M7 Raise the bar (added during the night)
- [x] Real-model validation pass with the new fixtures (benchmark.sh via Pi/claude-agent; record in docs/VALIDATION.md).
- [ ] Beautiful CLI polish: `--json` everywhere it makes sense, consistent colors in read/explore footers on TTY only, `offload stats` sparkline.
- [ ] Context-aware thresholds (estimate the agent's context size from transcript_path; raise/lower the guard).
- [ ] `offload serve`: warm OpenCode server to cut the 1.5–3 s start-up per call. (deferred — see DECISIONS #14)
- [~] More hosts: Kilo Code ✓ (OpenCode v1 plugin API); GitHub Copilot CLI hooks, Crush hooks, Qwen Code hooks (formats unverified).
- [ ] Per-host e2e with real binaries where available (codex exec worker, gemini CLI) behind `--integration`.

### M8 Owner requests (2026-11-02, before sleeping) — TOP PRIORITY
- [ ] **Rename to "Harness Offload"** everywhere (plugin/package/config dirs/docs). CLI stays `offload` (+ alias `harness-offload`); npm `harness-offload` (free on 2026-11-02).
- [ ] **"Use my agent's own subscription" option, for every plugin/host**: model ref `@host` resolves to the calling harness's cheap model (Claude Code → `claude:haiku`, Codex → `codex:gpt-6-luna`, Gemini CLI → `gemini:flash-lite`, Cursor → `cursor:` default, Pi → `pi:` default, OpenCode/Kilo → OpenCode default). Host known from hooks/MCP launchers (`OFFLOAD_HOST`) or env detection (`CLAUDECODE`, `CODEX_*`, `CURSOR_AGENT`, `GEMINI_CLI`, …). Wizard offers it first; doctor explains it.
- [ ] Claude worker hardened for subscription use: `claude -p --setting-sources … --strict-mcp-config --disable-slash-commands --no-session-persistence --system-prompt … --tools ""`, `OFFLOAD_DISABLE=1` (no recursion). (`--bare` can't use OAuth subscriptions — don't use it.)
- [ ] **Bash engine native CLI-agent connectors** (claude, codex, gemini, cursor, pi) and HTTP (curl, non-explore), so the Claude Code plugin works with the same subscription WITHOUT Node/npm (the owner's zip install failed exactly here).
- [ ] **Self-contained plugin**: commit a built `plugins/harness-offload/dist/cli.js` (+ pi.js, opencode.js) so marketplace installs (GitHub clone, Codex cache copy, Cursor local copy) never need a build; CI fails if it is stale.
- [ ] **All known harnesses**: add Copilot CLI, Crush, Qwen Code (await research), Amp, Cline, Goose/Zed/Continue (MCP recipes), Kiro (hooks?), Aider (conventions file) — each with install + doc row.
- [ ] Any UI (landing page/docs site, stats dashboard) must use the **impeccable** skill (github: pbakaus/impeccable) and Claude Code's design skills (artifact-design etc.). Plan: `offload dashboard` local stats page + a landing page in `site/`.

## Loop protocol (every iteration, including the 30-minute /loop wake-ups)
1. Read GOALS.md, the tail of PROGRESS.md and DECISIONS.md; `git log --oneline | head`.
2. Run the fast checks (bash suite; TS tests once they exist). Fix red before anything else.
3. Pick the highest-value unchecked criterion; implement; verify; tick it here; commit.
4. If idle-worthy (waiting on a research agent), do a polish item from M6 instead of stopping.
5. Append a PROGRESS.md entry. Never stop while unchecked criteria remain.
