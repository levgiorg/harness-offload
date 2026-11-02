# Performance: what offload costs your agent

Offload's hooks sit in front of (and after) the agent's tool calls, and the harness waits for them. This page
measures that wait, with and without offload, and records what was done to keep it small. All numbers below
are medians from 2026-11-02 on a 4-vCPU Linux container (Node 22.23, bash 5.2, jq 1.7); absolute values move
with the machine, ratios don't.

## In one sentence

With offload installed, a typical tool call waits **~15–20 ms** (Claude Code, bash hooks) or **~40 ms**
(Codex, Cursor, Gemini and the others, Node hooks) more than without it; a call offload acts on (a huge read
stopped, a long output digested) costs **50–275 ms** plus, for the digest, the cheap model's answer, capped at
**20 s** (`hooks.digest_timeout_seconds`, `0` = never wait for a model).

## Real Claude Code, with and without offload

`bench/claude-e2e.sh` runs the real Claude Code 2.1.316 headless against a scripted mock of the Anthropic API
that answers instantly and asks for the same 17 tool calls every run (small and big reads, a slice, `ls`,
`cat`, `grep`, one long test output). Whatever time differs is the plugin. 7 runs each, alternating.

| | plugin off | plugin on, before | plugin on, now |
|---|---:|---:|---:|
| session wall time | 1,136 ms | 5,707 ms | 2,086 ms |
| added by offload, per session | — | +4,365 ms | **+950 ms** |
| added per tool call | — | +257 ms | **+56 ms** |
| bytes of tool results the model reads | 228,648 | 26,763 | 26,763 |

The model reads ~201,900 fewer bytes (~50,000 tokens) per session in both versions — the speed-up changed no
decision. With a real model, reading those tokens takes far longer than the hooks: a model processes 50K
input tokens in seconds, not milliseconds, and they stay in the context for the rest of the session.

## Every hook, both engines

`bench/hooks.mjs` runs each hook 30 times (after 3 warm-ups) in an isolated home with the offline stub
worker, and checks every answer (pass, deny, note, digest), so a fast wrong answer can't pass as a fast hook.
"bash" is the Claude Code plugin's own hooks (also Copilot CLI and Qwen Code); "ts" is the launcher every
other host calls (`bin/offload-ts hook …`).

| hook scenario | bash before | bash now | ts before | ts now |
|---|---:|---:|---:|---:|
| small file read (passes) | 175 | **17** | 104 | **40** |
| big file read, slice (passes) | 171 | **21** | 111 | **42** |
| `ls` (passes) | 140 | **18** | 111 | **36** |
| short command output (passes) | 104 | **16** | 106 | **41** |
| big file read (blocked, with outline) | 233 | **79** | 109 | **52** |
| `cat` of a big file (blocked) | 239 | **81** | 116 | **52** |
| long output digest, no model | 327 | **121** | 116 | **54** |
| long output digest, stub model | 862 | **274** | 126 | **72** |
| session start | 76 | **38** | 104 | **43** |
| offload switched off (`OFFLOAD_DISABLE=1`) | 35 | **5** | 115 | **5** |
| no worker installed, big read (passes) | 94 | **50** | 106 | **39** |

Baselines on the same machine: starting any process 1.8 ms, `bash -c :` 2.7 ms, one `jq` 3.5 ms,
`node -e 0` 29 ms. A Node hook can't go below Node's own start, which is why the bash hooks are the faster
path for Claude Code.

## What was slow, and what changed

Found by profiling (`strace` process counts, bash xtrace with timestamps, V8 CPU profiles), not guessed:

**Bash hooks**
- **74 processes per Read check, 25 of them `jq`.** The hook input is now parsed by one `jq`; the config
  (defaults ← user ← project ← environment) is merged by one `jq` that also turns every key into a shell
  variable, so later lookups start no process. Result: 4 processes for a small read (bash, `cat`, one `jq`,
  one `wc`), down from 74.
- **The availability probe ran first.** "Is a worker installed and not cooling down?" was asked before
  looking at the file. Now the cheap, decisive facts come first (file size via one `wc`, the command's shape,
  the output's size measured while parsing the input); the probe and the worker code
  (`lib/opencode.sh`, `lib/agents.sh`) load only when a hook is about to act.
- **Config cache.** The merged config is kept per project, keyed by the full text of the three config files
  and the environment overrides (read with a bash builtin), so an edit applies on the very next call — no
  timestamps, no race. It is private (0600 in a 0700 directory) and used only when owned by the current user.
  `OFFLOAD_NO_CONFIG_CACHE=1` turns it off.
- **A worker call waited up to 0.3 s after the worker finished** (a poll loop). A background watchdog now
  enforces the deadline while the hook waits on the worker itself; the watchdog's stdio is detached, because
  the harness waits until every holder of the hook's stdout has closed it (a background `sleep` held it open
  for another 0.3 s).
- Smaller: `basename`, `tr`, `awk`, `date` and `jq` replaced by builtins where bash allows (lowercasing uses
  `tr` on macOS's bash 3.2), and the text-vs-binary check is a single builtin `read`.
- `OFFLOAD_DISABLE=1` exits before any config is read.

**Node (TypeScript) hooks**
- **40 ms of every call went to compiling a 1.2 MB bundle** (MCP SDK, zod, the setup wizard and the report
  page, none of which a hook uses). The CLI is now split into chunks loaded on demand, the report page (with
  its fonts) is its own module, and hooks run from `dist/hook.cjs`, a 108 KB CommonJS bundle of the hook path
  alone — Node's ESM loader alone costs ~10 ms per start.
- **The plugin's `dist/` had no `package.json`.** Node guessed each file's format (slower), and Node 18 or
  an early Node 20 would have refused to load it, so offload's hooks silently did nothing there. It now says
  `"type": "module"`.
- `child_process`, `worker_threads` and terminal colours load on first use; stdin is read in one call
  instead of through Node's stream machinery.
- `dist/cli.js` turns on Node's compile cache (Node 22.1+; `NODE_DISABLE_COMPILE_CACHE=1` turns it off).
- The `offload-ts` launcher starts no process before handing over, and with `OFFLOAD_DISABLE=1` it answers
  without starting Node at all.

**Both engines**
- `hooks.digest_timeout_seconds` now defaults to **20** (was 90): the agent never waits longer than that for
  the worker's summary of a long output; the deterministic digest (verbatim key lines + tail, which carried
  every fact in the [validation runs](VALIDATION.md)) is used instead. `0` makes hook digests instant.

## Run it yourself

```bash
node bench/hooks.mjs                      # every hook, both engines (add --engine bash|ts, --runs N, --json FILE)
bash bench/claude-e2e.sh [RUNS]           # real Claude Code with/without the plugin (needs `claude` and python3)
node bench/hooks.mjs --budget-ms 150      # what CI runs: fails when a pass-through hook gets slow
```

CI runs the hook benchmark on Linux and on macOS with the system bash 3.2 (budget 150 / 400 ms, ~5× the
measured medians), which also checks every hook's decision on both.

## Not measured here

- Other harnesses end to end: Codex, Cursor and Gemini CLI were not installed in this container. Their hooks
  are the `ts` column (the same launcher and bundle they call).
- Windows: hooks installed there call `node dist/cli.js hook …` directly (the split CLI, ~42 ms here), not
  the CommonJS bundle.
- A real worker's own latency: that is the model's time (3–12 s per call in [VALIDATION.md](VALIDATION.md)),
  bounded in hooks by `hooks.digest_timeout_seconds`.
