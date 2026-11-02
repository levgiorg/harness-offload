# Harness Offload — product truth

> Inferred from the repository, docs/VALIDATION.md and the owner's requests (the owner was unavailable
> for the interview round; every fact below comes from those sources). Open decisions are marked.

## Users and job
- Developers who drive a coding agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, OpenCode,
  Pi, Qwen Code, Crush, Kilo, Amp, Devin/Windsurf, MCP clients) on a paid plan and hit context or usage
  limits because the agent reads huge files, dumps long command output and greps whole repositories.
- Job: keep that bulk out of the expensive agent's context without changing how they work.

## Mechanism (what is different)
- Hooks intercept a huge read or a noisy command. The agent gets an outline and options instead of
  the dump; a cheap worker model reads the material and answers with `path:Lx-Ly` citations whose quotes
  are machine-checked against the files. Long command output is replaced by a digest (verbatim error
  lines + tail + full-log path).
- Workers run on plans the user already pays for: by default the harness's own small model (`@host`:
  Claude Code → Haiku via `claude -p`, Codex → `codex exec`, Gemini CLI → Flash-Lite), or OpenCode
  Zen/Go, ChatGPT, API keys, local models.

## Evidence (real, measured — docs/VALIDATION.md)
- 919-line module: 9,666 → ~453 tokens returned (95%), 4/4 facts. 2,323-line CI log: 32,771 → ~659 (97%),
  both failures named with file:line. Generated pytest: 28/28 passing without edits.
- Real Claude Code run: ~4 KB entered context instead of 48 KB.
- Verified in real hosts: Claude Code, OpenCode v1/v2, Pi, Codex, Copilot CLI, Crush, Qwen Code.

## Constraints
- MIT, open source; GitHub owner is a placeholder `OWNER` until publication.
- CLI `offload` (alias `harness-offload`); npm `harness-offload`. Works with bash + jq; Node for some paths.
- Never invent customers, prices, star counts or benchmarks.

## Voice
- Plain, specific, technical; names things the way a developer sees them (reads, logs, tokens, plans).

## Platform
- web (static landing page in `site/`, GitHub Pages) and a local generated HTML report (`offload dashboard`).

## Open decisions
- Final domain, logo and social card: undecided.
