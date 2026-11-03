# Progress log

## 2026-11-01 ~22:45 UTC — kickoff
- Created `/home/user/code-offload` from the working prototype (Claude Code plugin + bash CLI, 154 offline tests green after rename).
- Research agents launched: (a) Codex + Cursor + Windsurf formats, hooks and worker CLIs; (b) Pi, Gemini CLI, OpenCode plugin APIs.
- Next: M0 (license, acknowledgements, original evals), M1 (layout + CI), then the TS engine.

## 2026-11-01 ~23:45 UTC — M0 done, M2 core done
- M0: MIT license, `scripts/set-owner.sh`, original fixtures (`evals/fixtures/warehouse`, generated `ledger.ts`/`ci.log`), host-neutral routing table `evals/hooks.json` (47 cases, bash hooks 47/47), benchmark spec + runner; third-party files removed; design notes rewritten.
- Shared assets: worker prompts, `config/defaults.json`, new `config/outline.json` (bash now reads outline regexes from it) → generated into the TS package.
- TS engine (`packages/cli`): config/state/text/secrets/outline/verify/digest ported; connectors: opencode v1/v2, 16 HTTP presets (OpenAI-compatible + Anthropic, with a sandboxed read-only tool loop for explore), CLI agents claude/codex/gemini/pi/cursor (flags per research). `OFFLOAD_DISABLE=1` passed to every worker (no hook recursion).
- Verified: the bash conformance suite run against the TS CLI → 154/154. Fixed along the way: process-group kill on timeout (stuck grandchildren kept pipes open).
- Research saved: `docs/research/pi-gemini-opencode.md`, `docs/research/codex-cursor-devin.md`.
- Next: TS hook logic + `offload hook <host> <event>` adapters (claude, codex, cursor, gemini), MCP server, per-host plugin packaging, install/setup, CI.

## 2026-11-02 ~01:30 UTC — M1, M3, M4, M5, M6 mostly done
- `offload worker` transport: the bash engine routes `BACKEND:MODEL` refs through the TS connectors (one implementation per connector). HTTP connector tests (mock OpenAI endpoint: tools, explore loop, secrets, path escape, 401/429) → 166/166 on both engines.
- TS hook logic + adapters (`offload hook <host> <event>`) for claude/codex/cursor/gemini; routing table 49/49 on bash and TS hooks; bun tests for adapters.
- MCP server (`offload mcp`, 7 tools) tested with the SDK client.
- Host packaging: `.codex-plugin` (hooks/MCP/skill), `.cursor-plugin` (hooks/MCP/always-on rule), Gemini extension, Pi extension (native tools, guard, digest, guide), OpenCode v1+v2 plugin. **Verified in real hosts:** OpenCode 1.19.5 & 2.2.5 block a 1,200-line read via the plugin; Pi 1.4.0 loads the extension and blocks it; Pi works as a worker; Claude Code and Codex CLIs install the plugin from the bundled marketplace (installed + enabled).
- `offload install/uninstall` for 8 hosts (stub-tested + real claude/codex); `offload setup` wizard (driven end-to-end through a pty) + `--yes` mode.
- CI (TS on ubuntu/macos/windows; bash suites incl. macOS system bash 3.2; shellcheck; manifest/version checks), release workflow (bun-compiled binaries for 5 targets, npm publish, plugin zip), install.sh/install.ps1. Standalone binary smoke-tested locally.
- README rewritten; docs/hosts.md, CHANGELOG, CONTRIBUTING, SECURITY.
- Next (M7): real-model validation pass, polish, warm server, more hosts.

## 2026-11-02 ~00:10 UTC — renamed to Harness Offload
- Repo moved to `/home/user/harness-offload` (symlink from the old path), plugin `plugins/harness-offload`, npm `harness-offload` (bins `offload`, `harness-offload`), config `~/.config/harness-offload/`, project file `.harness-offload.json`, marketplace `harness-offload@harness-offload`. Loop re-created with the new path (job ec77080e).
- All suites green after the rename: bun 31/31, conformance 166/166 ×2 engines, routing 49/49 ×2.

## 2026-11-02 ~08:00 UTC — same subscription (@host), native bash connectors, project-config lockdown
- `@host`/`@self` model ref: the calling harness's own cheap model (Claude Code → `claude:haiku`, Codex → `codex:gpt-6-luna`, Gemini CLI → `gemini:flash-lite`, Cursor/Pi → defaults). Host from `OFFLOAD_HOST` (set by our hooks/MCP launchers/in-process plugins) or env detection. `host_models` overridable.
- Bash engine: `lib/agents.sh` — native claude/codex/gemini/cursor-agent/pi workers + OpenAI-compatible/Anthropic HTTP via curl (keys via a header file, never argv). Routing in `co_route`. Claude worker hardened (no settings/MCP/slash commands, own system prompt).
- Security review (background agent) delivered 12 findings; fixed the critical one: untrusted project config (DECISIONS #18). Rest tracked as tasks.
- Research agent verified Copilot CLI / Crush / Qwen Code hook surfaces → docs/research/copilot-crush-qwen-amp.md.
- Verified: conformance 206/206 on both engines (stub agent CLIs, @host, malicious project config), bun 31/31, routing 49/49 ×2.

## 2026-11-02 ~09:00 UTC — self-contained plugin, wizard @host, zero-config default
- `plugins/harness-offload/dist/` holds the bundled TS CLI (+ pi.js, opencode.js), checked by `source-hash.mjs --check` in CI. Launchers prefer it; paths with spaces handled (`co_ts_run`).
- `offload setup` first asks "who should do the cheap work?" — own subscription (@host, default), own subscription + fallback, or chosen backends; explains the saving honestly. `--yes` defaults to `@host`. Verified through a pty with a stub `claude`.
- Doctors (bash + TS) explain @host and check each model's real backend.
- Defaults: `@host` then `@default`; `-m` exact. Real check with the real Claude CLI (bash engine, no Node needed for the worker): Haiku read of agents.sh, 11 s, 5/5 citations.
- Suites: conformance 209/209 ×2 engines, routing 49/49 ×2, bun 31/31.

## 2026-11-02 ~11:00 UTC — security review fixed (all 12 findings)
- Critical: untrusted project config (earlier). High: explore tool sandbox (real paths, no symlinks, .git refused, regex worker with deadline, caps, redaction), fail-open OpenCode/Pi plugins, no `process.env` side effects (digest options + total budget in both engines).
- Medium: process lifecycle (exit+drain, group kill, signal/exit cleanup, UTF-8 decoding, abort), bounded citation checks (both engines), wider redaction + redacted command labels/log names/stats/answers, Claude explore denies secret files, MCP limits/cancel/annotations/`mcp.run_tool`.
- Windows: no shell (npm shims → node script, escaped cmd.exe fallback), taskkill tree, Cursor/Gemini installs rewritten to node + bundled CLI, `run -- npm test` via shims.
- Low: "ask" no longer a hard deny where hosts can't ask (Codex/Gemini/OpenCode/Pi → advice; Cursor → permission ask), Cursor notes no longer auto-approve, HTTP body timeouts, Gemini pretty JSON after log lines.
- SECURITY.md rewritten with the trust model and known limits.
- Suites: conformance 229/229 ×2, bun 43/43, routing 49/49 ×2.

## 2026-11-02 ~12:30 UTC — all known harnesses
- Copilot CLI (loads the Claude plugin; bash hooks speak its dialect), Qwen Code (converted extension), Crush (crush.json hooks + global context guide), Amp (experimental plugin), Aider (conventions file), MCP snippets for Cline/Zed/Continue/Goose/Kiro/VS Code/Claude Desktop.
- Real end-to-end runs with Copilot CLI 1.0.105, Crush 0.99.0 and Qwen Code 0.26.5 against a mock model: big read denied with outline (all three), long output digested (Copilot, Crush), guide injected (all three).
- Suites: conformance 236/236 ×2, bun 50/50, routing 49/49 ×2.

## 2026-11-02 ~13:30 UTC — loop: validation report, per-host e2e, UI fix round
- docs/VALIDATION.md: 2026-11-02 section (real Claude plan via @host in both engines; Copilot/Crush/Qwen runs).
- tests/mock_openai.py gained a scripted tool-call mode; tests/e2e-hosts.sh runs the real Copilot CLI, Crush and Qwen Code against it in throwaway homes: 9/9. Manual + weekly workflow hosts-e2e.yml.
- Impeccable finish review (fresh reviewer): fix on both surfaces; fix batch applied (dark paper, ink-masked stamp, CHECKED impressions, red reserved, stacked phone records, cooldowns panel, square stamp chips, empty-period message); recaptured; verdict pass pending.
- UI verdict pass (2nd round): fix on both; the three regressions it found (phone empty state, a false sentence about the TS engine, cooldown file names) fixed and checked in one recapture; per the playbook's two-round budget the remaining taste/process items (direction roll, stamp asset) go to the owner. DESIGN.md written.
- Bash `offload stats --json` and sparkline (parity with TS; conformance 240/240 ×2). bun 52/52.

## 2026-11-02 ~14:00 UTC — delivery
- harness-offload.zip (repo with history, 32 commits) sent; smoke-tested from a fresh unzip: conformance 240/240 with no build step, bundled CLI runs, dist hash current.
- Private previews published: landing page and a sample report.
- Remaining unchecked: M4 "beautiful CLI" polish for the bash engine's colors/tables, M7 context-aware thresholds, `offload serve` (deferred). Open owner questions are in the delivery report.

## 2026-11-02 ~07:00 UTC — README, strict CI, handoff (owner request)
- README rewritten in the style of current agent-tool READMEs (OpenCode, Crush, Gemini CLI): one-line pitch, real-output demo GIF (`scripts/demo/` records it from `session.json`, real Haiku runs), two install blocks, results table, four commands, dashboard screenshot, 4-step "how it works", docs table. Reference moved to docs/backends, commands, configuration, how-it-works, development; harness table merged into docs/hosts.md.
- CI: concurrency cancel, job timeouts, strict `claude plugin validate`, shellcheck warning level for scripts, single required `ci-ok` gate, merge-queue trigger; hosts-e2e also on PRs touching hooks/connectors/hosts (Node on PATH for runners). CODEOWNERS, `scripts/protect-main.sh`, CONTRIBUTING with the check matrix, PR checklist, set-owner made word-safe (CODEOWNERS), npm README links rewritten to absolute at release.
- CLAUDE.md (auto-loaded project notes) + docs/HANDOFF.md.
- Local CI-equivalent green: shellcheck (error + warning), typecheck, bun 52/52, conformance 252/252 ×2, routing 49/49 ×2, dist current, plugin validate; real-harness e2e 16/16.

## 2026-11-02 ~22:40 UTC — autonomous R&D loop starts (branch autopilot/rd)
- Set up: MASTER-BACKLOG (66 items + 14 from research), EXPERIMENTS, RESEARCH (34 sources, subagent), `.claude/loop.md`,
  one session cron every 30 min (13,43).
- A1 search view (both engines): huge grep/rg/find output → counts per file/folder + first matches + log path.
  Measured: 164 KB rg → 3.5 KB (116 ms bash / 68 ms TS); 529 KB find → 3.4 KB. Byte-identical across gawk/mawk/BSD awk and TS.
- Also: TS hook digests no longer end with an extra newline (parity with bash).
- Checks: conformance 423/423 bash, 420/420 TS (+14), routing 49×2, bun 70/70, hooks under budget, dist fresh, shellcheck.
- Next: R1 near-duplicate collapse in digests; R9 verify hooks.json `if` filter support.

## 2026-11-02 ~23:00 UTC — R1: real errors no longer hidden by warning floods
- Baseline (both engines): 600 near-identical warnings filled the 30 key-line slots; a TS error and a failing test were not shown.
- Now kinds (digits masked) with error-like kinds first; both errors shown; 3,705 → 1,674 B; CI-log fixture unchanged;
  identical across gawk/mawk/BSD awk and TS.
- Checks: conformance 428/425 (+5, fail on old code), bun 70, routing 49×2, hooks under budget, dist fresh, shellcheck.
- Next: R9 (hooks.json filters → fewer hook processes) — verify support first; R2 must_keep fixtures.

## 2026-11-02 ~23:15 UTC — B1: `path:N` citations into known files are checked
- Both engines: `name:N` counts as a citation only when `name` is a sent/known file; a second backtick span is tried.
- Real answers re-verified: bash custom task 0/0 → 3/0; explore 10/1 and 8/1 unchanged; awk and TS agree.
- Checks: conformance 430/427 (+2; the positive one fails on the old verifier), bun 70, dist fresh.
- Incident: one manual `offload read` outside the test harness used the real `@host` worker (one tiny Haiku call) because
  the session runs inside Claude Code. From now on manual tries set `OFFLOAD_MODEL=stub/ok` or run via the suite.
- Next: J1 real-answer regression fixtures; R4 seen-output dedup; R5 honest ledger.

## 2026-11-02 ~23:35 UTC — J1: real-answer corpus
- `evals/real-answers/`: 8 real Haiku answers (benchmark read ×4, custom task read ×2, explore-type task ×2) with the
  counts both engines must give; the fixture files are regenerated (`evals/fixtures/generate.sh`) plus `orders.py`.
  The benchmark cases read files from outside the current folder, as the real runs did.
- Conformance runs them: bash 438/438, TS 435/435. Against the verifier from before today's fixes (f581f37): 6/8 fail.
- Next: N3 (doc), R4 seen-output dedup, R5 honest ledger.

## 2026-11-02 ~23:50 UTC — R4: an identical re-run is one line
- Both engines: post-bash keeps a per-session marker of outputs it digested or search-viewed; the same output again →
  one line pointing at the first log; compaction or /clear forgets; checked byte for byte against the log.
- Measured on the 129 KB CI log: repeat 86 ms (bash) / 58 ms (TS), 377 B, no worker call.
- Checks: conformance 452/449 (+14), bun 70, routing 49×2, backends 464, hooks under budget, dist fresh, shellcheck.
- Next: R5 honest ledger (stats: metered vs estimated; repeats/search views as their own rows in the report), N3 doc.

## 2026-11-02 ~23:55 UTC — loop: R5 slice 1, honest failure counts
- Both engines + report: model failures = a model was tried and failed (`model_tried`); before, 2 of 2 rows in a
  no-model session read as failures. Bash stats table no longer truncates `digest:summarize`.
- Checks: conformance 455/452 (+3), bun 70, routing 49×2, hooks under budget, dist fresh, shellcheck.
- Next: R5 slice 2 (blocked reads = extra agent turns, shown next to savings), N3 doc.

## 2026-11-03 — goal: finish the whole backlog. R5 done, N3 done
- R5 slice 2 (both engines): `offload stats` shows blocked reads as extra agent turns and `--json` has `blocked_reads`.
- N3: docs/development.md explains free hand-tries with the stub worker; verified.
- Checks: conformance 458/455, bun 70, dist fresh, shellcheck.
- Handoff: the order of work is P1 → P2 → P3 in MASTER-BACKLOG; each item gets `done (sha)`, `rejected (reason)` or
  `blocked (exact blocker)`. Resume by reading this file's tail and the first `todo` in priority order.

## 2026-11-03 — G2 and A3
- G2: the state folder (logs, stats) is 0700, existing installs included (was 755/644, world-readable).
- A3: library/runtime stack frames (node_modules, site-packages, java.base, junit, go runtime…) are counted, not shown
  in key lines; fixture 2,549 → 1,673 B with every failure kept.
- Checks: conformance 464/461, bun 70, dist fresh, shellcheck, hooks within budget.

## 2026-11-03 — E1 `offload explain`
- Both engines, identical text: last N hook decisions (blocked Read/`cat`/slice, digest, search view, repeat, autowrap)
  with file or log, the rule and its current value, and the command to change or turn it off.
- Stats rows: hook events carry `file`; digest rows carry `log`. Doc recipe fixed (TS warned on OFFLOAD_CONFIG=/dev/null).
- Found: TS engine has no autowrap → N4.
- Checks: conformance 471/468, bun 70, routing 49×2, hooks within budget, dist fresh, shellcheck.

## 2026-11-03 — goal run, checkpoint
Done since the goal started (each in both engines unless docs/tests only; evidence in MASTER-BACKLOG):
R5, N3, G2, A3, E1, N4, I1, R2/N2, R11/B6, N1, B2, D1, C1, K1, A4/R3, H1–H5, G3, G4 (found + fixed quadratic
TS redaction: 4 MB post-bash >30 s → 163 ms), K2–K4, E2, C2, C3 (Gemini ask/dir_path fixes from upstream source),
E5, E6, E4, E3/L6. Conformance 558/555, bun 80, routing 49×2, backends 464, hooks within budget, dist reproducible.
Resume: `python3 - <<…` list of `todo` items in MASTER-BACKLOG (P2 then P3); mark each with done/rejected/blocked.

## 2026-11-03 — goal run, checkpoint 2
Done since checkpoint 1: R4b, I2/I3/I4/G6/J4, R12 (existing), D3 (rejected), L3 (existing), J2, F2 (TS streams huge
outputs: 315 → 120 MB, flat), F5 (git list buffer bug: 50k-file explore 1,332 → 205 ms), L1, A7 (diff view), J5 (launcher
fix), B5 (fallback reasons), B8 (prompt fencing), F3/C6 (blocked), F4/A9/R9/L4 (rejected with reasons), A6 (answer
cache), G7 (bash orphan workers fixed), J3 (worker crash messages). Conformance 600/597, bun 81, backends 464.
Open (P2/P3): A5 A8 A10 A11 B3 B4 B7 C4 C5 D2 D4 D5 G5 L2 L5 R6 R7 R8 R10 R13 R14.
