# Progress log

## 2026-11-01 ~22:45 UTC — kickoff
- Created `/home/user/code-offload` from the working prototype (Claude Code plugin + bash CLI, 154 offline tests green after rename).
- Research agents launched: (a) Codex + Cursor + Windsurf formats, hooks and worker CLIs; (b) Pi, Gemini CLI, OpenCode plugin APIs.
- Next: M0 (license, acknowledgements, original evals), M1 (layout + CI), then the TS engine.

## 2026-11-01 ~23:45 UTC — M0 done, M2 core done
- M0: MIT license, `scripts/set-owner.sh`, original fixtures (`evals/fixtures/warehouse`, generated `ledger.ts`/`ci.log`), host-neutral routing table `evals/hooks.json` (47 cases, bash hooks 47/47), benchmark spec + runner; third-party files removed; design notes rewritten.
- Shared assets: worker prompts, `config/defaults.json`, new `config/outline.json` (bash now reads outline regexes from it) → generated into the TS package.
- TS engine (`packages/cli`): config/state/text/secrets/outline/verify/digest ported; connectors: opencode v1/v2, 16 HTTP presets (OpenAI-compatible + Anthropic, with a sandboxed read-only tool loop for explore), CLI agents claude/codex/gemini/pi/cursor (flags per research). `OFFLOAD_DISABLE=1` passed to every worker (no hook recursion).
- Verified: the bash conformance suite run against the TS CLI → 154/154. Fixed along the way: process-group kill on timeout (stuck grandchildren kept pipes open).
- Research saved: `docs/research/pi-gemini-opencode.md`, `docs/research/codex-cursor-devin.md`.
- Next: TS hook logic + `offload hook <host> <event>` adapters (claude, codex, cursor, gemini), MCP server, per-host plugin packaging, install/setup, CI.

## 2026-11-02 ~01:30 UTC — M1, M3, M4, M5, M6 mostly done
- `offload worker` transport: the bash engine routes `BACKEND:MODEL` refs through the TS connectors (one implementation per connector). HTTP connector tests (mock OpenAI endpoint: tools, explore loop, secrets, path escape, 401/429) → 166/166 on both engines.
- TS hook logic + adapters (`offload hook <host> <event>`) for claude/codex/cursor/gemini; routing table 49/49 on bash and TS hooks; bun tests for adapters.
- MCP server (`offload mcp`, 7 tools) tested with the SDK client.
- Host packaging: `.codex-plugin` (hooks/MCP/skill), `.cursor-plugin` (hooks/MCP/always-on rule), Gemini extension, Pi extension (native tools, guard, digest, guide), OpenCode v1+v2 plugin. **Verified in real hosts:** OpenCode 1.19.5 & 2.2.5 block a 1,200-line read via the plugin; Pi 1.4.0 loads the extension and blocks it; Pi works as a worker; Claude Code and Codex CLIs install the plugin from the bundled marketplace (installed + enabled).
- `offload install/uninstall` for 8 hosts (stub-tested + real claude/codex); `offload setup` wizard (driven end-to-end through a pty) + `--yes` mode.
- CI (TS on ubuntu/macos/windows; bash suites incl. macOS system bash 3.2; shellcheck; manifest/version checks), release workflow (bun-compiled binaries for 5 targets, npm publish, plugin zip), install.sh/install.ps1. Standalone binary smoke-tested locally.
- README rewritten; docs/hosts.md, CHANGELOG, CONTRIBUTING, SECURITY.
- Next (M7): real-model validation pass, polish, warm server, more hosts.

## 2026-11-02 ~00:10 UTC — renamed to Harness Offload
- Repo moved to `/home/user/harness-offload` (symlink from the old path), plugin `plugins/harness-offload`, npm `harness-offload` (bins `offload`, `harness-offload`), config `~/.config/harness-offload/`, project file `.harness-offload.json`, marketplace `harness-offload@harness-offload`. Loop re-created with the new path (job ec77080e).
- All suites green after the rename: bun 31/31, conformance 166/166 ×2 engines, routing 49/49 ×2.

## 2026-11-02 ~08:00 UTC — same subscription (@host), native bash connectors, project-config lockdown
- `@host`/`@self` model ref: the calling harness's own cheap model (Claude Code → `claude:haiku`, Codex → `codex:gpt-6-luna`, Gemini CLI → `gemini:flash-lite`, Cursor/Pi → defaults). Host from `OFFLOAD_HOST` (set by our hooks/MCP launchers/in-process plugins) or env detection. `host_models` overridable.
- Bash engine: `lib/agents.sh` — native claude/codex/gemini/cursor-agent/pi workers + OpenAI-compatible/Anthropic HTTP via curl (keys via a header file, never argv). Routing in `co_route`. Claude worker hardened (no settings/MCP/slash commands, own system prompt).
- Security review (background agent) delivered 12 findings; fixed the critical one: untrusted project config (DECISIONS #18). Rest tracked as tasks.
- Research agent verified Copilot CLI / Crush / Qwen Code hook surfaces → docs/research/copilot-crush-qwen-amp.md.
- Verified: conformance 206/206 on both engines (stub agent CLIs, @host, malicious project config), bun 31/31, routing 49/49 ×2.

## 2026-11-02 ~09:00 UTC — self-contained plugin, wizard @host, zero-config default
- `plugins/harness-offload/dist/` holds the bundled TS CLI (+ pi.js, opencode.js), checked by `source-hash.mjs --check` in CI. Launchers prefer it; paths with spaces handled (`co_ts_run`).
- `offload setup` first asks "who should do the cheap work?" — own subscription (@host, default), own subscription + fallback, or chosen backends; explains the saving honestly. `--yes` defaults to `@host`. Verified through a pty with a stub `claude`.
- Doctors (bash + TS) explain @host and check each model's real backend.
- Defaults: `@host` then `@default`; `-m` exact. Real check with the real Claude CLI (bash engine, no Node needed for the worker): Haiku read of agents.sh, 11 s, 5/5 citations.
- Suites: conformance 209/209 ×2 engines, routing 49/49 ×2, bun 31/31.
