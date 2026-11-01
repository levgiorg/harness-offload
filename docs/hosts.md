# Code Offload per host

What each integration installs, how it talks to the host, and what to know.

## Claude Code
- **Install:** `offload install claude` (= `claude plugin marketplace add <bundled marketplace>` + `claude plugin install code-offload@code-offload`), or `/plugin marketplace add OWNER/code-offload`.
- **Hooks (bash, need `jq`):** `PreToolUse(Read)` full-read guard, `PreToolUse(Bash)` dump guard + optional autowrap, `PostToolUse(Bash)` digest via `updatedToolOutput` (reads `persistedOutputPath` for >30 KB outputs and puts the verbatim lines first because Claude only sees a 2 KB preview), `SessionStart` guide.
- **CLI:** `offload` is on the Bash tool's PATH while the plugin is enabled. Skills: `/code-offload:setup`, `/code-offload:doctor`, `/code-offload:stats`.
- Non-OpenCode backends (`BACKEND:MODEL`) need the `code-offload` npm package (the bash engine calls `offload worker` for transport).

## Codex CLI
- **Install:** `offload install codex` (= `codex plugin marketplace add …` + `codex plugin add code-offload@code-offload`). Then **open `/hooks` and trust the Code Offload hooks** — Codex skips untrusted plugin hooks.
- Manifest `.codex-plugin/plugin.json` → `hosts/codex/hooks.json`, `hosts/codex/mcp.json`, `hosts/codex/skills`.
- Codex has no Read tool; files are read through Bash, so the Bash guard covers `cat`/`head`/`sed -n`. Long successful output is replaced via `{"continue": false, "reason": <digest>}`.
- Codex sandboxes the agent's shell without network, so the guide and deny messages point to the **MCP tools** (`offload_read`, …), which run outside the sandbox. Hooks also run outside it.
- `bin/` isn't on Codex's PATH; hooks/MCP call `bin/offload-ts`, which needs `code-offload` installed (`npm i -g code-offload`) or falls back to `npx`.

## Cursor
- **Install:** `offload install cursor` copies the plugin to `~/.cursor/plugins/local/code-offload` (then *Developer: Reload Window*).
- `.cursor-plugin/plugin.json` → `hosts/cursor/hooks.json` (`preToolUse` for `Read|Shell`, `sessionStart`), `hosts/cursor/mcp.json`, an `alwaysApply` rule `hosts/cursor/rules/code-offload.mdc`.
- Cursor can't replace shell output from a hook, so there is no digest hook; the rule steers noisy commands to `offload_run`.
- Deny reasons use Cursor's `agent_message` (Claude-format reasons would only reach the user).

## Gemini CLI
- **Install:** `offload install gemini` writes `~/.gemini/extensions/code-offload/` (extension manifest with the MCP server, `hooks/hooks.json`, `GEMINI.md`).
- Hooks: `BeforeTool` on `read_file|run_shell_command` (start_line/end_line slices are allowed), `AfterTool` digest (Gemini marks a replaced result as an error, so the digest says the command succeeded), `SessionStart` guide.

## Pi
- **Install:** `offload install pi` (= `pi install <code-offload package>`; the package carries `"pi": {"extensions": ["./dist/pi.js"]}`).
- The extension blocks big `read`/`bash` dumps (`tool_call` → `{block, reason}`), digests long `bash` results (`tool_result`), appends the guide (`before_agent_start`) and registers native tools `offload_read`, `offload_explore`, `offload_run`, `offload_write`, `offload_outline`.

## OpenCode (v1 and v2)
- **Install:** `offload install opencode` writes `~/.config/opencode/plugins/code-offload.js` (v2) or `plugin/` (v1): a one-line re-export of the package's `dist/opencode.js`.
- One default export serves both: v2 uses `{id, setup}` (`tool.hook("execute.before"/"execute.after")`, `session.hook("context")`), v1 calls `server()` (`tool.execute.before/after`, `experimental.chat.system.transform`).
- When OpenCode itself is the *worker*, offload sets `OFFLOAD_DISABLE=1`, so the plugin stays out of the way.

## Kilo Code CLI
- Kilo is an OpenCode v1 fork with the same plugin API; `offload install kilo` writes `~/.config/kilo/plugin/code-offload.js` (the same bundle as OpenCode).

## Devin Desktop / Windsurf
- Cascade was replaced by Devin Local, which reads Claude Code plugins and hooks. `offload install devin` runs `devin plugins install --local <plugin>`.

## Any MCP client
- `offload mcp` (stdio). Config: `{"mcpServers": {"offload": {"command": "code-offload", "args": ["mcp"]}}}`.
- Tools: `offload_read`, `offload_explore`, `offload_run`, `offload_summarize`, `offload_write`, `offload_ask`, `offload_outline`.
