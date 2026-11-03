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
