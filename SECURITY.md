# Security

Harness Offload sends file contents and command output to the worker backends you configure
(your agent's own plan via `@host`, OpenCode providers, other agent CLIs, HTTP APIs, local models).
Review which providers you use and whether they train on prompts.

## Trust model

| Input | Trusted? | What it may do |
|---|---|---|
| Your user config (`~/.config/harness-offload/config.json`) | yes | everything, including binaries, endpoints and privacy settings |
| A repository's `.harness-offload.json` | **no** (unless you run `offload config trust` in it) | models, variants, thresholds, hook behaviour; it can only *add* secret globs. It cannot choose binaries, endpoints, the backend, the state directory or relax privacy settings. `offload doctor` lists ignored keys. |
| Worker model output | no | text only. Answers (except generated code) are redacted; citations are checked by reading only regular files ≤ 8 MB inside the project. |
| Tool calls from HTTP explore workers | no | read-only `read_file` / `grep` / `glob` / `list_dir`, confined to the project's real directory (symlinks never followed out), `.git` and secret files refused, regexes run with a 10 s deadline, every result size-capped and redacted. |

## Safeguards

- Secret files (`privacy.secret_globs`, matched case-insensitively and on symlink targets) are never
  sent; links inside a directory are not followed.
- Credential redaction of everything bound for a worker (file contents, command output, command lines,
  log file names, stats), and of worker answers.
- Workers run deny-all: OpenCode agents with catch-all deny permissions; `claude -p` without
  settings/MCP/slash commands and with secret files in `--disallowedTools` for explore; `codex exec` in a
  read-only sandbox; Gemini and Qwen Code in plan mode; Cursor in ask mode; Copilot CLI with
  `--available-tools none` (view/grep/glob for explore); Pi without tools (read-only tools for explore);
  Crush (whose `crush run` approves every tool call) only for plain questions, in offload's work
  directory with every built-in tool and the user's MCP servers disabled. Every worker gets `OFFLOAD_DISABLE=1` (no recursion into offload's own hooks).
- Hooks and in-process plugins fail open: an internal error never blocks your agent's tools.
- Time limits everywhere: per-model timeouts, a total budget for hook digests, MCP call limits, client
  cancellation kills the work; worker process trees are killed on timeout and when offload exits.
- API keys: stored owner-only (mode 600), passed to `curl` through a header file (never on the command
  line), masked in `offload config show`.
- Installers: `install.sh` / `install.ps1` install a release binary only when its SHA-256 matches the
  release's own `SHA256SUMS` (downloaded to a temporary file first, so a bad download never replaces a
  working binary). `offload install --dry-run` shows the exact lines it would change in a settings file
  of yours (Crush's `crush.json`); a second install changes nothing and keeps the first backup.
- No shell on Windows: commands are started directly (npm shims resolved to their script), with
  `cmd.exe` only for other batch files and every argument escaped.

## Known limits

- Agent-CLI explore workers other than Claude (Codex, Gemini, Copilot, Qwen, Cursor, Pi) have no per-file deny rules;
  they can read secret files inside the project, so their answers are redacted, but prefer `@host` on
  Claude Code, OpenCode or an HTTP backend for explore in repositories with secrets.
- MCP `offload_run` executes shell commands outside a host's own sandbox (Codex, Cursor). It is
  annotated as destructive/open-world so hosts that honour annotations ask first; set
  `mcp.run_tool: false` to remove it.
- Redaction is pattern-based and cannot catch every secret format.

Please report vulnerabilities privately via GitHub Security Advisories on levgiorg/harness-offload.
