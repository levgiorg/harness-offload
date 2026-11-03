# Digest fixtures

Realistic tool outputs (written for this project) and the lines a digest must never lose. Each `*.txt` is a spec:

- `# keep: TEXT` — a line the digest of this output must contain (checked without a model, both engines);
- `@@noise N TEMPLATE@@` — expands to N filler lines, `{i}` replaced by 1…N;
- every other line is output, verbatim.

`expand.awk` turns a spec into the output; `tests/run.sh` digests each one with `offload summarize --no-model`.
