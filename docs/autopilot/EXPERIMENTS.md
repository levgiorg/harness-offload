# Experiments

Hypothesis → method → result → decision. Numbers only from runs that happened; failed and rejected ideas stay.

## E1 · 2026-11-02 · Real Haiku answers vs the citation verifier
- Hypothesis: "unverified" marks in real answers are mostly model faults.
- Method: benchmark + explore + custom tasks with `claude:haiku`, both engines; classify every ⚠unverified.
- Result: they were mostly *verifier* faults — files outside cwd (0/11), shortened paths (TS 0/10), backtick
  parity, elided quotes, repeated citations. After the fixes: 11/0, 8/0, 10/1, 3/0; the remaining flags are
  real slips (wrong line, Markdown-escaped quote).
- Decision: shipped (32a3b97); keep real answers as regression fixtures (backlog J1).

## E2 · 2026-11-02 · Write task quality
- Result: Haiku-written pytest files: 30/30 and 24/26 pass; failures were wrong expected values.
- Decision: keep "review the result" wording; consider `--check CMD` default suggestion (backlog).

## E3 · 2026-11-02 · Do real errors survive warning floods? (R1)
- Hypothesis: the digest's 30 key-line slots go to the first 30 distinct lines, so a flood of near-identical
  warnings hides later errors.
- Method: fixture of 1,200 lines (600 `deprecated API … :N:M` warnings, a TS2345 error at L500, a failing test at L700),
  `offload summarize --no-model`, both engines.
- Result before: 0 of 2 errors in the key lines ("572 more distinct"). After (kinds = digits masked; error-like kinds
  first, ≤3 each; others 1 each; printed in log order): 2 of 2, 3,705 → 1,674 B; real benchmark CI log byte-identical.
- Decision: shipped. Masking hex/uuids too was not needed for this fixture; revisit with R2's fixtures.

## E4 · 2026-11-03 · How often would a quality retry fire? (B2)
- Method: the 8 real Haiku answers in `evals/real-answers` against the retry rule (≥ 2 unverified and more than verified).
- Result: 0 of 8 would retry (worst: 6 verified / 1 unverified). With the citation fixes, the retry is a safety net for
  bad models or bad days, not a routine cost. Shipped on by default; one extra call at most.

## E5 · 2026-11-03 · Memory of the post-bash hook on huge outputs (F2)
- Method: persisted outputs of 56 MB and 224 MB, OFFLOAD_NO_MODEL=1, peak RSS of the hook process (getrusage).
- Before: bash 13 MB (awk streams); TS 315 MB for 56 MB — the text, its line array, a checksum buffer, and a second
  read by the digest. One-copy fixes alone reached 222 MB.
- After: TS streams outputs over 8 MB from disk in 1 MB chunks: 120 MB (56 MB) and 129 MB (224 MB) on a 43 MB Node
  baseline — flat in the input size; digest text identical to bash. Decision: shipped.

## A10/A11 — reads of lockfiles, minified files and JSON
- Fixtures: 622 KB package-lock (3,000 packages), 210 KB data.json, 1.4 MB one-line bundle, 24 MB JSON, invalid JSON, JSONL.
- Before: the lockfile got 4 outline lines ("packages":) with no counts; the bundle got "Read with offset/limit (max 600
  lines)" — useless for a 1-line file, and a 1-line slice passed the slice check (354k tokens on hosts that don't cut lines).
- After: lockfile → `npm ls NAME` + structure ("packages": object, 3,000 keys) + `jq '.packages | keys[0:20]'`; bundle →
  "lines average 1,417,795 characters", `grep -noE '.{0,80}PATTERN.{0,80}'`, no outline; its 1-line slice is blocked by
  size. Cost: 0.11–0.14 s per blocked read (jq on 622 KB), 0.18 s for 24 MB (over the 16 MB cap: no parse).
- Parity: identical text in bash and TS on all fixtures and on 60 random JSON files (bun property test).
- Side finding: the conformance suite never ran the TS hooks. With `OFFLOAD_ENGINE=ts` it showed 2 differences out of
  609 (one real, see DECISIONS 87; one a test's env leak); after the fix all three modes pass (612 / 609 / 609).

## R8 — JSON command output
- 210 KB API response (`curl`): before, a digest of the last 15 lines ("}", "]"…) + a worker summary that read all
  210 KB; after, 0.6 KB: structure ("users": array, 4,000 objects) + `jq '.users | length' LOG`, no worker call.
- 608 KB lockfile-shaped output → 4 structure lines; JSON lines and invalid JSON → unchanged digest. Both engines identical.

## L5 — failing tests' blocks in digests
- New fixture `jest-many` (7 failures spread through 934 lines of passes). Before: the digest kept 2 of its 12 must-keep
  lines (key lines take 3 per kind; the code frames and Received values were lost). After: 12/12, 1.8 → 3.4 KB.
- The five single-failure runner fixtures already kept most lines through the tail (failures near the end); the jest
  code frame was the one line lost there. No section appears for the other 16 fixtures.
- Same blocks from awk (gawk, mawk, BSD awk) and TypeScript on 80 random logs; 28 ms for 56k lines.

## A8 — token estimate
- Reference: OpenAI's o200k_base and cl100k_base (tiktoken, in a scratch venv); Claude's tokenizer is not available
  offline, so the target is "within 15% of both". 25 files: TS/JS/Python/shell code, jest/pytest/cargo/gradle/tsc/
  docker logs, pretty and minified JSON, a lockfile, CSV, Markdown, HTML, minified JS, CJK.
- bytes ÷ 4: 17 of 25 files off by more than 15%, worst 59% (all undercounts: dense logs, CSV, pretty JSON).
- Fits: a 7-feature model reached 13% in-sample but 83% leave-one-out (overfit). Searching small non-negative models
  by worst leave-one-out error picked 0.277 × bytes + 1.127 × digit runs: 6 of 25 over 15% (CJK 34%, HTML with
  inline SVG 35%, pretty-printed JSON 18–37%), the rest 1–15%. Shipped; the AC's "< 15 % everywhere" is not met
  for those three kinds, recorded rather than over-fitted.
- Where it is used: the read guard (the file is counted only when its size can't settle it: ~7–22 KB at the
  default 6,000-token limit; +4 ms per Read there), its messages, read footers, and every saved_tokens in stats;
  bash (awk) and TS give the same number (60 random texts). A 12.9 KB numeric CSV (÷4: 3,229 tokens) is now held
  back as ~8,900 tokens; 19.6 KB of prose still passes.
