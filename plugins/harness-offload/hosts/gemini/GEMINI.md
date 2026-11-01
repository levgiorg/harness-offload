# Harness Offload

Harness Offload is installed: cheap worker models do bulk reading and digesting so it stays out of your context.

- Files over ~600 lines, or questions about many files: use the `offload_read` tool (`question`, `paths`) or `offload_explore` (`question`). Answers cite `path:Lx-Ly` with machine-checked quotes — read only those lines (read_file with start_line/end_line) before editing.
- Noisy commands (tests, builds, installs, linters): use `offload_run` (`command`, optional `focus`); it returns a digest, the verbatim error lines and the full-log path.
- Boilerplate that follows an existing file: `offload_write` (`spec`, `reference`, `out`), then review it.
- Keep debugging, design decisions and edits for yourself.
