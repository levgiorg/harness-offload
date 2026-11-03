# MASTER-BACKLOG — final report

Branch `autopilot/rd`, local commits only (nothing pushed, published or deployed). Status on 2026-11-03.

## Where the backlog stands

| | items |
|---|---|
| done (with commit and evidence in the backlog line) | 82 |
| rejected (technical reason recorded) | 6 — A9, D3, F4, G1, L4, and the R9 hook filter (lowered, then rejected with measurements) |
| blocked (exact blocker and remaining work recorded) | 2 — C6, F3 |
| todo / doing | 0 |

Two items are marked done with only part of their criterion met; the backlog line and EXPERIMENTS.md say which
part:

- **A8, token estimate.** It is within 15% of two real tokenizers on 19 of 25 kinds of text. On CJK text,
  HTML with inline SVG and pretty-printed JSON it is off by up to 37%.
- **A5, outline size.** Large files come out at about 1 KB per 1,000 lines. Signature-dense TypeScript at
  the 600-line threshold comes to 2.2–2.4 KB, against a 2 KB target.

Two more were closed as research or with part of the work held back:

- **C4, Kilo worker.** The research is done; building it is held until a live run (DECISIONS 92).
- **R10, read by symbol.** Built. The "ranked repo map" half was rejected (DECISIONS 91).

## Blocked, and what unblocks them

- **C6 — Amp live verification.** No Amp binary or account here. Remaining work: one real install and a hook
  run, then show Amp on public pages.
- **F3 — warm OpenCode server.** Measuring it needs the real `opencode` binary, and installing it was refused
  in this environment (DECISIONS 40). Remaining work: measure cold and warm start, and build it only if that
  saves at least 1 s per call.
- **C4 — Kilo native worker (research done, build held).** Two facts decide whether the worker stays
  read-only, and neither can be checked without a Kilo binary: the JSON event schema, and whether
  `KILO_CONFIG_CONTENT` overrides an agent's permissions.

## This period's work (19 commits since 30955d2)

| Item | What changed | Evidence |
|---|---|---|
| A10/A11 | lockfile, minified and JSON reads get advice that fits; a one-line slice of a minified file is counted by size | 622 KB lockfile → `npm ls` + structure; bash/TS identical on 60 random JSON files |
| (found) | conformance suite now also runs with TS answering hooks (CI too) | found TS treating a missing primary `@host` as available |
| R8 | huge JSON output → structure + `jq` on the log, no worker call | 210 KB → 0.6 KB |
| (found) | `offload explain` left out diff views | fixed, both engines |
| G5 | eval'd config cache re-reviewed; symlinked cache ignored | 6 hostile-input checks, miss and hit paths |
| B3 | `timeouts.<task>`, ask 90 s | 6 checks on OpenCode v1/v2 |
| B4 | warning when explore's model can't explore read-only | 4 checks |
| B7 | answer length budget; runaways cut with a log | real answers ≤ 1.8 KB vs 16 KB cut point |
| R7 | after a compaction, the session's digested outputs and their logs (≤ 600 B) | 6 checks in three modes |
| L5 | each failing test's block, verbatim | jest-many fixture: 2/12 → 12/12 kept lines; gawk/mawk/BSD awk |
| C5 | doctor says when plugin or integrations are on another version | `claude plugin update` checked against the real CLI |
| D2/D4 | `install --json`, `install --ping` | bun tests with answering/silent stubs |
| R14 | SHA-256-verified downloads, dry-run diffs, idempotent re-runs | tampered download refused; second install byte-identical; a backup-overwrite bug fixed |
| L2 | status line: tokens kept out this session | stdin capped at 1 s |
| A5 | outlines with line ranges, 8 languages | fixtures + expected output, both engines, 3 awks |
| R10 | `offload read path#Name` / `#Class.method` | 5 checks |
| R6 | `--intent`: best-matching log windows without a model | a mid-log line no other section keeps; parity on 80 random logs |
| A8 | token estimate from the text instead of bytes ÷ 4 | 17/25 → 6/25 files off by > 15%; parity on 60 texts |
| D5 | every install path unit-tested as on Windows | older Crush `%LOCALAPPDATA%` config now found |
| R13 | SubagentStart guide; read-only offload-reader subagent for OpenCode v1/Kilo | schema-checked permissions; plugin validate passes |

## Final verification (one run, after the last commit)

| Check | Result |
|---|---|
| Conformance, bash engine | 694 passed, 0 failed |
| Conformance, TS CLI | 691 passed, 0 failed |
| Conformance, TS answering hooks (new mode) | 691 passed, 0 failed |
| bun tests (unit, property, installers, MCP) | 96 pass, 0 fail |
| typecheck (tsc) | clean |
| routing table | 49/49 bash, 49/49 TS |
| backends (every preset, mock) | 464 passed |
| hook latency | every pass-through hook under the 150 ms budget |
| shellcheck (errors) | clean |
| dist | rebuilt byte-identical (`source-hash --check`, clean tree) |
| release check + packed-tarball smoke | ok (1.04 MB packed) |
| `claude plugin validate` | passed |

## Things the owner should know

- Saved-token figures recorded from now on will be roughly 20–40% higher for the same work, because the
  estimate is now closer to real tokenizers. Older stats rows keep their bytes ÷ 4 values, and the README
  numbers came from earlier measured runs.
- Files of about 7–22 KB now cost about 4 ms more per Read (the hook counts their tokens); everything else
  is unchanged.
- No real model calls were made: everything ran against stubs and mocks. Real-model checks of the new
  answer budget and subagent guide are still to do.
