# Worker backends

Who does the cheap reading. Switch any time with **`offload model REF`** (or `offload model read REF`
for one kind of work); `offload setup` walks you through it, `offload models BACKEND` lists ids.

Models are written `BACKEND:MODEL`. A bare `provider/model` means OpenCode. **`@host`** means "the
calling harness's own cheap model" and is the default.

| Backend | Example model ref | Uses |
|---|---|---|
| **Same subscription** | `@host` | Claude Code → `claude:haiku`, Codex → `codex:gpt-6-luna`, Gemini CLI → `gemini:flash-lite`, Copilot CLI → `copilot:`, Qwen Code → `qwen:`, Crush → `crush:`, Cursor → `cursor:`, Pi → `pi:`, OpenCode/Kilo → OpenCode's default (`host_models.<host>` overrides) |
| **OpenCode** (v1/v2) | `opencode-go/deepseek-v4.1-flash` | OpenCode Zen/Go, ChatGPT Plus/Pro, Copilot, coding plans (GLM, Kimi, MiniMax…), local |
| **Pi** | `pi:openai-codex/gpt-6-luna` | Pi's logins (ChatGPT, Copilot, Kimi, xAI, OpenRouter…) and API keys |
| **Codex CLI** | `codex:gpt-6-luna` | your ChatGPT plan |
| **Gemini CLI** | `gemini:flash` | your Google account (free daily quota) |
| **Cursor CLI** | `cursor:<model>` | your Cursor plan |
| **GitHub Copilot CLI** | `copilot:` or `copilot:<model>` | your Copilot plan (pick an included model to avoid premium requests) |
| **Qwen Code** | `qwen:` or `qwen:<model>` | your Qwen account or keys (background memory extraction is switched off for worker runs) |
| **Crush** | `crush:` or `crush:<provider/model>` | your Crush providers — plain questions only: `crush run` approves every tool call, so the worker runs with all tools off and is never used for `explore` |
| **Claude Code** | `claude:haiku` | your Claude plan, through a lean `claude -p` (no settings, plugins or MCP; its own short prompt). It counts toward your plan's limits at Haiku's rate; the saving is your main session's context. |
| **HTTP APIs** | `openrouter:qwen/qwen3-coder`, `openai:…`, `anthropic:…`, `google:gemini-…`, `groq:…`, `deepseek:…`, `mistral:…`, `together:…`, `fireworks:…`, `cerebras:…`, `xai:…`, `zai:glm-…`, `moonshot:kimi-…`, `dashscope:qwen-…` (Alibaba Model Studio), `github:openai/…` (GitHub Models) | API keys (`offload setup` stores them `0600`, or use the usual env vars) |
| **Local** | `ollama:qwen3:8b`, `lmstudio:…`, `vllm:…` | your machine |
| **Your own endpoint** | `mygw:model` | `endpoints.mygw = {type: "openai"\|"anthropic", base_url, api_key_env}` |

### If your agent's own route stops working: an API key takes over

`@host` runs your harness's CLI headless (`claude -p`, `codex exec`, …). If that route ever stops
working — headless use of a plan blocked, logged out, limits reached — the same model family can
answer through an API key instead. **`@host-api`** means exactly that, per harness:

| Harness | `@host-api` | Key |
|---|---|---|
| Claude Code, Devin | `anthropic:claude-haiku-5-5` | `ANTHROPIC_API_KEY` |
| Codex | `openai:gpt-6-luna` | `OPENAI_API_KEY` |
| Gemini CLI | `google:gemini-flash-lite-latest` | `GEMINI_API_KEY` |
| Qwen Code | `dashscope:qwen-flash` (Alibaba Model Studio) | `DASHSCOPE_API_KEY` |
| Copilot CLI | `github:openai/gpt-4.1-mini` (GitHub Models) | `GITHUB_TOKEN` |
| Cursor, Crush, Pi, OpenCode | none (no single API) — pick any backend above | |

```bash
offload key anthropic                       # hidden prompt; saved with mode 600
offload model fallback @host-api @default   # the plan first, the key only when the plan route fails
offload model @host-api                     # …or the key all the time
```

`offload setup` offers both when you install. Until a key is there, `@host-api` is skipped quietly;
`host_api_models.<harness>` in the config changes the model.

`explore` works on every backend: HTTP models get a sandboxed read-only tool loop (read_file, grep,
glob, list_dir — confined to the project's real directory, symlinks not followed, `.git` and secrets
refused, every result redacted). The bash engine runs agent CLIs and HTTP APIs itself (curl); only
`explore` over an HTTP API uses the bundled Node CLI.

Per task you can pick a different model, plus a **fallback chain across backends** (default:
`@host`, then OpenCode's default model; an explicit `-m MODEL` is used alone): a quota wall
(OpenCode retries those silently forever — offload stops after two retries) cools that model down
for 5 min, auth errors 30 min, unknown models 1 h, and the next model takes over.

## Verified one by one

`plugins/harness-offload/tests/e2e-backends.sh` runs every backend in both engines:

- **Every HTTP preset** (18) and a custom endpoint, against a local mock that keeps each provider's
  real URL path: the request goes to the right path (`…/chat/completions` or `/v1/messages`), with the
  right auth header (`Bearer` from the provider's env var or the credentials file; `x-api-key` +
  `anthropic-version` for Anthropic; none for local servers; custom headers), the model id intact
  (slashes and colons), no tools for `read`, read-only tools for `explore`; 401/429/404 map to exit
  11/10/13; `offload models` lists the endpoint's models; `offload model` accepts the ref. Runs in CI.
- `--live`: each cloud preset's **real URL with a fake key** must answer "not authorised" (exit 11) —
  proves URL, path and error handling with no tokens spent. Fireworks answers "model not found" for
  unknown keys (exit 13; the hint says so). Local presets with no server fail fast and clearly.
- `--agents`: each installed agent CLI (Codex, Gemini, Pi, Copilot, Qwen, Crush, Cursor) runs logged
  out: its flags are accepted and "not logged in" maps to exit 11. `--claude-live` adds one real tiny
  call per engine through `claude -p`. Copilot, Qwen and Crush also answer through a mock model in
  `tests/e2e-hosts.sh`; OpenCode v1/v2 run in `tests/run.sh --integration`.

