# Research: context offloading, output compression, delegation (2026-11-02)

Competitive and technical survey for Harness Offload. Sources are project READMEs, official docs and
source trees read on 2026-11-02 (links below each entry). Savings figures are **self-reported by each
project** unless stated otherwise. Anything marked **(unverified)** came from secondary sources or could
not be confirmed against a primary page. The GitHub API was not reachable from this session, so license
fields come from README badges / repo pages, not from `LICENSE` files.

**Rule reminder:** this file is the only place these projects are named. No third-party code is copied
into the repo; every "adopt" item below is an idea to implement from scratch in both engines.

What we already have (baseline for "how it differs"): PreToolUse guards that deny huge `Read`/`cat` with
a deterministic outline; PostToolUse digest of long Bash output (`updatedToolOutput`, verbatim error
lines + log path); `offload read|explore|run|summarize|write|ask|task` delegated to a cheap worker
(`@host` = the harness's own small model on the user's plan); machine-checked `path:Lx-Ly` citations;
MCP server; installer for ~20 hosts; fallback chains with cooldowns; `offload stats` (bytes/4).

---

## A. Context offloading plugins and the Claude Code platform

### 1. Spotify `shunt` (spotify/portal-ai-plugins)
- **What:** Claude Code plugin routing bulk reads and boilerplate generation to "AiKA modes"
  (`bulk-reader`, `code-writer`) on a Spotify Portal instance. Three layers: hooks (hard gate) →
  scripts (`bulk-read --question --paths`, `code-write --spec --reference --target`) → skills (soft
  guidance). Hooks: `check-file-size` (Read; blocks full reads > `SHUNT_MIN_LINES`=350, allows
  offset/limit reads, missing files) and `check-bash-read` (cat/head/tail/less/more on large files;
  allows pipes, redirections, targeted flags). Files are wrapped in `<file path="…">` tags; temperature
  0.2; payload cap `SHUNT_MAX_PAYLOAD_BYTES` (400 KB, 120 KB on Linux because input goes on argv);
  timeout 180 s. `evals/run.sh`: 51 offline hook/transport tests plus `--benchmark`.
- **Why it works:** the frontier model only sees the question and a bullet answer; the 4,000-line file
  goes to a cheap model. 82–94 % fewer tokens on a 162 k-line Java monorepo (README table).
- **Differs from us:** single backend (Portal/AiKA), Claude Code only, no citations, no output digest,
  no caching (re-sends files on follow-ups), code-writer not hook-enforced. We are its generalisation
  (multi-host, multi-backend, citations, Bash digests). Our origin (credited in README).
- **Limitations:** argv size ceiling, Portal dependency, best-case benchmark on one codebase.
- **License:** Apache-2.0 (repo).
- **Adopt?** maybe — idea: their benchmark table reports *with/without* per scenario on a named repo.
  Publish the same four-scenario table from `evals/benchmark.sh` in `docs/VALIDATION.md` on a public
  repo anyone can re-run.
- Src: github.com/spotify/portal-ai-plugins (plugins/shunt/README.md)

### 2. Claude Code hooks (2026 surface)
- **What (verified in code.claude.com/docs/en/hooks):** handler types `command`, `http`, `mcp_tool`,
  `prompt` (single-turn LLM, optional `model`), `agent` (experimental, can Read/Grep). Common fields
  `if` (permission-rule syntax filter), `timeout`, `statusMessage`, `async`, `asyncRewake` (background,
  wakes Claude on exit 2 with stderr as a system reminder), `onFailure: "block"`. PreToolUse:
  `permissionDecision` allow/deny/ask/**defer**, `updatedInput`, `additionalContext`. PostToolUse:
  **`updatedToolOutput` works for all tools** (must match the tool's output shape; mismatches are
  silently ignored for built-ins; telemetry keeps the original), `updatedMCPToolOutput` legacy,
  `classifierContext` (v2.1.236+). SessionStart input: `source` (startup/resume/clear/compact/fork) and
  on resume/fork `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`,
  `seconds_since_last_response` (v2.1.251+); output `additionalContext`, `initialUserMessage`,
  `sessionTitle`, `watchPaths`, `reloadSkills`. SubagentStart: `additionalContext` injected into the
  subagent (re-injected after compaction only). Common input: `transcript_path` (written async, may
  lag), `agent_id`/`agent_type`. PostToolUse input has `duration_ms`.
- **Differs from us:** we already use PreToolUse deny + PostToolUse `updatedToolOutput` (post-bash merges
  into `tool_response`, which matches the "same shape" rule). Unused so far: `if` filters (could skip
  spawning our hook at all for most Bash calls), `SubagentStart`, `asyncRewake`, SessionStart
  `context_tokens`, `defer`.
- **Limitations:** GitHub issues reported `updatedToolOutput` ignored for Bash on v2.1.121 and
  v2.1.173 (both marked resolved; fixing version **unverified**) → keep a version check in `doctor`.
- **Adopt?** yes — (a) hook `if` matchers to cut per-call cost; (b) SubagentStart guide injection;
  (c) context-aware thresholds (see #3).

### 3. Claude Code status line JSON
- **What:** statusline command gets on stdin `context_window.{used_percentage, remaining_percentage,
  total_input_tokens, context_window_size, current_usage}`, `cost.total_cost_usd`,
  `rate_limits.five_hour/seven_day.used_percentage` (subscribers), `transcript_path`; optional
  `refreshInterval`. Plugins can only ship `subagentStatusLine` (plugin `settings` honours `agent` and
  `subagentStatusLine` only), not the main status line.
- **Why it matters:** it is the only cheap, exact, live "how full is the context" signal. Hooks don't get it.
- **Adopt?** yes — idea: `offload install claude --statusline` wraps (not replaces) the user's status
  line: a tiny shim writes `used_percentage` + `context_window_size` to
  `${CLAUDE_PLUGIN_DATA}/ctx.<session>` then execs the user's original command. Hooks read one small
  file to scale `read_threshold_*` (this is the open "context-aware thresholds" goal, without parsing
  the transcript). Fallback: SessionStart `context_tokens`, then transcript tail.

### 4. Claude Code plugin manifest (2026)
- **What (verified, plugins-reference):** `bin/` is put on the Bash tool's PATH (claude.ai/Cowork refuse
  plugins with top-level `bin/`); `${CLAUDE_PLUGIN_DATA}` persistent per-plugin dir kept across updates;
  `userConfig` (typed, `sensitive` → secure store, exported as `CLAUDE_PLUGIN_OPTION_<KEY>` to hooks,
  shown in `/config`, `options` pickers v2.1.271+); `dependencies`; `lspServers`; `experimental.monitors`
  (persistent background processes, `when: on-skill-invoke:<skill>`); `experimental.evals` +
  `claude plugin eval`; `claude plugin validate --strict`; reserved-name checks; exec-form hooks with
  `args` (no shell quoting).
- **Adopt?** yes — (a) move tunables (backend, thresholds, `@host` on/off) to `userConfig` so users
  configure in `/config` without editing JSON; (b) keep cooldown/stats state in `CLAUDE_PLUGIN_DATA`
  (survives updates); (c) ship `experimental.evals` cases so `claude plugin eval` exercises routing;
  (d) exec-form hooks to drop a `sh -c` hop on the hot path.

### 5. Subagents, `/loop`, Monitor
- **What:** subagent frontmatter `model` (`haiku`…), `tools`/`disallowedTools`, `maxTurns`,
  `permissionMode`, `background`, `isolation: worktree`, `memory`; only the final report returns to the
  parent. `/loop` = session cron (`CronCreate`), self-paced 1 min–1 h; the Monitor tool streams a
  background script's lines instead of polling.
- **Differs:** a Haiku `Explore` subagent is Claude Code's built-in answer to "read bulk cheaply". It
  is Claude-only, has no citation check, and still bills the plan's subagent tokens; our worker gives a
  verified, bounded answer and works on every host. Subagents themselves are bulk readers our hooks
  already guard (hooks fire inside subagents).
- **Adopt?** maybe — idea: ship a plugin agent `offload:reader` (`model: haiku`, tools: Bash(offload *)
  only) as a host-native alternative when no worker CLI is configured, and inject a short guide via
  SubagentStart into `Explore`/`general-purpose` so they call `offload` instead of reading 5 files.

### 6. Claude Code native large-output handling
- **What:** oversized tool results are persisted to a file and replaced by a short preview
  ("Output too large … Full output saved to …", observed in this very session for a 64.8 KB WebFetch
  result). `bashOutputMaxChars` setting (v2.1.261+, cap 128 k chars) replaces `BASH_MAX_OUTPUT_LENGTH`
  **(unverified: secondary sources only)**.
- **Differs:** the native preview is the *first ~2 KB* (head), which for logs is usually the useless
  part; our digest keeps error lines and the tail. Our value is *what* is kept, not *that* it is cut.
- **Adopt?** yes — idea: a conformance/e2e case asserting our digest beats a head-2KB preview on
  "failure named" recall for the CI-log fixtures (state it in docs/how-it-works.md).

---

## B. Tool-output compressors

### 7. RTK — Rust Token Killer (rtk-ai/rtk)
- **What:** single Rust binary; a PreToolUse hook rewrites Bash commands (`git status` → `rtk git
  status`) via `updatedInput`; per-command filters: smart filtering, grouping (files by dir, errors by
  type), truncation, dedup of repeated lines into counts. Examples: `git log` → hash/author/subject,
  `git add/commit/push` → one line, `cargo/npm test` failures only, `go test` parses NDJSON, `ruff`
  grouped by rule. `rtk gain` (savings history, JSON), `rtk discover` (missed opportunities),
  `rtk bypass <cmd>`. 18 agents (hooks where available, rules files elsewhere). Claims 60–90 %.
- **Why it works:** deterministic, <10 ms, command-specific knowledge beats a generic truncator.
- **Differs:** no model at all, no file-read guard beyond its own `rtk read`, rewrites the agent's
  command (changes semantics risk). We digest *after* execution and keep the raw log on disk.
- **Limitations:** per-command filter maintenance; built-in Read/Grep bypass it; savings measured on
  Bash output only (bytes/4).
- **License:** CLI Apache-2.0; `engine/` and `proxy/` BUSL-1.1; `rtk-oss` edition Apache-only.
- **Adopt?** yes — idea: a `discover` mode: `offload stats --missed` scans the session log for Bash
  outputs that passed under the threshold but were large in aggregate (same command repeated), and
  for commands with known quiet flags. Not command rewriting by default.
- Src: github.com/rtk-ai/rtk

### 8. context-mode (mksglu/context-mode)
- **What:** MCP server + hooks. `ctx_execute` runs code in a subprocess (12 languages) and returns only
  stdout; `ctx_execute_file`, `ctx_batch_execute`, `ctx_fetch_and_index`, `ctx_index`/`ctx_search`.
  Index = SQLite FTS5, BM25 + Porter stemming, trigram search fused with Reciprocal Rank Fusion,
  headings weighted 5×, proximity rerank, typo correction. **Intent-driven search:** output > 5 KB with
  an `intent` → full output indexed, only matching sections returned plus a vocabulary of searchable
  terms. Throttling: repeated searches return fewer results; > 9 calls redirected to batch. Session
  continuity: events in SQLite; PreCompact builds a ~2 KB priority-tiered snapshot restored at
  SessionStart(compact/resume). Hooks on Claude Code: PreToolUse, PostToolUse, UserPromptSubmit,
  PreCompact, SessionStart, Stop; 18 clients.
- **Differs:** no worker model — the *agent* writes the processing code; retrieval is lexical. We use a
  model for overview + verified citations.
- **Limitations:** the agent must write good scripts; BM25 misses semantic questions.
- **License:** README badge says **ELv2** (author's blog said MIT earlier; treat as ELv2).
- **Adopt?** yes — idea A: `offload run --intent "<q>"` keeps the whole log, scores fixed-size line
  windows by query-term overlap (deterministic, awk/TS), returns the top windows verbatim + a list of
  distinctive terms for follow-up `offload grep-log <id> <term>`. Idea B: PreCompact snapshot of
  offload artifacts (see Top 15 #8).
- Src: github.com/mksglu/context-mode

### 9. squeez (claudioemmanuel/squeez)
- **What:** Rust hook compressor (Claude Code, Copilot CLI, OpenCode). Pipeline: strip ANSI/progress
  bars/timestamps → collapse repeats; near-identical lines that differ only by IDs/timestamps merge into
  one `[×N]` template line → group same-dir files → head/tail truncation. > 500 lines → ≤ 40-line
  summary with an "identifier factsheet" (SHAs, UUIDs, ticket codes kept verbatim). **Cross-call
  dedup** over the last 16 calls (FNV-1a exact hash + MinHash trigram Jaccard ≥ 0.85). Reversible:
  `squeez_retrieve`. **Net-win gate** (skip when savings < header cost). **Adaptive intensity**
  (stricter limits at ≥ 80 % of token budget). Hooks: PreToolUse (wrap Bash, Read/Grep limits,
  compress long Agent prompts), PostToolUse (rewrite Read/Grep/Glob output), SubagentStop, PreCompact,
  PostCompact. Benchmark: 46 scenarios, 91 % (chars/4), cross-checked with cl100k on 22 fixtures.
- **Differs:** deterministic only; compresses *every* tool (incl. Read output after the fact).
- **License:** Apache-2.0.
- **Adopt?** yes — three ideas: template-merge of near-identical lines; identifier factsheet in digests;
  cross-call "same output as call N" short-circuit. All implementable in awk + TS.
- Src: github.com/claudioemmanuel/squeez

### 10. token-optimizer (alexgreensh/token-optimizer)
- **What:** audit + hooks. Scores structural waste (CLAUDE.md, skills, MCP tool definitions, memory
  files), 11 behavioural detectors (misrouting, retry loops, cache-breaking). PreToolUse: re-reads
  return a diff or a skeleton; PostToolUse archives originals (`expand` later). Checkpoints at several
  context-fill thresholds; heuristic post-compaction digest without an LLM. Splits savings into
  **metered vs estimated** and says its own $ figure is mostly modelled.
- **Differs:** broader (static context audit), no worker model.
- **License:** **PolyForm Noncommercial 1.0.0** (+ small-business grant) — not open source; ideas only.
- **Adopt?** yes — idea: honest ledger. `offload stats --json` gains `metered` (bytes actually removed
  from tool results) vs `estimated` (worker answers vs. hypothetical full reads) and an `extra_turns`
  counter (each deny costs the agent a turn). Also "re-read returns diff since last outline".
- Src: github.com/alexgreensh/token-optimizer

### 11. headroom (chopratejas/headroom)
- **What:** library + local proxy (`headroom proxy --port 8787`) + MCP. ContentRouter picks a
  compressor: SmartCrusher for JSON (keeps error items, statistical outliers by field variance,
  first/last boundaries), AST-aware CodeCompressor, a small HF model for prose; CacheAligner flags
  content that breaks the provider's prefix cache. Reversible "CCR": originals cached, model calls
  `headroom_retrieve`. Self-reported 21–57 % on four agent scenarios; 0.21 ms p50 on 10 k-token JSON.
- **Differs:** sits on the API wire (needs base-URL change — not possible on a subscription OAuth
  route); we work through hooks, so `@host` plans keep working.
- **License:** Apache-2.0.
- **Adopt?** yes — idea: JSON-aware digest. When Bash output parses as a JSON array of objects
  (`gh … --json`, `kubectl -o json`, `npm ls --json`), keep schema + counts + items whose fields are
  outliers/contain `error|fail|status≠ok` + first/last N. Deterministic, both engines (jq / TS).
- Src: github.com/chopratejas/headroom

### 12. claude-mem (thedotmack/claude-mem)
- **What:** memory plugin; 6 lifecycle hooks; observations compressed by a model (provider choosable:
  own plan, OpenRouter, Gemini); SQLite + FTS5 + Chroma. **Progressive disclosure**: `search` returns a
  compact index (~50–100 tokens/hit) → `timeline` → `get_observations` (500–1,000 tokens) for chosen IDs.
- **Differs:** cross-session memory, not per-call offloading.
- **License:** Apache-2.0 (with an "open/commercial boundary" doc).
- **Adopt?** maybe — idea: progressive disclosure for `offload explore`: return a ranked index of
  `path:Lx-Ly — one-line why` first; `offload explore --expand 2,5` fetches bodies. Bounded first answer.
- Src: github.com/thedotmack/claude-mem

### 13. LLMLingua / LongLLMLingua / LLMLingua-2 (microsoft/LLMLingua)
- **What:** prompt compression by a small LM: drop low-perplexity tokens (LLMLingua), question-aware
  reordering + per-document ratios (LongLLMLingua), BERT-size token classifier distilled from GPT-4
  (LLMLingua-2, 3–6× faster). Up to 20× claimed; the README's own example output is visibly garbled.
- **Differs/limits:** lossy at token level — breaks identifiers, paths, line numbers, i.e. exactly what
  citations need. Needs Python + GPU-ish model.
- **License:** MIT.
- **Adopt?** no — token-dropping conflicts with verbatim error lines and `path:Lx-Ly`. Keep the
  principle "compress prose, never identifiers" as a rule in docs/DESIGN.md.

### 14. chop (agusrdz/chop) and ASK token optimizer — **(unverified)**
- Seen only in search results: chop = CLI output compressor for "52+ commands"; ASK = two hooks
  (rewrite Bash before, filter after), revenue-gated license. Same family as RTK/squeez. **Adopt?** no
  (nothing new beyond #7/#9).

---

## C. Code structure, outlines, indexing

### 15. aider repo map
- **What:** whole-repo map of key definitions with signatures; files are graph nodes, dependency edges,
  graph ranking favours identifiers referenced often; `--map-tokens` budget (default 1 k), grows when no
  files are in chat. (tree-sitter + PageRank are the known implementation; the docs page itself does
  not name them.)
- **Differs:** always-on context injection; we answer on demand.
- **License:** Apache-2.0 (aider).
- **Adopt?** yes — idea: `offload map [--tokens 1000]`: our existing outline per file + reference
  counts from one `rg -o -w` pass over defined names, rank files by incoming references, cut to budget.
  Offer it as the deny message's "where to look next" and as an MCP tool.

### 16. Serena (oraios/serena)
- **What:** MCP server with LSP-backed symbolic tools: find symbol, symbols overview, find referencing
  symbols, symbol-level edits/rename; 40+ languages; memories.
- **Differs:** precise but heavy (language servers per project); no worker model.
- **License:** app GPL-3.0-or-later, SolidLSP MIT.
- **Adopt?** maybe — idea: outline entries become *addressable*: `offload read path#Class.method`
  resolves via our outline to a line range and returns exactly those lines (no model), so the agent
  can do a targeted read without guessing offsets.

### 17. Repomix (yamadashy/repomix)
- **What:** packs a repo into one file (xml/md/json/plain); `--compress` (tree-sitter: signatures, no
  bodies); token counts per file, `--token-count-tree`, **`--token-budget <n>` exits non-zero when over
  budget**; Secretlint scan drops files with credentials; MCP tools `pack_codebase`,
  `grep_repomix_output`, `read_repomix_output` (by id + line range); `--sandbox` path confinement;
  untrusted remote configs not loaded unless `--remote-trust-config`.
- **Differs:** feeds *more* into context (packing) — opposite goal, but shares the "pack once, read by
  id + range" pattern.
- **License:** MIT.
- **Adopt?** yes — idea: budget guard for workers: `offload explore --budget <tokens>` refuses/chunks
  inputs above the worker model's window instead of failing mid-call; per-file token tree in
  `offload doctor --repo` to explain why a file was blocked.

### 18. ast-grep
- **What:** tree-sitter structural search/lint/rewrite with code-shaped patterns (`$VAR` wildcards); Rust.
- **License:** MIT.
- **Adopt?** maybe — idea: if `ast-grep`/`sg` is on PATH, `offload outline` uses it for languages our
  regex outliner handles poorly; fall back to the regex outline otherwise (no hard dependency).

### 19. probe (probelabs/probe)
- **What:** ripgrep speed + tree-sitter: returns whole functions/classes, BM25/TF-IDF ranking,
  `--max-tokens` budget, **session dedup** (doesn't resend blocks already shown), MCP, no index needed.
- **License:** Apache-2.0.
- **Adopt?** yes — idea: grep guard. When a `Grep`/`rg` result is huge, digest it as "matches grouped by
  file + enclosing definition name from our outline", capped by a token budget, with a session-level
  "already shown" set so repeated greps don't resend identical hunks.

### 20. claude-context (zilliztech/claude-context)
- **What:** MCP semantic code search: AST chunking (fallback char splitter), Merkle-tree incremental
  reindex, hybrid BM25 + dense vectors; needs Milvus/Zilliz + an embedding provider; ~40 % token
  reduction (self-reported eval).
- **Differs:** infrastructure-heavy (vector DB, embedding keys), sends code to an embedding API.
- **License:** MIT.
- **Adopt?** no for embeddings (conflicts with zero-infra, same-subscription goal); maybe for the
  Merkle idea: cache outlines keyed by file content hash in `CLAUDE_PLUGIN_DATA` so repeat outlines cost
  zero parsing.

---

## D. Cheap-model delegation and routing

### 21. claude-code-router (musistudio/claude-code-router)
- **What:** local proxy for Claude Code's API traffic; routes per request class: `default`,
  `background` (lightweight model), `think` (plan mode), `longContext` above `longContextThreshold`
  (tiktoken cl100k estimate), `webSearch`; custom router JS; subagent override tag
  `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` in the subagent prompt; transformers per
  provider; retries and ordered fallbacks. 3.x reportedly moved config to a SQLite store behind a UI
  **(unverified)**; route keys from docs search summary **(partly unverified — docs page 404'd)**.
- **Differs:** replaces the *main* model's endpoint (API keys, not the user's subscription); we keep the
  main model untouched and only move bulk to a worker.
- **License:** MIT.
- **Adopt?** maybe — idea: a `longContext`-style rule in our chain: if a delegated input exceeds the
  chosen worker's context window, skip to the next chain entry that fits (or chunk), recorded in stats.

### 22. LiteLLM router
- **What:** strategies `simple-shuffle` (default), `least-busy`, `usage-based`, `latency-based`
  (`ttl`, `lowest_latency_buffer`), `cost-based`; `allowed_fails` per minute → cooldown
  (`cooldown_time`, default 5 s); `num_retries` with backoff on rate limits; `RetryPolicy` per error
  type; context-window fallbacks / pre-call checks.
- **Differs:** we already have chains + cooldowns, but no per-error policy and no latency memory.
- **License:** MIT (core; enterprise dir separate) **(license split unverified)**.
- **Adopt?** yes — idea: per-error cooldown policy (quota/429 → long cooldown, timeout → short, auth →
  until `offload doctor` passes) and latency-aware ordering among equal-cost entries from `stats`.

### 23. OpenRouter Auto Router
- **What:** classifier assigns ~30 task types; models ranked by market spend share per task type over
  7 days; `cost_tier` low…max picks a band; fallbacks built from the ranking; `provider.max_price`.
- **Differs:** opaque per-request choice; bad fit for reproducible citations.
- **Adopt?** no as default; document `openrouter/auto` as a usable model id for the HTTP preset only.

### 24. PAL MCP (formerly Zen MCP, BeehiveInnovations/pal-mcp-server)
- **What:** MCP server bridging Claude Code to other models and **CLIs** (`clink`: launches Gemini/Codex/
  Claude CLI subagents with roles like `planner`, `codereviewer`, returns only the final result);
  conversation threading across models; `DEFAULT_MODEL=auto`; `DISABLED_TOOLS` to save context.
- **Differs:** closest cousin of our `@host`/agent-CLI connectors, but workers keep full tool access
  (web, MCP, file inspection) and it is aimed at second opinions, not bulk I/O; no hook enforcement,
  no citation check.
- **License:** Apache-2.0.
- **Adopt?** maybe — idea: worker **continuation ids**: `offload ask --continue <id>` reuses the
  worker's prior files/answer (OpenCode session or cached input) so follow-up questions don't re-send
  the file (shunt's acknowledged gap).

### 25. OpenCode agents / Kilo modes
- **What (OpenCode docs):** primary vs subagent `mode`; per-agent `model` (`provider/model`); per-agent
  `permission` for `edit`/`bash` (glob patterns) allow/ask/deny; `permission.task` controls which
  subagents can be spawned; `hidden: true`; built-in read-only `Explore`. Kilo's orchestrator mode
  delegates subtasks to modes with their own models **(Kilo details unverified this session)**.
- **Differs:** in-harness delegation; we already ship an OpenCode worker with deny-all permissions.
- **Adopt?** yes — idea: `offload install opencode` also writes a hidden `offload-reader` subagent
  (read/grep/glob only, `bash` deny, cheap model) so OpenCode/Kilo users get native delegation even
  without our CLI on PATH; conformance test on the generated config.

---

## E. Log summarisation and output filtering techniques

### 26. Drain / Drain3 log template mining (logpai/Drain3)
- **What:** online clustering of log lines into templates with a fixed-depth parse tree (depth 4),
  similarity threshold `sim_th` 0.4, regex masking of variables (`<:IP:>`, numbers) before mining,
  `<*>` for other variable tokens, `max_clusters` LRU, parameter extraction.
- **Why it works:** CI logs are mostly a few templates repeated with different ids/timestamps.
- **License:** MIT **(unverified — LICENSE.txt not read)**.
- **Adopt?** yes — idea: a *simplified, original* masker in the digest: mask hex ≥ 7, UUIDs, ISO
  timestamps, durations, numbers → key; consecutive and non-consecutive lines with the same key collapse
  to `first example + [×N]`; error-like templates always printed with one verbatim example.

### 27. Test-runner reporters and stack-trace folding (general technique)
- **What:** runners already emit machine-readable summaries: `go test -json` (NDJSON), Jest/Vitest
  `--json`/`--reporter=json`, pytest `-rf`/`--tb=short`/JUnit XML, `cargo test` "failures:" block,
  JUnit XML generally. Stack traces are mostly framework frames (`node_modules/`, `site-packages/`,
  `java.base/`, `/usr/lib/go/`).
- **Adopt?** yes — ideas: (a) runner detectors in the digest that extract `failed test ids + first
  assertion line + first project frame` from the *text* output (no command rewriting); (b) fold vendor
  frames: keep the top frame and every frame under the repo root, replace runs with
  `… 37 frames in node_modules`.

---

## F. Installers for agent tools

### 28. `skills` CLI (vercel-labs/skills)
- **What:** `npx skills add owner/repo [--skill x] [-a agent] [-g] [-y]`, `--list`, `find`, `check`,
  `update`; `skills-lock.json` for project restore; detects installed agents (~79 listed).
- **License:** MIT.
- **Adopt?** maybe — idea: publish our skill (`skills/offload`) so `npx skills add levgiorg/harness-offload`
  installs the guide on agents we don't integrate natively; acceptance: listed by `npx skills add --list`.

### 29. add-mcp (neondatabase/add-mcp)
- **What:** `npx add-mcp <url|cmd> [--all] [-g] [-y]`; detects project/global agents; writes each
  agent's native format: JSON (Cursor, VS Code, Claude Code `.mcp.json`/`~/.claude.json`, Gemini,
  Windsurf…), JSONC (OpenCode, Kilo), **TOML** (Codex), **YAML preserving comments** (Goose, Hermes);
  drops unsupported fields with a warning; `upsertServer`/`sync` API.
- **License:** Apache-2.0.
- **Adopt?** yes — idea: `offload install --all --dry-run` prints the exact per-file diff for every
  detected host, and installs are format-preserving upserts (comments in JSONC/YAML/TOML kept).

### 30. Smithery CLI
- **What:** `smithery mcp add|search|list|remove`, `tool call`, auth/namespaces, `mcp publish`
  (URL or `.mcpb`). **License:** AGPL-3.0.
- **Adopt?** maybe — idea: ship an `.mcpb` bundle of `offload mcp` (Claude Code plugins accept `.mcpb`
  in `mcpServers`; Claude Desktop installs them) so non-CLI users get one-click MCP.

### 31. rustup-style `curl | sh` installers (general technique)
- **What:** script detects OS/arch, downloads a release binary, verifies a checksum (ideally a signed
  manifest), installs to `~/.local/bin`/`~/.cargo/bin`, edits PATH only with consent, supports
  `--yes`, `--no-modify-path`, self-update and uninstall.
- **Adopt?** yes — idea: `install.sh` verifies the SHA-256 from the release's `SHA256SUMS` (and a
  Sigstore/minisign signature if present), never edits shell rc files without `--modify-path`, and
  `offload self-update` reuses it. **(Current `install.sh` checksum behaviour not checked here.)**

---

## G. Benchmarks for context / token efficiency

### 32. SWE-bench (+ SWE-Effi)
- **What:** SWE-bench Verified = real GitHub issues with hidden tests. SWE-Effi (arXiv 2509.09853)
  re-scores agents by area-under-curve under budgets: EuTB (2 M tokens), EuCB ($1), EuCTB (30 min CPU),
  on a 50-issue subset; finds "token snowball" (input grows each call), "expensive failures", and that
  **number of LLM calls matters more than tokens per call**.
- **Why it matters to us:** a deny costs an extra turn → SWE-Effi's finding says turns are the expensive
  part; our bench must count calls, not just bytes.
- **Adopt?** yes — idea: `bench/claude-e2e.sh` reports per task: resolved?, main-model input tokens
  (incl. cache reads), number of main-model calls, worker calls, wall time — with vs without.

### 33. Terminal-Bench / Harbor
- **What:** ~100 terminal tasks (instruction + test script + oracle solution), `tb run --agent …
  --model …` in Docker; Terminal-Bench 2.0 runs on the newer Harbor framework. No built-in token metric
  on the README. **License:** Apache-2.0.
- **Adopt?** maybe — idea: a 10-task, log-heavy subset run with Claude Code ± plugin through Harbor,
  pass rate must not drop and main-model tokens must fall; manual workflow, not CI (real model cost).

### 34. Self-built offline evals (shunt `evals/`, squeez fixtures, token-optimizer 87 fixtures)
- **Pattern:** offline routing evals (hook in → decision out) + a separate opt-in live benchmark, and
  a "signal preserved" quality check per fixture (squeez: signal terms kept 46/46).
- **Adopt?** yes — idea: every digest fixture declares `must_keep` strings (error ids, test names,
  file:line) and the conformance suite fails if any is missing, in both engines.

---

## Top 15 ideas for Harness Offload (ranked by value ÷ effort)

1. **Near-duplicate line templating in Bash digests** (from #9, #26). Mask ids/hex/UUID/timestamps/
   numbers, collapse equal templates to one example + `[×N]`.
   *Accept:* new fixture (≥ 2,000 lines, ≥ 90 % repeated templates) digests to ≤ 60 lines, every
   distinct error template present verbatim once; identical output from bash and TS engines; hook
   latency budget in `bench/hooks.mjs` unchanged (±5 ms).
2. **`must_keep` signal checks for every digest/outline fixture** (#34).
   *Accept:* each fixture under `evals/fixtures` has a `must_keep` list; conformance fails on any miss;
   ≥ 20 fixtures covered; runs on both engines in CI.
3. **Context-aware thresholds via a status-line shim** (#3, #2; closes GOALS M7).
   *Accept:* with a recorded `used_percentage` ≥ 70 the read guard threshold drops by the configured
   factor (default ½); ≤ 30 % keeps defaults; missing/old file (> 10 min) falls back silently; hook
   overhead +≤ 2 ms measured by `bench/hooks.mjs`; install/uninstall restores the user's status line
   byte-for-byte.
4. **Stack-trace folding + test-runner failure extraction** (#27).
   *Accept:* fixtures for pytest, Jest/Vitest, go test, cargo test, JUnit/Java: 100 % of failing test
   ids and 100 % of repo-root frames kept; vendor frames folded into one line per run; digest ≤ 25 % of
   input bytes on each fixture.
5. **Cross-call dedup** (#9, #19). Same command + same output hash within the session → "identical to
   digest #N (log: path)"; near-identical (line-set Jaccard ≥ 0.85) → only the changed lines.
   *Accept:* re-running an unchanged failing test emits ≤ 3 lines; a run with one new failure shows
   that failure verbatim; state file bounded (≤ 32 entries) in the plugin data dir.
6. **Honest savings ledger** (#10, #32). `offload stats --json` splits `metered` vs `estimated` bytes and
   counts `denies` (= extra agent turns) and worker calls.
   *Accept:* JSON schema documented; both engines emit identical keys (parity test); dashboard shows
   net figure; `bench/claude-e2e.sh` prints main-model call count with vs without.
7. **Intent-scored log retrieval** (#8). `offload run --intent "<q>"` / MCP arg returns top-k line
   windows by query-term score + a term vocabulary; `offload log <id> --grep/--lines` for follow-ups.
   *Accept:* on the 2,323-line CI-log fixture, both failures appear in the top-3 windows for an intent
   naming either; total ≤ 1,500 bytes; no model call needed (works with `OFFLOAD_BACKEND=none`).
8. **PreCompact / SessionStart(compact) artifact index** (#8, #9).
   *Accept:* after a compaction the agent gets ≤ 600 bytes listing recent digest ids, outlines and
   worker answers with their retrieval commands; nothing emitted on `startup`; conformance cases for
   both sources.
9. **JSON-aware digest** (#11). Arrays of objects → schema, count, outlier/error items, first/last 3.
   *Accept:* fixtures from `gh --json`, `kubectl -o json`, `npm ls --json`: every item with an error/
   failed status kept; output ≤ 15 % of input; invalid JSON falls through to the text digest.
10. **Hook `if` filters + exec-form hooks** (#2, #4). Let Claude Code skip launching our process for
    Bash commands that can't be bulk reads or long runs.
    *Accept:* `node bench/hooks.mjs` shows ≥ 50 % fewer hook process spawns on the standard Bash
    corpus; routing table (49 cases) unchanged; `claude plugin validate --strict` passes.
11. **Symbol-addressable reads + ranked repo map** (#15, #16). `offload read path#Name` returns exact
    lines from the outline; `offload map --tokens N` ranks files by incoming references.
    *Accept:* `path#Name` resolves for ≥ 95 % of top-level definitions in fixtures for TS, Python, Go,
    Rust, Java, Ruby; map output ≤ N tokens (bytes/4) and contains the 5 most-referenced files of the
    fixture repo.
12. **Worker context-window guard + chunking** (#17, #21). Inputs above a chain entry's window skip to
    the next entry that fits, else map-reduce in chunks with citations preserved.
    *Accept:* mock worker with a 32 k window and a 400 KB input: no failed call, answer citations all
    verify, stats record the skip/chunk.
13. **Per-error cooldown policy** (#22). Quota/429 → long cooldown, timeout → short, auth → until doctor
    passes; latency-aware ordering among equal entries.
    *Accept:* mock backends returning 429/timeout/401 produce the three distinct cooldowns in both
    engines; `offload doctor` shows the reason and remaining time.
14. **SubagentStart guide + native reader agents** (#5, #25). Inject a ≤ 400-byte offload guide into
    Explore/general subagents; generate an `offload-reader` agent for OpenCode/Kilo installs.
    *Accept:* hook test shows the guide only for matching agent types and only once per subagent;
    generated OpenCode config passes OpenCode's schema with `edit`/`bash` denied.
15. **Installer: dry-run diffs, format-preserving upserts, verified binaries** (#29, #31).
    *Accept:* `offload install --all --dry-run` prints per-file diffs and writes nothing; second real
    run is a no-op (zero diff) on every fixture home; JSONC/TOML comments survive; `install.sh` aborts
    on a checksum mismatch (test with a tampered tarball).

Not recommended: LLMLingua-style token dropping (breaks identifiers/citations), embedding indexes
(infrastructure + code leaves the machine), API-wire proxies (incompatible with subscription `@host`
routes), opaque auto-routers as defaults, rewriting the agent's commands by default.
