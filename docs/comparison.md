# How Harness Offload compares

Tools that keep coding agents' context small take different routes. This table is from each project's own
README and docs as read in November 2026 (sources and notes: [autopilot/RESEARCH.md](autopilot/RESEARCH.md));
projects change, so check theirs before deciding. "—" means "not that we found", not "impossible".

| | Harness Offload | shunt (Spotify) | RTK | squeez | context-mode | claude-code-router |
|---|---|---|---|---|---|---|
| Approach | hooks + a cheap **worker model** reads for the agent | hooks + a worker on Spotify's internal Portal | rewrites shell commands to its own filters | compresses every tool's output after the fact | MCP tools: the agent runs code, only stdout comes back; lexical index | proxy that routes the *main* model's requests |
| Huge file reads | blocked with an outline; question answered by the worker | blocked over 350 lines; worker answers | its own `rtk read` | output compressed after the read | agent-written scripts | — |
| Long command output | digest: verbatim error lines + tail + optional summary; full log kept | — | per-command filters (git, tests, linters) | templates, dedup, truncation | indexed; intent search | — |
| Huge searches | counts per file + first matches + log | — | grouped output | grouped by folder | indexed | — |
| Answers checked | every `path:Lx-Ly` quote verified against the file | — | n/a (no model) | n/a (no model) | n/a | — |
| Who pays for the worker | your agent's own plan by default (`@host`: Claude → Haiku, Codex, Gemini…) or any API/local model | Spotify Portal | nothing (no model) | nothing | nothing | your API keys |
| Agents | Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, Qwen Code, Crush, OpenCode, Kilo, Pi, Devin/Windsurf, MCP clients | Claude Code | 18 (hooks or rules files) | Claude Code, Copilot CLI, OpenCode | 18 clients | Claude Code |
| Licence | MIT | Apache-2.0 | CLI Apache-2.0; engine/proxy BUSL-1.1 | Apache-2.0 | ELv2 | MIT |

**When something else fits better.** If you never want a second model involved, a deterministic
filter (RTK, squeez) is simpler and costs nothing per call. If you want to change which model *is* your
agent, use a router; Harness Offload leaves your main model alone. Harness Offload is for keeping the
main model and moving the bulk reading to a cheaper one — with the answers checked.
