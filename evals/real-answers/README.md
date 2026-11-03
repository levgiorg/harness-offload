# Real answers

Answers that a real worker model (Haiku via `claude -p`) gave during validation runs, kept so the citation
verifier is tested on what models actually write: shortened paths, `path:N` without `L`, quotes cut with
`...`, two citations on one line. `{{DIR}}` stands for the folder the fixtures are generated in
(`evals/fixtures/generate.sh` + `evals/fixtures/warehouse`; `orders.py` here). `cases.txt` lists the
counts both engines must report; the conformance suite (`tests/run.sh`) checks them.

To add more after a validation run: `evals/benchmark.sh -m MODEL --save-answers NAME` saves the read answers here and
prints the `cases.txt` lines; check each unverified citation by hand (a model slip, or a verifier bug to fix) before adding them.
