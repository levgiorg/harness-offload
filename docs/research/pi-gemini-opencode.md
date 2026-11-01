# Integration facts: Pi, Gemini CLI, OpenCode plugins (verified 2026-11-01)

## Pi (`@earendil-works/pi-coding-agent` 1.4.0, bin `pi`, Node ≥22.19; old `@mariozechner/...` is deprecated)
- Package: package.json `"keywords": ["pi-package"]`, `"pi": {"extensions": ["./src/extension.ts"], "skills": [...], "prompts": [...]}`;
  peerDependencies "*" on `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`. Install: `pi install npm:pkg | git:github.com/o/r | ./path` (`-l` project).
- Settings: `~/.pi/agent/settings.json` (`PI_CODING_AGENT_DIR`), project `.pi/settings.json` (needs trust); extensions dirs `~/.pi/agent/extensions/`, `.pi/extensions/` (.ts loaded via jiti).
- Extension: `export default function (pi: ExtensionAPI) {}`
  - `pi.on("tool_call", (event, ctx) => ({ block: true, reason }))`; event `{toolName, toolCallId, input}` (input mutable). Throwing blocks.
  - `pi.on("tool_result", (event) => ({ content: [{type:"text", text}], structuredContent }))` — return structuredContent too or it is dropped.
  - `pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.harness_offload = TEXT })` or `appendSystemPrompt += ...`.
  - `pi.registerTool(defineTool({ name, label, description, parameters: Type.Object({...}), execute(id, params, signal, onUpdate, ctx) }))`; `pi.registerCommand(name, {description, handler})`.
  - Tools: `read {path, offset?, limit?}` (2000 lines/50KB cap), `bash {command, timeout?}` (structured `{output, truncated, full_output_path?, exit_code}`), `edit`, `write`, `grep`, `find`, `ls`.
- Worker: `pi -p --mode json --no-session -na -ne -ns -nc --no-mcp --tools read,grep,find,ls|-nt --model provider/id[:thinking] --system-prompt TEXT "prompt"`;
  piped stdin is PREPENDED to the prompt. JSON events: `session`, `message_end` {message: {role, content[], usage, stopReason, errorMessage}}, `agent_settled`.
  JSON mode exits 0 even when the response failed → inspect `stopReason == "error"`. No API key → exit 1. `pi auth check --provider X --json` (0 ready/1 not/2 invalid).
  Logins: Claude Pro/Max (bills extra usage!), ChatGPT Plus/Pro (`openai-codex`), Copilot, Kimi, xAI, OpenRouter… No Gemini OAuth.

## Gemini CLI (`@google/gemini-cli` 0.66)
- Extension: `~/.gemini/extensions/<name>/gemini-extension.json` {name, version, description, mcpServers{cmd,args,cwd}, contextFileName, excludeTools, settings[]};
  hooks in the extension's `hooks/hooks.json` `{ "hooks": { "BeforeTool": [...] } }`; `commands/*.toml`, `skills/`, vars `${extensionPath}`.
  Install: `gemini extensions install <github-url|path>`; `gemini extensions link <path>`.
- Hooks (settings.json `hooks` or extension hooks.json): events SessionStart, BeforeTool, AfterTool, BeforeAgent, …
  `{"BeforeTool":[{"matcher":"read_file|run_shell_command","hooks":[{"type":"command","command":"…","timeout":5000}]}]}` (timeout ms).
  Input: session_id, cwd, hook_event_name, tool_name, tool_input; AfterTool adds tool_response {llmContent, returnDisplay, error?}; SessionStart has source.
  Output: BeforeTool block `{"decision":"deny","reason":"…"}`; AfterTool `{"decision":"deny","reason":DIGEST}` replaces but marks error,
  `hookSpecificOutput.additionalContext` appends; SessionStart `hookSpecificOutput.additionalContext`. Exit 2 = block with stderr.
  Tools: `read_file {file_path, start_line?, end_line?}`, `read_many_files`, `run_shell_command {command}`, `grep_search`, `glob`, `list_directory`.
- Worker: `gemini -p "…" -o json -m flash --approval-mode plan --skip-trust -e none` (stdin + -p text). JSON `{session_id, response, stats, error?{type,message,code}}`.
  Exit 41 auth, 42 input, 52 config, 53 turn limit, 55 untrusted workspace. `GEMINI_SYSTEM_MD=/path.md` replaces the system prompt.
  Auth: cached Google login (free 1000 req/day), GEMINI_API_KEY, Vertex.

## OpenCode plugins
- v1 (`@opencode-ai/plugin`): `export const P: Plugin = async (ctx) => ({ "tool.execute.before": async (input:{tool}, output:{args}) => { throw new Error(reason) }, "tool.execute.after": async (input, output:{output}) => { output.output = digest }, "experimental.chat.system.transform": async (_, out:{system:string[]}) => { out.system.push(TEXT) } })`.
  Tools: `read {filePath, offset?, limit?}`, `bash {command}`. Load: `.opencode/plugin(s)/*.ts`, `~/.config/opencode/plugin(s)/`, config `"plugin": [...]`.
- v2 (`@opencode/plugin`): `export default Plugin.define({ id, async setup(ctx) { await ctx.tool.hook("execute.before", e => { if (e.tool === "read") throw new Error(...) }); await ctx.tool.hook("execute.after", e => { if (e.status === "completed" && e.tool === "shell") e.result = {...e.result, content: digest} }); await ctx.session.hook("context", e => e.system.push({type:"text", text})) } })`.
  Tools: `read {path, offset?, limit?}`, `shell {command}`. Load: `.opencode/plugins/`, `~/.config/opencode/plugins/`, config `"plugins": [...]`.
  Dual export: `export default { ...Plugin.define({id, setup}), async server() { return { "tool.execute.before": … } } }`.

## Other harnesses (priority order)
Codex CLI (Claude-style hooks `~/.codex/hooks.json`), Kilo Code (OpenCode v1 fork: same plugin API in `.kilo/plugin/`), GitHub Copilot CLI (`.github/hooks/*.json`, also reads `.claude/settings.json` hooks), Crush (hooks incl. PostToolUse `updated_output`), Qwen Code (Gemini fork, Claude-compatible hooks in `.qwen/settings.json`), Amp (`.amp/plugins/*.ts`), Cline (SDK plugins), Goose (MCP), Zed (MCP), Aider (conventions only). Roo Code shut down 2026-05-15.
