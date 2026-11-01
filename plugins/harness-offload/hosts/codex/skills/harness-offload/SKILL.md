---
name: harness-offload
description: Use Harness Offload's MCP tools (offload_read, offload_explore, offload_run, offload_write) instead of reading large files, scanning many files, or reading long command output yourself. Use when a file is over ~600 lines, a question spans many files, or a command prints a lot (tests, builds, installs, logs).
---

Harness Offload keeps bulk I/O out of your context by delegating it to a cheap worker model.

- **Big files**: `offload_read` with `question` and `paths` (files, dirs, or `file:START-END`). Answers cite `path:Lx-Ly` with quotes checked against the files — read only those lines before editing.
- **Where/how is X done?** across many files: `offload_explore` with `question`.
- **Noisy commands** (tests, builds, linters, installs): `offload_run` with `command` (and an optional `focus`). You get a summary, the verbatim error lines and the path of the full log, plus the exit code.
- **Boilerplate** (tests, configs, stubs) that follows an existing file: `offload_write` with `spec`, `reference` and `out`; review the result.
- **Finding the slice to read**: `offload_outline` with `path`.

Keep for yourself: debugging reasoning, design decisions, edits (read slices for exact text), small files.
