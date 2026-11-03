# Master backlog

Living list. Each item: **ID · title** — why (evidence) · acceptance criterion (AC) · deps. Priority
P0 (do next) … P3 (maybe). Status: `todo`, `doing`, `done (commit)`, `rejected (reason)`.
Score = user value × confidence ÷ (effort + maintenance). Re-rank every loop; never delete — mark.

Baseline (2026-11-02, commit 32a3b97): conformance bash 409 / TS 406, bun 70, routing 49×2, backends 464,
pass-through hooks ~15–20 ms bash / ~40 ms Node, real Haiku benchmark 95/56–61/97–98/93 % savings, all facts.

## A. Context optimisation
- **A1 · P0 · Huge search output** — `grep/rg/find/ls -R` are in `bash_never_summarize`, so a 5,000-line
  search lands in context whole. AC: a successful search over `hooks.search_threshold_lines` (default 250)
  is replaced (both engines) by a deterministic grouped view: total matches, matches per file (top N),
  first K matches per file with line numbers, full-log path and a narrowing hint; small searches untouched;
  routing + conformance tests; hook latency budget held. `done (A1 commit)` — 164 KB grep → 3.5 KB, 529 KB find → 3.4 KB, identical text in both engines.
- **A2 · P1 · (merged into R1, done)** Repeated-line folding in digests — key lines fold exact repeats, but near-identical lines
  (timestamps, ids, `case 1891 passes (37ms)`) still eat the excerpt. AC: lines that differ only in digits/hex
  fold into one "×N (pattern)" row in key lines and the model excerpt; fixture with 2,000 near-duplicate lines
  shrinks ≥5× with every distinct error kept, both engines. `done (95010df, merged into R1)`
- **A3 · P1 · Stack-trace folding** — Java/Python/Node traces repeat frames. AC: frames from node_modules/
  site-packages/jdk collapse to "… N library frames"; first project frame kept verbatim; fixtures for 3 languages. `done (A3 commit)` — fixture (Node+Java, 8 failures, 86 library frames):
  2,549 → 1,673 B, every failure and project frame kept, frames counted; real CI-log digest unchanged; gawk/mawk/BSD awk/TS identical.
- **A4 · P1 · Context-aware read threshold** — open item since M7. Use `transcript_path` size to estimate how
  full the agent's context is; raise the guard bar early in a session, lower it late. AC: documented formula,
  tests with fake transcripts of 3 sizes, off by default or proven by benchmark. deps: research. `done (1e31216) — opt-in hooks.context_tight_tokens; exact context size from the usage Claude Code records per turn in the transcript; at or above it the limit halves; transcript read only for files between half and the full limit. Raising the bar early rejected: an early big read is re-read on every later turn (costs more). Tests: off, full, room, no transcript, small file, TS hooks`
- **A5 · P2 · Outline quality** — outline of a 919-line TS file is the agent's map. AC: outline lists exported
  symbols with line ranges for TS/JS/Py/Go/Rust/Java/Ruby/C#; fixture per language; size ≤ 2 KB per 1,000 lines. `done (A5 commit) — outlines carry line ranges ('L10-17: func (i *Item) Reserve…'): a symbol runs until the next symbol at the same or an outer level (or EOF), a ready Read(offset/limit); fixture + expected outline per language (TS, JS, Python, Go, Rust, Java, Ruby, C#) checked in both engines and gawk/mawk/BSD awk; size: entries scale with the file (3 per 100 lines, 16…40) and are cut at 90 chars — ≤ 1.1 KB per 1,000 lines on large files, 2.2–2.4 KB per 1,000 at the 600-line threshold for signature-dense TypeScript (the one place the 2 KB target is missed; fewer than 16 symbols would make the outline useless); bug found on the way: awk compared line numbers as strings`
- **A6 · P2 · Read de-duplication** — the same big file read twice in one session gets two worker calls.
  AC: answer cache keyed by (file hash, question, model) with TTL; second identical `offload read` returns from
  cache in < 100 ms and says so; cache bypass flag. `done (A6 commit) — read answer cache keyed by POSIX cksum of the prompt (which holds the file contents) + model + task instructions + verify, so an edit can't serve a stale answer; hit < 100 ms ('cached from HH:MM:SS'); read.cache_seconds (3600; 0 off), --no-cache, OFFLOAD_NO_CACHE; same cache format in both engines; tests and the benchmark bypass it; 6 checks`
- **A7 · P2 · Diff-aware reads** — `git diff` of a huge change is passed through (viewer command). AC: diffs over
  threshold get a per-file stat + hunks headers view with log path, like A1. deps A1. `done (A7 commit) — diff view for huge git diff/show (files +/−, busiest first, first hunks, log, how to see one file); a real 222 KB diff → 2.2 KB; identical in bash/TS/mawk/BSD awk; non-diff git show and piped diffs pass through; hooks.diff_view`
- **A8 · P2 · Token estimate accuracy** — bytes/4 everywhere. AC: measure against a real tokenizer count on 10
  fixture types; per-kind factor (code, logs, JSON, CJK) cuts the error to < 15 %; dashboard labels "estimated". `done, criterion partly met (A8 commit) — measured against two real tokenizers (o200k/cl100k; Claude's is not available offline) on 25 files: bytes÷4 was off by >15% on 17 (worst 59%, always under); the shipped estimate 0.277×bytes + 1.127×digit-runs (chosen by worst leave-one-out error among small models) is off by >15% on 6 (CJK, inline-SVG HTML, pretty JSON: up to 37%) and 1–15% on the rest — the '< 15 % everywhere' target is missed for those kinds and recorded rather than over-fitted (a 7-feature fit looked like 13% but was 83% leave-one-out); used by the read guard (counted only when size can't settle it, +4 ms), messages, footers and all saved_tokens; awk/TS parity on 60 random texts; dashboard and docs say 'estimated'; a numeric CSV that ÷4 called 3,229 tokens is now held back`
- **A9 · P3 · Incremental explore** — repeat explores re-read the repo. AC: experiment only; record result. `rejected — explore is a model-driven tool loop over the live tree; reusing partial results across calls risks stale answers after edits, and per-question caching is A6/L4's job`
- **A10 · P2 · Binary/minified file guard** — a Read of a minified bundle or lockfile. AC: lockfiles/minified
  (>4,000-char lines) get a specific message (what it is, size, how to query) instead of an outline. `done (A10 commit) — lockfiles name their package-manager query (npm ls/yarn why/cargo tree -i… 11 kinds); files whose lines average > 4,000 chars are called minified/generated and get grep -noE with 80 chars of context instead of slices/outline; a slice of such a file is now counted by size (a 1-line slice of a 1.4 MB bundle was let through as '1 line'); both engines, 5 conformance checks`
- **A11 · P2 · JSON/YAML big-file reads** — outline of a 5 MB JSON is useless. AC: outline shows top-level keys,
  array lengths, a jq hint; fixture. `done (A10 commit) — JSON (≤ 16 MB) reads get the top-level structure: keys in JavaScript order, object key counts, array lengths + item type ('array, 4,000 objects'), and jq commands for the biggest member; jq+awk and TS agree on 60 random files (property test) incl. integer-like, escaped and unicode keys; real 622 KB package-lock → 4 structure lines + 'npm ls NAME'; 0.14 s per block; YAML keeps the line outline (no YAML parser in the bash baseline: recorded in DECISIONS)`

## B. Worker intelligence
- **B1 · P1 · Citation-format tolerance** — real Haiku wrote `orders.py:4` (no `L`) once; those claims go
  unchecked. AC: accept `path:N` only when `path` is a sent/known file (so `host:8080` never counts), both engines. `done (B1 commit)` — real bash task answer 0/0 → 3/0; other real answers unchanged.
- **B2 · P1 · Quality retry** — when > 50 % of citations are unverified, re-ask once with the failures listed.
  AC: stub test; real-model experiment logged; cost bounded (one retry, config `read.retry_on_unverified`). `done (B2 commit)` — both engines, `read.retry_unverified`
  (default on; ≥2 unverified and more than verified); the better answer is kept, footer says so; 5 stub checks. No real
  run triggered it: none of the 8 recorded real answers meets the condition (best case ≤ 1 unverified) — recorded in E4.
- **B3 · P2 · Per-task timeouts** — one `opencode.timeout_seconds`. AC: `timeouts.<task>`; ask defaults lower. `done (B3 commit) — timeouts.<task> (read/explore/summarize/write/ask; 0 = opencode.timeout_seconds), ask defaults to 90 s; a repo may set it (harmless, so on the untrusted-project allow-list in both engines); OFFLOAD_TIMEOUT still wins for one run; timeout hint names it; 6 checks (opencode v1 and v2): timeouts.ask=1 vs general 60 → exit 12 in 2 s; read 0 → general`
- **B4 · P2 · Model capability table** — explore needs tool use; some CLIs/models have none. AC: registry marks
  capabilities; `offload model explore X` warns when X cannot use tools. `done (B4 commit) — the backend registry marks which CLI can't explore (noExplore: crush, whose `crush run` approves every tool call); offload model explore X, and a default X while explore is unset, warn and say what to set (both engines, @host resolved for the calling harness); 4 checks. HTTP models: tool support can't be known without a call (no standard capability API) — such a model's explore fails and the chain falls back; recorded in DECISIONS 89`
- **B5 · P2 · Fallback reason in footer** — when the chain falls back, the agent isn't told why. AC: footer says
  "fell back from A (quota)"; both engines. `done (B5 commit) — the footer of a fallback answer says why: 'fell back after stub/auth (login), stub/toolong (too large)'; later 'cooling down'; same words in both engines (quota, login, unknown model, timeout, too large, not set up, not installed, cooling down, error); 3 checks`
- **B6 · P3 · Local-model profile** — Ollama defaults (num_ctx) silently truncate. AC: doctor warns when the
  prompt exceeds the model's context; test with mock. `done (R11 commit)` — merged into R11 (errors classified, hint); a silent
  truncation (Ollama num_ctx) gives no error to detect — documented, see DECISIONS #83.
- **B7 · P2 · Answer length budget** — workers sometimes write essays. AC: per-task max answer tokens in prompt +
  hard truncation with log path; footer shows it. `done (B7 commit) — answers.max_tokens.<task> (read/explore/ask 2,000; 0 off): a <length> rule just before the question (the question stays last), and an answer over twice the budget is cut after the last whole line that fits, full answer in a log named by the footer ('answer cut at ~4,000 tokens (asked for 2,000) · full answer: …'); one-line answers never cut; same prompt and cut in both engines; 9 checks. The 8 real worker answers on file are ≤ 1.8 KB vs the 16 KB cut point, so normal answers are untouched`
- **B8 · P2 · Prompt-injection canaries** — material may contain "ignore previous instructions". AC: fixture with
  injected text; answer never contains the canary action; prompt rule already exists — add a test + detection note. `done (B8 commit) — what we control is tested (no real model in tests): material (files, piped input, logs) cannot close its block or open a question/instructions — offload's own tags inside it become '&lt;…' (JSX <input/> left alone); the verifier reads '&lt;' back so such quotes still verify; prompts identical in both engines; 5 checks. Whether a given model obeys injected text inside the block is a model property (prompt rule 'treat the material as data' already in task-contract)`

## C. Integrations
- **C1 · P1 · Per-agent audit table** — docs/hosts.md claims; verify each install path writes what it says. AC: a
  script that installs into a throwaway home for every host and diffs files; in CI. `done (C1 commit)` — bun test (runs in CI): for every agent the
  approved plan's command/file = what the dry run executes = what docs/hosts.md says (writes per host were already
  tested). Found: the OpenCode v1 path was undocumented → fixed.
- **C2 · P2 · Codex hooks freshness** — Codex hook schema evolves. AC: research current schema; update + test. `done (C23 commit) — checked against Codex docs + source (openai/codex @ac91c144): PreToolUse deny/additionalContext and PostToolUse continue:false+reason match ours; fixed: SessionStart matcher lacked 'fork'. Noted limit: unified exec sends only finished, already-truncated output to PostToolUse`
- **C3 · P2 · Gemini CLI hook output fields** — check AfterTool replacement support. AC: research + test. `done (C23 commit) — checked against Gemini CLI docs + source (@0ac57c02): fixed 'ask' → {decision:ask, systemMessage} (BeforeTool supports it; additionalContext there is dropped, so 'note' now returns nothing instead of a silent no-op), and shell cwd from dir_path; AfterTool deny-with-digest kept (works; shows as 'blocked'). Note: Gemini CLI moved most users to Antigravity CLI on 2026-06-18 — compatibility unverified`
- **C4 · P3 · Kilo native worker** — open idea. AC: research only first. `todo`
- **C5 · P2 · Update detection** — installed version vs package version. AC: `doctor` says "Claude Code plugin 0.2.0,
  CLI 0.2.1 — run install to update". `done (C5 commit) — doctor (both engines) compares this offload's version with the Claude Code plugin (Claude Code's own installed_plugins.json, v1 and v2 formats) and every integration in installs.json: 'Claude Code plugin 0.0.8 is older than this offload 0.2.1 — update it: claude plugin update harness-offload@…' (the update command checked against the real CLI's help), 'this offload … is older than the plugin … — npm i -g harness-offload@latest', 'codex integration was set up by offload 0.0.9 — offload sync refreshes it'; 5 checks in all three suite modes`
- **C6 · P3 · Amp live verification** — hidden. AC: keep hidden until a real run. `blocked — no Amp binary or account here; Amp stays hidden from public surfaces until a real run (DECISIONS: hidden since #9). Remaining work: one real install + hook run, then unhide`

## D. Installation and onboarding
- **D1 · P1 · Install failure recovery** — one agent failing mid-install. AC: receipt shows per-agent result and
  the exact retry command; failure injection test. `done (D1 commit)` — an agent's installer throwing no longer aborts
  the rest; the receipt ends with `Retry: … install --yes --agents <failed> [--scope project]` and says the others are
  installed; failure-injection test (codex stub exits 1).
- **D2 · P2 · `--json` receipt** — scripts/CI need machine output. AC: `install --yes --json`. `done (D2 commit) — install --yes --json prints a JSON receipt (version, scope, ok, per agent: status installed/updated/reinstalled/failed, from, reads_with, todo, errors, ping); --dry-run --json the plan (status planned, what, where); --json without --yes/--dry-run is a usage error (exit 2); failed agent → ok false, exit 1; 2 bun tests`
- **D3 · P2 · Update migration** — config keys renamed across versions. AC: a migration step with a test from a
  0.1 config fixture. `rejected — nothing to migrate: the rename happened before any release (npm view → 404), no key was ever renamed, and config validate (E2) now flags any stale key a future rename leaves`
- **D4 · P2 · First-run doctor hint** — after install, verify the reader actually answers. AC: receipt offers
  `doctor --ping` result inline when `--ping` given. `done (D4 commit) — install --ping makes one live call per installed agent's reader (its first read model, @host resolved for that agent) and adds 'reader answered "pong" in Ns (claude:haiku)' or 'reader did not answer: …' to the receipt (JSON: ping {ok, model, answer|error, seconds}); a silent reader makes the install exit 1 with a closing line pointing at doctor --ping; bun test with a stub that answers and one that doesn't`
- **D5 · P3 · Windows installer path audit** — AC: unit tests for every path on win32. `todo`

## E. CLI and developer experience
- **E1 · P1 · `offload explain`** — "why was my Read blocked / output replaced?" AC: `offload explain` prints the
  last N hook decisions with rule, threshold and how to change it (from stats.jsonl); both engines. `done (E1 commit)` — identical text in both engines;
  hook rows now record the file, digest rows the log; tests read bash-hook rows with the TS command too.
- **E2 · P2 · `offload config validate`** — typos in config keys are silently ignored. AC: unknown keys warned with
  did-you-mean; doctor runs it. `done (E2 commit) — offload config validate (exit 1 on unknown keys, closest real key by edit distance; own maps like tasks/endpoints open), config set warns, doctor lists them; identical text in both engines; 6 conformance checks`
- **E3 · P2 · Task templates** — `offload task --new review-sql` scaffolds from a template list. `done (E3 commit) — offload tasks templates / tasks add NAME --from TEMPLATE [--project], 5 original templates in shared config/task-templates.json; identical text and identical config written by both engines; refuses to overwrite; added task runs end to end (stub)`
- **E4 · P3 · `NO_COLOR`/`--plain` audit** — AC: every command honours NO_COLOR; test. `done (E4 commit) — audited in a real pseudo-terminal: 9 commands × 2 engines print no escape codes under NO_COLOR (TS doctor prints 134 with colour on); regression test: FORCE_COLOR on, NO_COLOR wins, 6 commands`
- **E5 · P2 · Bash `doctor --json`** — TS only today. AC: parity. `done (E56 commit) — bash doctor --json forwards to the bundled TS doctor (same JSON); test`
- **E6 · P2 · Man-page quality help** — `offload help read` shows examples. AC: per-command help in both engines. `done (E56 commit) — offload help CMD / CMD --help for 12 commands from one shared config/help.json (usage + examples), identical in both engines; found and fixed: TS 'read --help' errored, bash lacked 'config get'; install keeps its own richer help`

## F. Performance
- **F1 · P1 · Search hook cost** — `done`: pass-through path unchanged (bench budget held); the view itself takes 116–167 ms (bash) / 64–68 ms (TS) on 164–529 KB outputs.
- **F2 · P2 · Memory on huge output** — post-bash with 50 MB stdout. AC: peak RSS measured; streaming where > 2× input. `done (F2 commit) — measured peak RSS of post-bash on a persisted output: bash 13 MB at any size (awk streams); TS 315 MB for 56 MB (5.6×) → now streams outputs over 8 MB from disk in 1 MB chunks (count, cksum, compare, copy, key lines, excerpt, tail): 56 MB → 120 MB, 224 MB → 129 MB (43 MB baseline), i.e. flat; digest byte-identical to bash; 9 MB parity test`
- **F3 · P2 · `offload serve` warm worker** — deferred (DECISIONS #14). AC: experiment: measure OpenCode cold
  start vs warm; build only if ≥ 1 s saved per call. `blocked — measuring a warm OpenCode server needs the real OpenCode binary; installing it (npm i opencode-ai) was refused by this environment's safety classifier (DECISIONS #40), and the stub has no start-up cost to measure. Remaining work: time 'opencode run' cold vs 'opencode serve' + attach on a real install; build only if ≥ 1 s saved per call`
- **F4 · P3 · Parallel read chunks** — big multi-file reads in one worker call. AC: experiment. `rejected — splitting one read into parallel worker calls loses cross-file reasoning (the question spans the files), multiplies cost, and every part's citations need their own check; read caps input (read.max_input_bytes) and ranges (path:START-END) cover big inputs, and R11 now reports 'too large' clearly`
- **F5 · P2 · Verify cost on 50k-file repos** — known-file list for explore is built per call. AC: measure on a
  50k-file fixture; < 300 ms or cache. `done (F5 commit) — measured on a 50,001-file git repo: bash explore 316 ms (verify ~110 ms over a small repo); TS 1,332 → 205 ms. Found: git ls-files output over Node's 1 MB default buffer threw, and the code fell back to an lstat walk that ignores .gitignore (also hit offload read DIR); plus a quadratic file-name index (145 → 32 ms) and two path.relative calls per file. Regression test fails on the old code`

## G. Security and reliability
- **G1 · P1 · Secrets in search output** — `rejected`: the view shows the agent its own command output (as digests do); redaction is for what goes to a worker, and the view sends nothing to one.
- **G2 · P1 · Log directory hygiene** — logs hold raw command output; permissions? AC: logs dir 0700, files 0600, test. `done (G2 commit)` —
  baseline: state dir 755, logs 644 (world-readable). Now the state dir is 0700 (new and existing, one chmod per dir via `.private`);
  files inside are then private; hooks within budget.
- **G3 · P2 · Fuzz the citation verifier** — property tests: never crashes, never verifies a quote absent from the
  window, linear time on adversarial lines. AC: bun property test with 10k random cases. `done (G34 commit) — bun property tests: 10,000 random answers never throw; 2,000 absent quotes never verified; adversarial 4,000-char lines < 500 ms; awk = TS counts on 300 random answers (both outcomes exercised)`
- **G4 · P2 · Hook input fuzz** — malformed JSON, huge fields, NUL bytes. AC: every hook fails open in < budget. `done (G34 commit) — conformance feeds 16 hostile inputs (malformed, wrong types, NUL, /dev/zero, 4 MB) to all 4 hooks × 2 engines: exit 0, nothing or valid JSON, < 3 s. FOUND: TS redaction was quadratic (200 KB 15 s; 4 MB post-bash > 30 s) — the URL-credential pattern; fixed with a lookbehind (200 KB 0 ms; 4 MB post-bash 163 ms), output identical to bash`
- **G5 · P2 · Config cache poisoning** — re-review the eval'd cache (DECISIONS #50). AC: test with hostile values. `done (G5 commit) — re-reviewed: only keys of [A-Za-z0-9_] (no __, no leading/trailing _) become variable names, every value is @sh-quoted, the key line is printf %q, a NUL in a value only truncates (key mismatch → reload); new: a symlinked cache file is ignored. 6 checks with hostile keys/values ($(…), backticks, quotes, \u0000, ';' in keys, non-ASCII) on the miss and hit paths, a symlinked cache and a cache owned by another user: nothing runs, values read back byte-exact`
- **G6 · P3 · Supply chain** — lockfile audit, `npm audit signatures` in release. AC: release job step. `done (I-batch commit) — release job runs npm audit signatures before publishing (locally: 19 packages verified)`
- **G7 · P2 · Stale lock / orphan workers** — kill the agent mid-call. AC: no worker left after 5 s; test. `done (G7 commit) — FOUND: the bash engine set no TERM/INT/HUP trap while waiting, so a killed offload left its worker (and the worker's children) running until the watchdog timeout. Now co_wait_worker kills the worker's whole tree + watchdog on TERM/INT/HUP (OpenCode and agent-CLI runners). Verified both engines × 3 signals: 0 workers, 0 child processes 4 s after; conformance test fails on the old code`

## H. Dashboard and reporting
- **H1 · P1 · Estimated vs measured** — savings are bytes/4 estimates but look like facts. AC: labels + a measured
  column when the worker reports tokens; doc of the method. `done (H1 commit) — report: kept-out card names blocked reads as extra turns; worker-token card says it is measured and how many calls reported tokens; footer says what is estimated vs measured. Verified headless (cards text, no page errors, layout screenshot)`
- **H2 · P2 · Hook decision breakdown** — blocked reads vs digests vs search views per day. AC: chart + table. `done (existing + A1/R4) — the report already lists hook decisions (blocked reads by kind, per period) on the latest-delegations panel, and digests, search views and repeats are separate rows in By kind; a per-decision daily chart was judged clutter next to the savings chart`
- **H3 · P2 · Export** — `offload stats --csv`. `done (H345 commit) — offload stats --csv in both engines, byte-identical (jq @csv quoting), every record one row, fixed columns`
- **H4 · P2 · Citation health trend** — verified/unverified ratio per model. AC: dashboard row per model. `done (H345 commit) — stats --json by_model cites_ok/bad (both engines); report: Quality column per model (verified %, counts on hover, failures if any)`
- **H5 · P3 · Latency percentiles** — p50/p95 worker latency per model. `done (H345 commit) — p50/p95 seconds per model, nearest rank, in stats --json (both engines identical) and the report; tables checked for overflow at 1440/1200/900/390 px (none)`

## I. Build, package and release
- **I1 · P1 · Reproducible dist** — local Bun builds produce different chunk names than the committed dist.
  AC: pin Bun in a `packageManager`/script check; build twice → identical bytes; CI compares. `done (I1 commit)` — one pin `packages/cli/.bun-version`
  (all workflows read it), build warns on another Bun, CI (Linux) fails when the committed dist ≠ a fresh build;
  two local builds byte-identical (41 files); fresh build of the committed tree = committed dist.
- **I2 · P2 · Package size budget** — 0.90 MB packed. AC: CI fails over a budget. `done (I-batch commit) — pack-check budget 1.5 MB packed / 5 MB unpacked (today 0.97 / 3.74; was a lax 12 MB)`
- **I3 · P2 · Dependency hygiene** — AC: list runtime deps, justify each, remove unused. `done (I-batch commit) — 3 runtime deps, each used by one lazily loaded feature (@clack/prompts installer/wizard, MCP SDK mcp, zod MCP schemas); typebox external (Pi host); documented in development.md`
- **I4 · P3 · SBOM** — AC: release attaches an SBOM. `done (I-batch commit) — release job attaches a CycloneDX SBOM (npm sbom --omit dev; generated locally OK)`

## J. Testing
- **J1 · P1 · Real-answer regression corpus** — today's real Haiku answers are the best verifier tests. AC: store
  sanitized real answers + files as fixtures; verifier must reproduce the recorded counts, both engines. `done (J1 commit)` — 8 real answers in `evals/real-answers`; 6/8 fail on the pre-fix verifier.
- **J2 · P2 · Concurrency tests** — parallel hooks writing stats.jsonl. AC: 20 parallel hooks → no broken lines. `done (F2 commit) — 20 parallel digests (both engines mixed): 20 whole stats lines, 20 separate logs; a 12-way version runs in conformance`
- **J3 · P2 · Failure injection for workers** — worker killed, partial JSON, slow stream. AC: each case tested. `done (J3 commit) — stub modes crash (SIGKILL), partial (half a JSON event), garbage (non-JSON, binary), plus existing hang/empty/retry/auth: every case exits 14 fast in both engines, the chain falls back. FOUND and fixed: bash leaked its own 'Killed ( cd $workdir …)' job notice to the agent; TS said 'exited with status null' → both now 'opencode was killed by SIGKILL'; 8 checks (hang covered by G7, timeouts by the watchdog tests)`
- **J4 · P2 · Coverage report** — TS coverage in CI artifact; find untested modules. `done (I-batch commit) — CI uploads lcov + text coverage (Linux). Finding: in-process coverage is 65% lines and low for http.ts/agents.ts/args.ts because those run as separate processes in the conformance suite (560) and backend matrix (464), which in-process coverage cannot see — documented in the CI step name`
- **J5 · P3 · Flaky-test watch** — run conformance 5× and record flakes. `done (J5 commit) — 5× bash + 5× TS conformance on a frozen worktree: bash 568/568 every run; TS via the plugin launcher failed the same 6 HTTP checks every run (deterministic, not flaky): the suite's OFFLOAD_TS_CLI=false made bin/offload-ts exec 'false' → launcher now treats false/0/off/no as 'off'. One failure seen once in the main checkout under heavy parallel load ('retry … keeps the first answer'), not reproduced in 40 isolated runs — watch item`

## K. Documentation
- **K1 · P1 · README accuracy pass** — claims vs current numbers. AC: every number links to VALIDATION.md. `done (K1 commit)` — the results table was from an older run (453/659/54,
  28/28); now the 2026-11-02 numbers with the honest 24/26, raw figures added to VALIDATION.md; the other numeric claims
  (600 lines, 18 providers = 18 presets in connectors.json) checked against the code.
- **K2 · P2 · Troubleshooting guide** — top failures (no worker, quota, blocked read loop). `done (K2 commit) — docs/commands.md Troubleshooting: 10 symptom → why → do rows, every command/setting referenced checked to exist`
- **K3 · P2 · Comparison table** — vs related tools, from RESEARCH.md, fair and sourced. deps research. `done (K2 commit) — docs/comparison.md: Harness Offload vs shunt, RTK, squeez, context-mode, claude-code-router (approach, reads, output, searches, checked answers, who pays, agents, licence), from RESEARCH.md, dated, with when-to-pick-something-else`
- **K4 · P3 · Site copy** — align with README. `done (K2 commit) — site numbers (table + hero animation) updated to the latest recorded run, same as README; rendered headless, no errors`

## L. Novel features
- **L1 · P2 · Search-to-question** — when a search is huge, offer `offload read -q` on the matched files. deps A1. `done (L1 commit) — the search view's hint names the 3 busiest files (or folders), shell-quoted, as a ready offload read; identical in bash/TS/mawk/BSD awk incl. a quote in a name`
- **L2 · P2 · Session budget line** — statusline shows tokens kept out this session. `done (L2 commit) — offload statusline reads Claude Code's status-line input (transcript_path) and adds '· ~1.2k this session' (tokens kept out since the transcript's first timestamp; concurrent sessions count too — documented); stdin read with a 1 s cap so an open pipe can't hang a status bar (measured 1.05 s / 1.10 s); same text in both engines; 3 checks`
- **L3 · P3 · Team policy file** — repo-level thresholds that are safe for untrusted repos. `done (existing) — a repo's .harness-offload.json already is the team policy file (models, tasks, thresholds, hook behaviour), safe for untrusted repos (binaries/endpoints/privacy need config trust)`
- **L4 · P3 · Explain-my-repo cache** — one explore summary per repo reused across sessions, invalidated by git HEAD. `rejected — an explore answer depends on the live working tree, not on content in the prompt, so a cache key would need the whole tree's state (HEAD + every uncommitted change) to be safe; repeated identical explore questions are rare, and read's cache (A6) covers the common repeat`
- **L5 · P2 · Test-failure focus** — `offload run` on a failing test run extracts per-failure blocks. AC: fixtures
  for jest/vitest/pytest/go test/cargo; each failure's block shown verbatim. `done (L5 commit) — digests get a 'failures, verbatim' section: each failing test's own block for jest (●), vitest (FAIL file > name), pytest (____ name ____), go test (--- FAIL:, a parent with only a failing subtest folded in), cargo (---- name stdout ----); first line numbered, ≤ 12 lines per block and 5 blocks (compact 6/3) with sed -n for the rest; new fixture jest-many (7 failures in 934 lines): keep lines 2/12 → 12/12, 1.8 → 3.4 KB; keep lines added to the 5 runner fixtures; 0 false positives on the other 16; awk/TS parity on 80 random logs + gawk/mawk/BSD awk; 28 ms on 56k lines`
- **L6 · P3 · PR review task template** — built-in `review-diff` task. `done (E3 commit, merged into E3) — built-in review-diff template: git diff | offload task review-diff --stdin`

## From RESEARCH.md (2026-11-02, 34 sources) — new candidates
- **R1 · P0 · Near-duplicate line collapse** (= A2, raised): mask digits/hex/ids/timestamps, one example + ×N.
  AC: 2,000-line fixture → ≤ 60 lines, every error template kept, latency ±5 ms, both engines. `done (R1 commit)` —
  baseline showed both real errors *lost* among 600 warnings; now kept, 3,705 → 1,674 B, real CI log unchanged.
- **R2 · P1 · `must_keep` digest fixtures** — ≥ 20 fixtures with strings that must survive; CI fails on loss, both engines. `done (R2 commit)` — 21 fixtures in `evals/digest-fixtures`
  (jest, vitest, pytest, go, cargo, tsc, eslint, maven, gradle, docker, terraform, pip, npm, python trace, segfault, OOM,
  rustc, make, git merge, webpack, warning flood). Baseline: jest lost its failing test's name and Expected value in both
  engines → fixed (`●`, `Expected:`/`Received:` are key lines). Also checks bash = TS digest text for every fixture.
- **R3 · P1 · Context-aware threshold via status-line shim** (= A4): statusline input carries
  `context_window.used_percentage`; a shim wrapping the user's statusline writes it to a file hooks read.
  AC: ≥ 70 % used halves the read threshold; ≤ 2 ms hook cost; uninstall restores the statusline byte for byte. `done (1e31216, merged into A4) — no statusline shim: the transcript has the exact usage, and editing the user's statusline was avoidable risk`
- **R4 · P1 · Seen-output dedup** — identical rerun output → "same as digest #N"; near-identical → changed lines only.
  AC: unchanged rerun prints ≤ 3 lines. `done (R4 commit)` for identical output (1 line, 377 B, 58–86 ms, no worker call);
  near-identical → split out as **R4b · P2** (show only changed key lines vs the previous run). `done (f6b4e81 + R4b commit) — identical re-run: one line; changed re-run of the same command in the session: key lines show only what is new since the last run, with unchanged/gone counts and the gone (fixed) lines; identical text in both engines; 5 conformance checks`
- **R5 · P1 · Honest ledger** (= H1): metered vs estimated, blocked reads counted as extra turns, worker calls. `done (9f7a686, R5b commit)` — model failures only when a model was tried;
  blocked reads shown as extra agent turns (`blocked_reads` in `--json`); worker tokens labelled as reported by workers.
  Dashboard side is H1/H2.
- **R6 · P2 · `offload run --intent`** — rank log windows against a question without a model. `done (R6 commit) — run/summarize -q (alias --intent) add 'lines about the question (best N, no model)': up to 3 windows (2 before, 4 after) ranked by summed term weights lines÷lines-with-term over tokens (words match as prefixes, numbers exactly; stopwords dropped), integer-only so awk and TS agree; a non-error line in the middle of 2,000 lines (lodash cache) is found where no other section keeps it; 'case 6 … 42' on jest-many puts both case-6 windows in the top 3; awk/TS parity on 80 random logs × questions + gawk/mawk/BSD awk; 0.36 s bash / 0.24 s TS on 56k lines; hooks unchanged (their 'question' is the tool's description)`
- **R7 · P2 · Post-compaction index** — SessionStart(compact) lists recent digests/outlines, ≤ 600 B. `done (R7 commit) — SessionStart(compact) adds the session's digested outputs, newest first, to the guide: time, command, full-log path, capped at 600 bytes (counted in bytes in both engines); read from the per-command markers just before they are forgotten, so each compaction lists what came since the last; /clear lists nothing; 6 checks in all three suite modes`
- **R8 · P2 · JSON-aware digest** (= A11 for command output). `done (R8 commit) — a huge JSON output (one object/array, ≤ 16 MB) gets its top-level structure + jq commands on the log, no worker call: a 210 KB API response → 0.6 KB view (was a 2.4 KB digest of the last 15 lines plus a worker call that read 210 KB); JSON lines/invalid JSON keep the digest; hooks.json_view; same text in both engines; offload explain now lists diff and JSON views (diff views were missing); 8 conformance checks`
- **R9 · P2 (lowered) · Fewer hook processes** — hooks.json `if`/matcher filters so Claude Code doesn't start a hook for
  irrelevant calls. AC: ≥ 50 % fewer hook spawns on a recorded session; routing table unchanged. `rejected (with evidence) — Claude Code's hook 'if' exists (code.claude.com/docs/en/hooks) but holds exactly one permission rule per handler, is best-effort (runs the hook when it can't parse the command), and has no documented introduction version. Our pre-bash would need ~10 handler entries (cat/head/tail/sed/nl/bat/less/more…) and the user-configurable autowrap regex cannot be expressed as static rules; pre-read must check every file's size and post-bash every output, so they can't be filtered. Gain: ~15 ms per Bash call only. Not worth the drift risk` — lowered: the `if` field
  could not be found in the installed 2.1.316 bundle by search, and only pre-bash (~15 ms pass-through) would gain.
- **R10 · P2 · Read by symbol** `offload read path#Name`; ranked repo map. `done (R10 commit) — offload read -q Q path#Name (or path#Class.method) sends just that symbol's lines, found through the outline ranges of A5 (Go method 10-17, TS method 15-19 of 26); unknown symbol → usage error naming offload outline; same in both engines (awk also under mawk-safe syntax), in the session guide and help; 5 checks. 'Ranked repo map' part rejected: ranking a whole repo needs an index (embedding indexes were rejected in research) and explore already finds where things are on demand — recorded in DECISIONS 91`
- **R11 · P1 · Worker context-window guard** (= B6): skip/split when input exceeds the worker's window. `done (R11 commit)` —
  "too large" errors are their own class (exit 17) in both engines: no cooldown ("context limit reached" used to
  read as a quota error → 5-min cooldown of a healthy model), the chain moves on, a hint says how to send less.
  Splitting a read across calls rejected for now: answers would need merging and citations re-checking per part;
  `read` already caps input (`read.max_input_bytes`) and ranges (`path:START-END`) cover the rest.
- **R12 · P2 · Cooldown per error type** (429 / timeout / auth). `done (existing) — cooldowns already differ per error type: quota 300 s, auth 1,800 s, unknown model 3,600 s, none for timeouts or too-large inputs (R11); doctor shows the reason`
- **R13 · P2 · Subagent guide + generated read-only OpenCode/Kilo agent.** `todo`
- **R14 · P2 · Installer: diffs in dry-run, idempotent second run, install.sh SHA-256.** `done (R14 commit) — install.sh/install.ps1 download to a temp file and install only when the SHA-256 matches the release's SHA256SUMS (release CI already publishes it), so a bad download never replaces a working binary (7 checks with a file:// release: verified, tampered, missing entry); --dry-run shows the lines that change in crush.json (compared as JSON, reformatting named), JSON plan carries the diff; a second install over every agent leaves every file byte-identical (bun test snapshots home + state); bug fixed on the way: each install re-wrote crush.json.bak-harness-offload, so a second run replaced the backup of the person's own file with ours — the first backup is now kept`
- Rejected (research): LLMLingua-style token dropping (breaks identifiers/citations), embedding indexes, API-wire
  proxies (incompatible with `@host` subscription routes), auto-routers as default, rewriting the agent's commands by default.

## Added 2026-11-02 23:30 (loop)
- **N1 · P1 · Add every future real run to the corpus** — `evals/benchmark.sh --save-answers DIR` writes answers in the
  corpus format (paths → `{{DIR}}`), so the corpus grows without hand edits. AC: one command; README step. `done (N1 commit)` —
  `--save-answers PREFIX` writes the answers and prints the cases.txt lines; round trip proven with the stub (lines pasted →
  conformance passes them).
- **N2 · P2 · Real-answer corpus for digests** (pairs with R2): real `summarize` outputs + `must_keep` lines. `done (R2 commit)` — merged into R2: the deterministic digest is what
  must keep these lines (a model summary is additive); real `summarize` outputs are model text and can't be pinned.
- **N3 · P1 · Manual-try guard** — running `offload` by hand inside Claude Code silently uses the real `@host`
  worker (happened once). Doc line in CONTRIBUTING/development.md: use `OFFLOAD_MODEL=stub/…` or the suite. `done (R5b commit)` —
  docs/development.md "Trying a command by hand without spending anything"; recipe run as written (stub answered).
- **N4 · P2 · `hooks.autowrap` in the TypeScript engine** — found while building E1: the TS hooks ignore
  `hooks.autowrap` (bash only; off by default). AC: TS pre-bash wraps a matching command like bash; conformance test
  through `offload-ts hook claude pre-bash`. `done (N4 commit)` — 5 TS-hook checks (rewrite, keeps fields, ignores other/background, off by default).
