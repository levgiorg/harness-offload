# Copilot CLI, Crush, Qwen Code, Amp — hook surfaces (verified 2026-11-02)

Verified by running each CLI headless against a local mock OpenAI server with scripted tool
calls (read a 3000-line file, then `seq 1 400`) and a logging hook. Versions: GitHub Copilot CLI
1.0.105, Crush 0.99.0, Qwen Code 0.26.5. Amp from its plugin API docs only.

## GitHub Copilot CLI 1.0.105
- Config: user `~/.copilot/hooks/*.json` (no trust prompt); repo `.github/hooks/*.json`,
  `.github/copilot/settings*.json`, `.claude/settings*.json` (trusted folders only); plugins
  (`hooks.json` / `hooks/hooks.json` in the plugin root).
- Native schema `{"version":1,"hooks":{"preToolUse":[{"type":"command","matcher":"view|bash","bash":"…","timeoutSec":30}]}}`;
  matcher is a regex anchored `^(?:P)$`. Claude's nested PascalCase format also works.
- Env: `COPILOT_CLI=1`, `COPILOT_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`; plugin hooks also get
  `CLAUDE_PLUGIN_ROOT`/`COPILOT_PLUGIN_ROOT` and run in the plugin root. Timeout 30 s.
- preToolUse input (camelCase config): `{sessionId,timestamp,cwd,toolName,toolArgs}`; read tool
  `view {path, view_range:[start,end]}` (-1 = EOF); shell `bash {command, description}`
  (`powershell` on Windows). PascalCase config: `tool_name` mapped to Claude names (Read/Bash)
  but arguments NOT mapped (`path`/`view_range`).
- Deny: `{"permissionDecision":"deny","permissionDecisionReason":"X"}` or Claude's
  `hookSpecificOutput` form → model sees `Denied by preToolUse hook: X`. Exit 2 denies without
  the stderr text; exit 1/crash fails CLOSED; timeout fails open. Always exit 0 with JSON.
- postToolUse: `toolResult {resultType, textResultForLlm}`; fires on non-zero exits; replace
  with `{"modifiedResult":{"resultType":"success","textResultForLlm":"DIGEST"}}`; top-level
  `additionalContext` appends.
- sessionStart: top-level `{"additionalContext":"…"}` is injected (hookSpecificOutput ignored).
- Plugins: reads `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`:
  `copilot plugin marketplace add <owner/repo|path>` then `copilot plugin install <name>@<mkt>`.
  Claude-style hook output works only partly (needs modifiedResult / top-level additionalContext,
  `path`/`view_range` arguments) → branch on `COPILOT_CLI=1`.

## Crush 0.99.0
- No plugin system. Hooks in crushrc (`hook add PreToolUse --matcher '^view$' --command …`) or
  JSON `"hooks":{"PreToolUse":[{"matcher":"^bash$","command":"…","timeout":30}]}` (flat).
  Global `~/.config/crush/{crushrc,crush.json}`; project `.crushrc`, `crush.json`, `.crush.json`.
  All merge; no trust prompt. Relative commands resolve against cwd → use absolute paths.
- Env: `CRUSH=1`, `AGENT=crush`, `CRUSH_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, … Timeout 30 s, fail open.
- PreToolUse input: Claude-like `{hook_event_name, cwd, tool_name:"view", tool_input:{file_path, offset(0-based), limit}}`;
  `view` default limit 200 lines, refuses files > 200 KB. `bash {command, …}`.
- Deny: `{"decision":"deny","reason":"X"}`, Claude `hookSpecificOutput` form, or exit 2 + stderr.
- PostToolUse: `tool_response` is a string (already middle-truncated above 30 000 chars);
  replace with `{"updated_output":"DIGEST"}` or `hookSpecificOutput.updatedToolOutput`.
- SessionStart is observe-only → inject the guide via `options.context_paths` /
  `global-context-path` (setting it replaces the defaults — re-add them).
- Install: add a `source` line / hooks to `~/.config/crush/crushrc`.

## Qwen Code 0.26.5
- Settings `~/.qwen/settings.json`, project `.qwen/settings.json`; extensions in
  `~/.qwen/extensions/<name>/` with `hooks/hooks.json`. Claude's nested schema; timeout seconds
  (>= 1000 read as ms). `${CLAUDE_PLUGIN_ROOT}` substituted in extension hook commands (no env var).
- Env: `QWEN_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, `QWEN_CODE_SESSION_ID`.
- PreToolUse: `tool_name:"read_file" {file_path, offset(0-based), limit}` (no limit → 1000 lines);
  shell `run_shell_command {command}`. Claude names work as matchers. Deny via Claude's
  `hookSpecificOutput.permissionDecision` (model sees reason + additionalContext) or exit 2.
- PostToolUse: no documented replace; `hookSpecificOutput.additionalContext` appends.
  Undocumented: `{"continue":false,"stopReason":"DIGEST"}` replaces the result (sent as an error;
  fragile). Non-zero exits fire PostToolUseFailure (append only).
- SessionStart `hookSpecificOutput.additionalContext` → system prompt.
- Gemini's BeforeTool/AfterTool names are NOT supported.
- Install: `qwen extensions install <path|git|owner/repo> --consent` converts a Claude plugin
  automatically (verified: hooks fired with `Read|Bash` matchers).

## Amp (docs only)
- Plugins `.amp/plugins/*.ts` or `~/.config/amp/plugins/` (Bun). `tool.call` →
  `{action:'reject-and-continue', message}` / `{action:'modify', input}` /
  `{action:'synthesize', result}`; `tool.result` → `{status:'done', output}` replaces output.
