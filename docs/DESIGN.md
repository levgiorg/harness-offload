# Harness Offload — design notes

Why the code is shaped the way it is. Prior art and credits are in the README's
"Acknowledgements" section; validation runs are in `docs/VALIDATION.md`.

## 0. Principles
- **Deterministic first, model second.** Anything a script can extract (error lines, counts, tails,
  outlines) is extracted by a script; the cheap model only adds an overview, and its claims are
  checked (citations) or labelled.
- **Never wedge the host.** Every hook fails open: missing tools, broken config, quota walls → the
  host's own tools run unimpeded.
- **Cheap models never act.** Workers are deny-all (the explorer may only read/grep/glob, never
  secrets). Only the orchestrating agent edits files or runs commands.
- **Avoid extra turns.** A deny that costs the agent a turn re-reads its whole context; deny
  messages therefore carry an outline and a ready-to-run command.
- **One config, every host.** `~/.config/harness-offload/config.json` + `<repo>/.harness-offload.json`
  serve Claude Code, Codex, Cursor, Pi, Gemini CLI, OpenCode, Windsurf and MCP clients alike.

## 1. Facts the implementation relies on

### Claude Code (verified in 2.1.316 with `tests/e2e-claude.sh`)
- `PreToolUse` → `hookSpecificOutput.permissionDecision: deny|ask|allow` + `permissionDecisionReason` (shown to Claude on deny as `PreToolUse:Read hook error: …`); `additionalContext` adds a note without deciding.
- `PostToolUse` → `hookSpecificOutput.updatedToolOutput` **replaces the output of built-in tools**; for Bash the value must keep the `tool_response` shape (`stdout, stderr, interrupted, isImage, …`) or it is silently ignored.
- `tool_response.stdout` is capped at ~30K chars; when the output was larger, `tool_response.persistedOutputPath` / `persistedOutputSize` point to the full output, and Claude is shown only a 2 KB preview of whatever the hook returns (→ "compact" digests put the verbatim lines first).
- Failed commands go to `PostToolUseFailure`, whose output cannot be replaced (Claude Code already trims it to ~10K chars) → `offload run`.
- Plugin `bin/` is on the Bash tool's PATH; `${CLAUDE_PLUGIN_ROOT}` is expanded in hook commands only; `userConfig` values reach hooks but not Bash commands → offload uses its own config file.
- Hook input carries `agent_id` only inside subagents.

### OpenCode (verified with 1.19.5 and 2.2.5 against a mock provider)
- Two lines are in use: V1 (`opencode-ai` npm package, `agent.<name>` with `prompt`/`permission` map/`temperature`) and V2 (`@opencode/cli`, `agents.<name>` with `system` + ordered `permissions` array; `-m provider/model#variant`; `run` talks to a shared background service unless `--standalone`).
- `OPENCODE_CONFIG_CONTENT` is merged last over the user's config (providers and logins keep working). In V2 it only reaches the run with `--standalone`.
- Piped stdin is appended to the message; argv words with spaces get wrapped in quotes → offload sends the whole prompt on stdin.
- `--format json` emits `step_start`, `text`, `tool_use`, `step_finish` (tokens, cost) and `error` events. The final answer = text of the last step that has any.
- Non-retryable errors exit 1 with an `error` event (V1 `{name, data.message}`, V2 `{type: "provider.auth" | "provider.no-route" | …, message}`). Rate limits/quota are **retried silently forever** (V1: `stream error` log lines with `--print-logs`; V2: repeated `step_start`) → offload counts retries and stops after `max_stream_errors`.
- A catch-all deny removes tools from the model's tool list (V2 still lists `skill`, but calls are denied).
- Every run creates a session in the user's history → offload deletes it in the background (`--standalone` on V2 so the user's daemon isn't started).
- Without `--title` a second LLM call generates a title → offload always passes `--title`.
- V1 falls back to `CLAUDE.md` / `~/.claude/skills` → `OPENCODE_DISABLE_CLAUDE_CODE=1`. Project `AGENTS.md` is loaded from the working dir upward → no-tool workers run in an empty work dir.

## 2. Lessons from comparable tools (survey, Nov 2026)

- Hooks enforce; skills/CLAUDE.md alone are followed ~half the time.
- Every deny that costs an extra turn re-reads the context; JetBrains' A/B of a Bash-output compressor found billed cost *up* 7.6% at low effort despite large "tokens saved" counters. → generous thresholds, outline + ready command in the deny, measure with `/usage`.
- For CI/test logs, deterministic grep+tail matched LLM summaries at ~1/25 of the tokens (LogDx-CI) → verbatim key lines are primary, the model summary is an extra.
- Worker summaries without line anchors can't be used for edits → verified citations.
- Fail open, typed errors, fallback chains with cooldowns .
- Lock workers down; never let a cheap model edit or run commands; keep secrets out.

## 3. Ideas not built (yet)

- A warm OpenCode server to skip the 1.5–3 s start-up per call (V2 `generate/text` endpoint would also avoid sessions).
- Context-aware thresholds (estimate current context size from `transcript_path`; delegate more as the context grows).
- Async digests for very slow models.
- Token-billing A/B harness on top of `claude plugin eval`.
