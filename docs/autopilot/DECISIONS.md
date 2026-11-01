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
| 8 | Codex and Cursor sandboxes block network for agent shell commands — how should agents there delegate? | Primary path on Codex/Cursor = the MCP server (`offload mcp`) + hooks (both run outside the sandbox); deny messages there point at MCP tools. | Shell `offload` calls would fail to reach model APIs inside the sandbox. |
| 9 | Windsurf? | Treat as Devin Desktop: it reads Claude plugins and Claude hooks, so the Claude Code plugin is the integration; document it. | Cascade was removed 2026-09-08. |
| 10 | Model reference syntax across backends | `BACKEND:MODEL` (`openrouter:qwen/qwen3-coder`, `ollama:qwen3:8b`, `pi:openai-codex/gpt-6-luna`); a bare `provider/model` keeps meaning OpenCode (backward compatible). Split at the first colon only when the prefix is a known backend/endpoint. | Ollama tags contain colons; OpenCode ids contain slashes. |
| 11 | The Gemini CLI connector and the Gemini HTTP API both wanted the prefix `gemini:` | `gemini:` = Gemini CLI (uses the Google login); the HTTP preset is `google:`. | CLI connector is the subscription path the owner asked for. |
| 12 | How do non-Claude hosts find the TS CLI from plugin files? | `bin/offload-ts` launcher: `$OFFLOAD_TS_CLI` → `code-offload` on PATH → repo/npm-bundled `dist/cli.js` → `npx` (never for hooks, which fail open). | Codex/Cursor copy plugins into caches and don't put `bin/` on PATH. |
| 13 | Where does the npm package keep the plugin for `offload install`? | `assets/marketplace/` (built from the repo), a full Claude-format marketplace that Claude Code, Codex and Devin can add as a local source. | One bundle serves every marketplace-capable host offline. |
