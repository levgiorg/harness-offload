# Harness Offload — autonomous loop protocol (every 30 minutes)

Repo: this folder. Branch: `autopilot/rd` (local only — never push, open PRs, merge, publish or deploy).
Rules: CLAUDE.md (two engines in step, bash 3.2/BSD, no real model calls in tests, fail open, workers never act,
no third-party code/references in source; credits only in README Acknowledgements).

Each iteration:
1. Read `docs/autopilot/MASTER-BACKLOG.md`, the tail of `PROGRESS.md`, `EXPERIMENTS.md`; `git status`, `git log --oneline | head`.
2. If a task is `doing`, continue it. If anything is red, fix it first.
3. Research only what is not already in `RESEARCH.md` (one new source/technique per loop at most).
4. Add 5–10 evidence-backed candidates to the backlog; dedupe; mark rejected ones with the reason.
5. Pick the highest-value executable item; baseline → simplest design → both engines → tests → measure.
6. Verify with the CLAUDE.md commands that the change touches (conformance ×2 always; bench/hooks.mjs when a
   hook changed; source-hash after a TS build; pack checks when packaging changed).
7. Adversarial self-review (correctness, security, parity, latency); fix.
8. Commit locally with the session attribution trailers; mark the item `done (sha)`.
9. Append to PROGRESS.md (what changed, checks + numbers, findings, risks, next) and DECISIONS.md for choices.
10. Report in 5 lines. Never claim an unrun check; never weaken a test; real-model runs only "with measure".
