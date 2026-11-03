# How it works

```
agent ── Read huge.ts ──────► guard ─► deny + outline + "offload read -q … huge.ts"
agent ── cat/head/sed huge ─► guard ─► same
agent ── npm test ──────────► digest ─► summary + verbatim error lines + log path
agent ── offload read/explore/run/write (CLI, MCP or native tools)
            └─► worker: OpenCode │ Pi │ Codex │ Gemini │ Cursor │ HTTP API │ local
                deny-all permissions (explorer: read/grep/glob only), secrets redacted
```

- **Deterministic first.** Error lines, counts, tails and outlines come from scripts; the model
  only adds an overview, and its citations are checked.
- **Fail open.** No backend, broken config, quota walls, `OFFLOAD_DISABLE=1` → hooks step aside.
- **Workers never act.** No edits, no shell; workers run with `OFFLOAD_DISABLE=1` so they can't
  trigger offload's own hooks.
- **Two engines, one behaviour.** The Claude Code hooks and CLI are dependency-free bash (+`jq`, `curl`
  for HTTP APIs); the `harness-offload` package is TypeScript (CLI, wizard, MCP server, report, other
  hosts, Windows) and is also bundled inside the plugin (`dist/`). Both run the same black-box
  conformance suite in CI.

More in [docs/DESIGN.md](docs/DESIGN.md).

## Good to know

- **Measure the bill, not the tool result.** A blocked read can cost your agent an extra turn, and
  each turn re-reads its context (cheaply, from cache). Savings grow with file size, session length
  and model price. Compare `/usage` with and without; tune `hooks.read_threshold_*`. `offload stats`
  shows estimates: 0.277 tokens per byte plus 1.127 per run of digits, fit on 25 kinds of text against two
  real tokenizers (within 15% on 19 of them; CJK, inline-SVG HTML and pretty-printed JSON are off by up to
  37%). Bytes ÷ 4, used before, undercounted by up to 59%.
- Failing commands' output can't be replaced by hooks on most hosts; use `offload run`.
- Each delegation costs ~1.5–3 s of start-up plus model time.
- Cheap models are wrong more often. Citations are verified — still read the cited lines before
  editing, and review `offload write` output.
