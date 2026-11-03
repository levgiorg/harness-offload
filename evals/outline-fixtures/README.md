# Outline fixtures

One small file per language (TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, C#) and the outline both
engines must print for it (`*.expected`). Each symbol carries a line range: it runs until the next symbol at the
same or an outer level (or the end of the file), so `L10-17` is a ready `Read(offset=10, limit=8)`.
`tests/run.sh` checks every fixture with `offload outline` (bash and TypeScript).
