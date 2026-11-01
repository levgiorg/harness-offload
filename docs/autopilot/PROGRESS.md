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
