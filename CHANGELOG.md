# Changelog

## 0.2.0 — unreleased
- Renamed to **Harness Offload** (`offload` CLI, `harness-offload` package). MIT.
- TypeScript engine (`harness-offload` npm package) alongside the dependency-free bash engine; shared conformance suite.
- Connectors: OpenCode v1/v2, Pi, Codex CLI, Gemini CLI, Cursor CLI, Claude Code, 16 HTTP presets (OpenAI-compatible + Anthropic) and custom endpoints; `BACKEND:MODEL` refs; fallback chains across backends.
- Hosts: Claude Code, Codex, Cursor, Gemini CLI, Pi, OpenCode, Devin/Windsurf, any MCP client (`offload mcp`).
- `offload setup` wizard, `offload install/uninstall <host>`, standalone binaries, install scripts, CI.
- **Same subscription by default:** `@host` resolves to the calling harness's own small model (Claude Code → Haiku via a lean `claude -p`, Codex → `codex exec`, Gemini CLI → Flash-Lite, Copilot CLI, Qwen Code and Crush as their own workers); defaults are `@host` then OpenCode's default model. The wizard asks this first. `-m MODEL` is used alone.
- The bash engine runs the agent-CLI connectors and HTTP APIs (curl) natively, so the Claude Code plugin works with bash + jq only; the TypeScript CLI is bundled inside the plugin (`dist/`, checked in CI).
- More harnesses: GitHub Copilot CLI, Qwen Code, Crush (verified with the real binaries), Aider (conventions file), MCP snippets for Cline, Zed, Continue, Goose, Kiro, VS Code and Claude Desktop.
- Security review fixes: untrusted project config (`offload config trust`), sandboxed explore tools (real-path containment, no symlinks, `.git` refused, regex deadline, caps), redaction of answers/command lines/log names, wider credential patterns, bounded citation checks, fail-open in-process plugins, process-tree cleanup, MCP limits and cancellation, Windows spawning without a shell. See SECURITY.md.
- `offload dashboard`: offline HTML report. Landing page in `site/`.

## 0.1.0
- First prototype: Claude Code plugin with read guard, Bash digest and `read/explore/run/write` over OpenCode.
