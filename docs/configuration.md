# Configuration

`~/.config/harness-offload/config.json` (user) and `<repo>/.harness-offload.json` (project). Edit
with `offload config set KEY VALUE [--project]`; inspect with `offload config show`. A repository's file
is **untrusted**: it may set models, tasks, thresholds and hook behaviour and add secret globs, but not
binaries, endpoints, the backend, the state directory or privacy relaxations — unless you run
`offload config trust` in it (`offload doctor` lists ignored keys). Defaults:
[`plugins/harness-offload/config/defaults.json`](plugins/harness-offload/config/defaults.json).

| Key | Default | Meaning |
|---|---|---|
| `models.{default,read,explore,summarize,write,ask}` | `default`: `@host` | `BACKEND:MODEL` per task; empty → `default` |
| `models.fallback` | `["@default"]` | tried in order when a model fails (easiest: `offload model …`) |
| `tasks.<name>` | none | your own tasks: `{description, prompt \| prompt_file, model, tools: "none"\|"read"}` — see [commands](commands.md#your-own-tasks); allowed in a repo's file |
| `host_models.<host>` | see connectors | what `@host` means in each harness |
| `host_api_models.<host>` | see connectors | what `@host-api` means: the same model family through an API key ([backends](backends.md#if-your-agents-own-route-stops-working-an-api-key-takes-over)) |
| `trusted_projects` | `[]` | project dirs whose `.harness-offload.json` is fully trusted (`offload config trust`) |
| `backend` | `opencode` | backend for bare `provider/model` refs |
| `endpoints.<name>` | presets | `{type, base_url, api_key_env}` for your own gateways |
| `variants.<task>` | `""` | reasoning effort per task (`low`, `high`, …) |
| `hooks.read_guard` | `block` | `block` · `ask` · `suggest` (allow + advice) · `off` |
| `hooks.read_threshold_lines` / `_tokens` | `600` / `6000` | a full read above either is guarded |
| `hooks.read_max_chunk_lines` | `600` | largest slice allowed (`Read` offset/limit, `head -n`, `sed -n`) |
| `hooks.summarize_bash_output` | `true` | post-command digests |
| `hooks.bash_output_threshold_lines` / `_bytes` | `250` / `20000` | when output gets digested |
| `hooks.digest_timeout_seconds` | `20` | how long the agent may wait for the worker's summary of a long output (fallbacks included); after that, or with `0`, the digest is the instant deterministic one (key lines + tail) |
| `hooks.bash_never_summarize` | viewers regex | commands whose output is never digested (`grep`, `cat`, `git diff`, …) |
| `hooks.autowrap` | `false` | rewrite noisy commands to `offload run -c '…'` (changes what permission rules see) |
| `hooks.subagents` | `true` | also guard subagents' tool calls |
| `hosts.<codex\|cursor>.call` | `mcp` | how the agent should call offload there (`mcp` or `shell`) |
| `opencode.timeout_seconds` | `180` | per-call ceiling (all backends) |
| `explore.max_steps` | `40` | tool budget of the explorer |
| `digest.use_model` | `true` | `false` = deterministic digests only |
| `privacy.secret_globs` / `redact` | `.env*`, keys, … / `true` | never sent; credential shapes masked |
| `mcp.run_tool` / `mcp.run_timeout_seconds` | `true` / `1800` | expose `offload_run` (runs outside a host's sandbox) and its limit |

Environment: `OFFLOAD_MODEL`, `OFFLOAD_READ_GUARD`, `OFFLOAD_MIN_LINES`, `OFFLOAD_TIMEOUT`,
`OFFLOAD_DISABLE`, `OFFLOAD_CONFIG`, `OFFLOAD_STATE_DIR`, `OFFLOAD_NO_MODEL=1`. Prefix a command
with `OFFLOAD_RAW=1 ` to bypass the shell guard and digest.

## Privacy

- Files matching `privacy.secret_globs` (`.env*`, `*.pem`, `*.key`, `id_rsa*`, credentials, tfstate…)
  are refused — matched case-insensitively and on symlink targets — (`--allow-secrets` to override) and
  the explorer can't read them.
- Cloud/GitHub/GitLab/npm/Stripe/OpenAI/Slack/Google keys, Bearer/Basic auth, URL credentials, JWTs,
  `password=…` values and private-key blocks are masked in everything sent to a worker, in command
  lines, log names and stats, and in worker answers.
- Trust model, safeguards and known limits: [SECURITY.md](SECURITY.md).
- Some providers train on prompts — pick ones that don't for private code.
- API keys stored by `offload setup` or `offload key NAME` live in `~/.config/harness-offload/credentials.json`
  (mode `600`); `offload key` reads them hidden or from stdin, never from the command line, and never prints them.
