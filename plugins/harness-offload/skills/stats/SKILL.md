---
name: stats
description: Show how much work offload delegated and roughly how many Claude tokens it kept out of context.
disable-model-invocation: true
argument-hint: "[--days N]"
allowed-tools: Bash(offload stats:*)
---

Run `offload stats $ARGUMENTS` with the Bash tool and show the output to the user as-is, followed by one sentence noting that the figures are estimates (bytes/4) and do not account for extra turns or prompt caching.
