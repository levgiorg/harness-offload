---
name: doctor
description: Check offload's setup (opencode, jq, configured models, cooldowns) and optionally ping each model.
disable-model-invocation: true
argument-hint: "[--ping] [--reset]"
allowed-tools: Bash(offload doctor:*)
---

Run `offload doctor $ARGUMENTS` with the Bash tool and show the output to the user.
If it reports problems, explain each in one line and give the exact fix (for example `opencode auth login`, or `offload config set models.default PROVIDER/MODEL`). Do not change any configuration yourself unless the user asks.
