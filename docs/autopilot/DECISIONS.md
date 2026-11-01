# Decisions log

Questions that came up while the owner was away, with the answer chosen. The owner reviews these at
the end and can overturn any of them.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Name? Owner suggested "Harness Offloader" or "Code Offload". | **Code Offload**, tagline "the harness offloader"; CLI `offload`; npm `code-offload`. | Mirrors "Claude Code → OpenCode", short CLI that reads like English (`offload run -- npm test`); both of the owner's ideas kept. npm name free (checked 2026-11-01). |
| 2 | Bash or TypeScript? | **Both** (owner's answer). Bash = Claude Code hooks + zero-dep CLI; TS = full CLI, wizard, MCP, connectors, hosts, Windows. Shared conformance suite keeps them in sync. | Owner chose "both". |
| 3 | GitHub owner? | Placeholders `OWNER`; `scripts/set-owner.sh` rewrites them. | Owner will set it at the end. |
| 4 | Real-model tests overnight? | Yes, sparingly (Haiku/Sonnet, a few per milestone). | Owner approved "with measure". |
| 5 | Third-party evals/fixtures (Apache-2.0) from the earlier prototype? | Replaced by original cases/fixtures written from scratch; ideas credited in README. | Owner wants no third-party references in source but legal cover; copying Apache files would require keeping their notices next to them. |
| 6 | License | MIT (owner: "με MIT"). | |
| 7 | Project config location now that it is multi-host | `<repo>/.code-offload.json` (host-neutral) instead of `.claude/…`. | Same file serves Claude Code, Codex, Cursor, Pi… |
