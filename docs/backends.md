# Worker backends

Who does the cheap reading. Pick per task with `offload setup` or `offload config set models.<task> REF`.

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
| **HTTP APIs** | `openrouter:qwen/qwen3-coder`, `openai:…`, `anthropic:…`, `google:gemini-…`, `groq:…`, `deepseek:…`, `mistral:…`, `together:…`, `fireworks:…`, `cerebras:…`, `xai:…`, `zai:glm-…`, `moonshot:kimi-…` | API keys (`offload setup` stores them `0600`, or use the usual env vars) |
| **Local** | `ollama:qwen3:8b`, `lmstudio:…`, `vllm:…` | your machine |
| **Your own endpoint** | `mygw:model` | `endpoints.mygw = {type: "openai"\|"anthropic", base_url, api_key_env}` |

`explore` works on every backend: HTTP models get a sandboxed read-only tool loop (read_file, grep,
glob, list_dir — confined to the project's real directory, symlinks not followed, `.git` and secrets
refused, every result redacted). The bash engine runs agent CLIs and HTTP APIs itself (curl); only
`explore` over an HTTP API uses the bundled Node CLI.

Per task you can pick a different model, plus a **fallback chain across backends** (default:
`@host`, then OpenCode's default model; an explicit `-m MODEL` is used alone): a quota wall
(OpenCode retries those silently forever — offload stops after two retries) cools that model down
for 5 min, auth errors 30 min, unknown models 1 h, and the next model takes over.
