# Changelog

## 0.2.0 — unreleased
- Renamed to **Harness Offload** (`offload` CLI, `harness-offload` package). MIT.
- TypeScript engine (`harness-offload` npm package) alongside the dependency-free bash engine; shared conformance suite.
- Connectors: OpenCode v1/v2, Pi, Codex CLI, Gemini CLI, Cursor CLI, Claude Code, 16 HTTP presets (OpenAI-compatible + Anthropic) and custom endpoints; `BACKEND:MODEL` refs; fallback chains across backends.
- Hosts: Claude Code, Codex, Cursor, Gemini CLI, Pi, OpenCode, Devin/Windsurf, any MCP client (`offload mcp`).
- `offload setup` wizard, `offload install/uninstall <host>`, standalone binaries, install scripts, CI.

## 0.1.0
- First prototype: Claude Code plugin with read guard, Bash digest and `read/explore/run/write` over OpenCode.
