---
name: setup
description: Interactive first-time setup for offload — pick which OpenCode models handle each task and write the config.
disable-model-invocation: true
allowed-tools: Bash(offload doctor:*), Bash(offload config:*), Bash(opencode models:*), Bash(opencode --version:*)
---

Help the user configure offload. Steps:

1. Run `offload doctor` and `opencode models` (Bash). If opencode is missing or no provider is logged in, tell the user to install it from https://opencode.ai and run `opencode auth login` in their own terminal (it is interactive), then stop.
2. From the `opencode models` list, propose models per task, preferring cheap/fast ones the user is subscribed to:
   - `read`, `summarize`: a fast "flash"/"mini" class model with a large context window.
   - `explore`: a fast model that is good at tool calling.
   - `write`: the best coding model among the cheap ones.
   - `fallback`: one or two models from a *different* provider, so a quota wall on one plan does not stop delegation.
   Mention that some providers may train on prompts and the user should prefer ones that do not for private code.
3. Ask the user to confirm or adjust (one short question), then apply with `offload config set models.default ...`, `offload config set models.read ...`, etc. Use `offload config set models.fallback '["provider/model"]'` for the list. Add `--project` only if the user wants per-project settings.
4. Finish with `offload doctor --ping` and report the result.
