---
name: setup
description: Interactive first-time setup for Harness Offload — choose who does the cheap work (your own Claude plan via Haiku, OpenCode, Codex, Gemini, API keys, local models) and write the config.
disable-model-invocation: true
allowed-tools: Bash(offload doctor:*), Bash(offload config:*), Bash(opencode models:*), Bash(opencode --version:*), Bash(command -v:*)
---

Help the user configure Harness Offload. Keep it to a few short questions.

1. Run `offload doctor` (Bash) and `command -v claude codex gemini cursor-agent pi opencode` to see what is installed.
2. Ask one question: **who should do the cheap work?**
   - **Your own Claude plan (recommended default)** — model `@host`, which in Claude Code means `claude:haiku`
     (a lean `claude -p` with Haiku, no plugins/MCP, its own short system prompt). Nothing else to install or log in to.
     Explain honestly: the saving is that big files, logs and searches never enter the main session's context;
     the worker calls still count toward the same plan's usage limits, at Haiku's rate.
   - **Another subscription or API** — OpenCode (Zen/Go, ChatGPT, Copilot…: `opencode models` lists ids as
     `provider/model`), Codex (`codex:gpt-6-luna`), Gemini CLI (`gemini:flash-lite`), Cursor (`cursor:`), Pi (`pi:`),
     an API (`openrouter:qwen/qwen3-coder`, `groq:…`, `deepseek:…`) or a local model (`ollama:qwen3:8b`).
     For API keys, tell the user to run `offload setup` (TypeScript wizard) or export the key variable in their shell —
     never ask them to paste a key into this chat.
3. Suggest a **fallback** from a different backend so a usage limit on one plan does not stop delegation
   (e.g. `@host` first, then an OpenCode or API model). Mention that some providers may train on prompts.
4. Apply with `offload config set models.default @host` (or the chosen ref), optionally per task
   (`models.read`, `models.explore`, `models.write`) and `offload config set models.fallback '["provider/model"]'`.
   Add `--project` only if the user wants per-project settings (a repo's file cannot choose binaries or endpoints
   unless they run `offload config trust`).
5. Finish with `offload doctor --ping` and report the result in two or three lines.
