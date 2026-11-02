# Harnesses

What each integration installs, how it talks to the host, and what to know.

| Harness | Install | Read guard | Output digest | Guidance | Tools |
|---|---|---|---|---|---|
| **Claude Code** | plugin (`offload install claude`) | ✓ Read + Bash | ✓ | SessionStart | `offload` CLI on PATH |
| **Codex CLI** | plugin + hooks (`offload install codex`, trust in `/hooks`) | ✓ Bash (Codex reads via shell) | ✓ | SessionStart + skill | MCP tools (Codex sandboxes shell network) |
| **Cursor** | local plugin (`offload install cursor`) | ✓ Read + Shell | — (Cursor can't replace shell output) | always-on rule | MCP tools |
| **Gemini CLI** | extension (`offload install gemini`) | ✓ `read_file` + shell | ✓ | GEMINI.md + SessionStart | MCP tools |
| **Pi** | package (`offload install pi`) | ✓ read + bash | ✓ | system prompt | native `offload_*` tools |
| **OpenCode** (v1 & v2) | plugin (`offload install opencode`) | ✓ read + shell | ✓ | system prompt | `offload` CLI |
| **Kilo Code CLI** | plugin (`offload install kilo`) | ✓ read + bash | ✓ | system prompt | `offload` CLI |
| **GitHub Copilot CLI** | Claude plugin (`offload install copilot`) | ✓ view + bash | ✓ | SessionStart | `offload` CLI (absolute path) |
| **Qwen Code** | extension converted from the plugin (`offload install qwen`) | ✓ read_file + shell | — (no output replacement) | SessionStart | `offload` CLI |
| **Crush** | hooks in `crush.json` (`offload install crush`) | ✓ view + bash | ✓ | global context file | `offload` CLI |
| **Devin Desktop / Windsurf** | Claude plugin (`offload install devin`) | ✓ (Claude hooks) | — | — | `offload` CLI |
| **Aider** | conventions file (`offload install aider`, then `aider --read …`) | — | — | conventions | `/run offload …` |
| **MCP clients** (Cline, Zed, Continue, Goose, Kiro, VS Code, Claude Desktop) | `offload install mcp` prints each client's config | — | — | server instructions | MCP tools |

Copilot CLI, Crush and Qwen Code were verified end to end with their real binaries.



## Claude Code
- **Install:** `npx harness-offload@latest install` (asks which agents and where, shows the plan, installs on yes; `--scope project` puts it in the project's `.claude/settings.json` for your team), or directly `claude plugin install harness-offload --marketplace levgiorg/harness-offload`. From a checkout, `node packages/cli/dist/cli.js install` points Claude Code at the checkout itself. Remove: `npx harness-offload uninstall`, or `claude plugin uninstall harness-offload@harness-offload`.
- **Hooks (bash, need `jq`):** `PreToolUse(Read)` full-read guard, `PreToolUse(Bash)` dump guard + optional autowrap, `PostToolUse(Bash)` digest via `updatedToolOutput` (reads `persistedOutputPath` for >30 KB outputs and puts the verbatim lines first because Claude only sees a 2 KB preview), `SessionStart` guide.
- **CLI:** `offload` is on the Bash tool's PATH while the plugin is enabled. Skills: `/harness-offload:setup`, `/harness-offload:doctor`, `/harness-offload:stats`.
- Works with **jq + bash only**: the default model `@host` is `claude:haiku` — a lean `claude -p` on your own Claude plan. Other agent CLIs (`codex:`, `gemini:`, `cursor:`, `pi:`) and HTTP APIs (via `curl`) are native too; only `explore` over an HTTP API uses the bundled TypeScript CLI (`dist/cli.js`, needs Node 18+).

## Codex CLI
- **Install:** `offload install codex` (= `codex plugin marketplace add …` + `codex plugin add harness-offload@harness-offload`). Then **open `/hooks` and trust the Harness Offload hooks** — Codex skips untrusted plugin hooks.
- Manifest `.codex-plugin/plugin.json` → `hosts/codex/hooks.json`, `hosts/codex/mcp.json`, `hosts/codex/skills`.
- Codex has no Read tool; files are read through Bash, so the Bash guard covers `cat`/`head`/`sed -n`. Long successful output is replaced via `{"continue": false, "reason": <digest>}`.
- Codex sandboxes the agent's shell without network, so the guide and deny messages point to the **MCP tools** (`offload_read`, …), which run outside the sandbox. Hooks also run outside it.
- `bin/` isn't on Codex's PATH; hooks/MCP call `bin/offload-ts`, which runs the plugin's bundled `dist/cli.js` with Node (or a global `harness-offload`). `@host` = `codex:gpt-6-luna` via `codex exec` on your ChatGPT plan.

## Cursor
- **Install:** `offload install cursor` copies the plugin to `~/.cursor/plugins/local/harness-offload` (then *Developer: Reload Window*).
- `.cursor-plugin/plugin.json` → `hosts/cursor/hooks.json` (`preToolUse` for `Read|Shell`, `sessionStart`), `hosts/cursor/mcp.json`, an `alwaysApply` rule `hosts/cursor/rules/harness-offload.mdc`.
- Cursor can't replace shell output from a hook, so there is no digest hook; the rule steers noisy commands to `offload_run`.
- Deny reasons use Cursor's `agent_message` (Claude-format reasons would only reach the user).

## Gemini CLI
- **Install:** `offload install gemini` writes `~/.gemini/extensions/harness-offload/` (extension manifest with the MCP server, `hooks/hooks.json`, `GEMINI.md`).
- Hooks: `BeforeTool` on `read_file|run_shell_command` (start_line/end_line slices are allowed), `AfterTool` digest (Gemini marks a replaced result as an error, so the digest says the command succeeded), `SessionStart` guide.

## Pi
- **Install:** `offload install pi` (= `pi install <harness-offload package>`; the package carries `"pi": {"extensions": ["./dist/pi.js"]}`).
- The extension blocks big `read`/`bash` dumps (`tool_call` → `{block, reason}`), digests long `bash` results (`tool_result`), appends the guide (`before_agent_start`) and registers native tools `offload_read`, `offload_explore`, `offload_run`, `offload_write`, `offload_outline`.

## OpenCode (v1 and v2)
- **Install:** `offload install opencode` writes `~/.config/opencode/plugins/harness-offload.js` (v2) or `plugin/` (v1): a one-line re-export of the package's `dist/opencode.js`.
- One default export serves both: v2 uses `{id, setup}` (`tool.hook("execute.before"/"execute.after")`, `session.hook("context")`), v1 calls `server()` (`tool.execute.before/after`, `experimental.chat.system.transform`).
- When OpenCode itself is the *worker*, offload sets `OFFLOAD_DISABLE=1`, so the plugin stays out of the way.

## Kilo Code CLI
- Kilo is an OpenCode v1 fork with the same plugin API; `offload install kilo` writes `~/.config/kilo/plugin/harness-offload.js` (the same bundle as OpenCode).

## Devin Desktop / Windsurf
- Cascade was replaced by Devin Local, which reads Claude Code plugins and hooks. `offload install devin` runs `devin plugins install --local <plugin>`.

## GitHub Copilot CLI
- **Install:** `offload install copilot` (= `copilot plugin marketplace add …` + `copilot plugin install harness-offload@harness-offload`). Copilot loads the Claude Code plugin as is ("live" from a local marketplace).
- The same bash hooks detect `COPILOT_CLI=1` and speak Copilot's dialect: read arguments `path`/`view_range`, output via `modifiedResult`, the guide as top-level `additionalContext`, the CLI by absolute path (Copilot doesn't put `bin/` on PATH).
- Verified with Copilot CLI 1.0.105: a 3,000-line `view` is denied with the outline, `seq 1 400` comes back as a digest, the guide is injected.
- `@host` → `copilot:` — the Copilot CLI itself as the worker (`copilot --output-format json`, prompt on stdin, no repo instructions, `--available-tools none`, or `view grep glob` for explore), on your Copilot plan. Set `host_models.copilot` to an included model (e.g. `copilot:gpt-5-mini`) to avoid premium requests. Verified with the real CLI in both engines.

## Qwen Code
- **Install:** `offload install qwen` (= `qwen extensions install <plugin> --consent`): Qwen converts the Claude plugin into an extension.
- Reads (`read_file`, 0-based offsets) and shell dumps are guarded; the guide is injected at session start. Qwen has no documented way to replace a tool's output, so long command output is not digested — the guide steers noisy commands to `offload run`.
- `@host` → `qwen:` — Qwen Code as the worker (`--output-format json`, our system prompt, plan mode, read-only tools for explore, chat recording and background memory extraction off), on your Qwen account. Verified with Qwen Code 0.26.5.

## Crush
- **Install:** `offload install crush` merges into `~/.config/crush/crush.json` (backup next to it): `PreToolUse` hook on `^(view|bash)$`, `PostToolUse` on `^bash$` (`updated_output` digest), and the guide as a `global_context_paths` entry (Crush's `SessionStart` output is ignored; setting the list keeps Crush's two defaults). `offload uninstall crush` removes exactly those entries.
- `@host` → `crush:` — `crush run` as the worker with your providers. Because `crush run` approves every tool call, the worker runs in offload's own work directory with a `.crush.json` that disables every built-in tool and your MCP servers, and it is never used for `explore` (the next model takes over). Verified with Crush 0.99.0, including a model that tries to run a command.

## Aider
- No hooks or MCP. `offload install aider` writes a conventions file; start Aider with `aider --read <that file>` (or list it under `read:` in `~/.aider.conf.yml`) and the model will call `offload read/explore/run` through `/run`.

## MCP-only clients (Cline, Zed, Continue, Goose, Kiro, VS Code, Claude Desktop)
- `offload install mcp` prints a ready snippet for each client (config file + JSON/YAML) with a command that works on your machine (`harness-offload mcp`, or node + the bundled CLI).
- Tools: `offload_read`, `offload_explore`, `offload_run` (annotated destructive/open-world; disable with `mcp.run_tool: false`), `offload_summarize`, `offload_write`, `offload_ask`, `offload_outline`.
- These clients have no hook API, so nothing is blocked automatically: the tools are there for the model to choose.
