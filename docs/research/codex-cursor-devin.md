# Integration facts: Codex CLI, Cursor, Windsurf/Devin (verified 2026-11-01)

## Shared
- Codex and the Cursor CLI read Claude-format marketplaces and manifests: Codex looks for `.codex-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.cursor-plugin/plugin.json`, and marketplaces in `.agents/plugins/marketplace.json` → `.claude-plugin/marketplace.json` → `.cursor-plugin/marketplace.json`. Cursor: `.cursor-plugin/plugin.json` → `.claude-plugin/plugin.json`. One `.claude-plugin/marketplace.json` serves Claude Code, Codex and Cursor CLI.
- Use per-host manifests (`.codex-plugin/`, `.cursor-plugin/`) pointing `hooks` at host-specific hook files; an explicit path REPLACES the default. Don't use the portable root `plugin.json` (Codex skips its hooks).
- Sandboxes: Codex `workspace-write` and Cursor sandboxed auto-run block network for agent shell commands → `offload` via the shell may fail there. Hooks (`$SHELL -lc`) and stdio MCP servers run outside the sandbox → do model calls in hooks or the MCP server.
- Worker recursion: workers load the user's hooks; codex `--disable hooks`; offload sets `OFFLOAD_DISABLE=1` for all workers.

## Codex CLI (@openai/codex 0.166)
- Plugin `.codex-plugin/plugin.json`: name, version, description, skills, mcpServers (path or inline; `${CLAUDE_PLUGIN_ROOT}` NOT expanded in `.mcp.json` → use a PATH binary or `sh -c` with `cwd: "."`), hooks (default `./hooks/hooks.json`), interface{displayName, shortDescription, longDescription, developerName, category, capabilities, defaultPrompt[≤3], brandColor, logo}.
- Install: `codex plugin marketplace add owner/repo|path`, `codex plugin add name@marketplace`; plugin hooks need trust in `/hooks` (or `--dangerously-bypass-hook-trust`). `bin/` is NOT put on PATH.
- Hooks: Claude shape (PascalCase events, matcher groups). No Read tool: reads go through `Bash` (`tool_input.command`). Env `PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT`; no project dir var (use `cwd`). Strict output schema (unknown keys → hook failed, call proceeds).
  - PreToolUse deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` (non-empty reason). `ask` unsupported.
  - PostToolUse replace (non-error): `{"continue":false,"stopReason":"…","reason":"<digest>"}`; `tool_response` for Bash is a STRING (already truncated, ~10k tokens cap).
  - SessionStart: plain stdout or `hookSpecificOutput.additionalContext` (default limit ~2,500 tokens).
- MCP: `config.toml` `[mcp_servers.offload] command="offload" args=["mcp"] tool_timeout_sec=600`; `codex mcp add offload -- offload mcp`.
- Worker: `codex exec --json --ephemeral --skip-git-repo-check -s read-only --disable hooks --ignore-rules -C DIR -m gpt-6-luna -c model_reasoning_effort=low -` (prompt on stdin). Final = last `item.completed` with `item.type=="agent_message"` (`item.text`); usage on `turn.completed`; `error` events "Reconnecting… n/5" are transient; `turn.failed` → exit 1. Auth: `codex login` (ChatGPT plan), `CODEX_API_KEY`.

## Cursor
- Plugin `.cursor-plugin/plugin.json`: name, description, version, author, logo, rules, agents, skills, commands, hooks (path/inline), mcpServers, variables. Defaults: `rules/*.md(c)`, `skills/`, `hooks/hooks.json`, `mcp.json`. `${CURSOR_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_ROOT}` expanded in MCP command/args/env/cwd.
- Hooks `{"version":1,"hooks":{"preToolUse":[{"command":"…","matcher":"Read|Shell","timeout":30}]}}` (user `~/.cursor/hooks.json`, project `.cursor/hooks.json`, plugin hooks run from the plugin dir).
  - preToolUse input `{tool_name:"Shell"|"Read"|…, tool_input:{command}|{file_path}, cwd}`; output `{"permission":"allow|deny","agent_message":"<shown to the agent>","user_message":"…","updated_input":{…}}`.
  - postToolUse: `{"additional_context":"…"}` only (shell output cannot be replaced; only MCP output).
  - sessionStart: `{"additional_context":"…"}` (fire-and-forget) → also ship an `alwaysApply` rule.
  - Claude-format hooks are read but `permissionDecisionReason` maps to `user_message`, NOT `agent_message` → emit native Cursor fields.
- Rules `.cursor/rules/*.mdc` frontmatter `description`, `globs`, `alwaysApply`. MCP `.cursor/mcp.json` / `~/.cursor/mcp.json` `{"mcpServers":{"offload":{"type":"stdio","command":"offload","args":["mcp"]}}}`.
- Worker: `cursor-agent -p --output-format json --mode ask --trust --workspace DIR --model SLUG "<prompt>"` → `{"type":"result","is_error":false,"result":"…","usage":{inputTokens,outputTokens,…}}`. Auth `cursor-agent login`, `CURSOR_API_KEY`.

## Windsurf → Devin Desktop (Cascade removed 2026-09-08)
- Devin Local reads Claude Code hooks (`.claude/settings.json`, `~/.claude/settings.json`) and Claude plugins (`.devin-plugin/` > `.claude-plugin/`); `devin plugins install owner/repo`.
- Own hooks `.devin/hooks.v1.json` (events object, lowercase tool names `exec`, `read`…), output `{"decision":"approve|block","reason"}`, `hookSpecificOutput.additionalContext`/`updatedInput`; no output replacement. MCP `.devin/mcp_config.json`; rules `AGENTS.md`, `.devin/rules/*.md`.
