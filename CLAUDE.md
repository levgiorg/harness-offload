# Harness Offload — notes for Claude

Keeps huge reads, long command output and repo-wide searches out of a coding agent's context by
delegating them to a cheap worker model on a plan the user already pays for. CLI `offload`, npm package
`harness-offload`, MIT. Start with `docs/HANDOFF.md` for the full story so far.

## Layout
- `plugins/harness-offload/` — the Claude Code plugin and the **bash engine**: `bin/offload` (CLI),
  `lib/*.sh` (`common` config/secrets/redaction, `opencode` transport + model chain, `agents` CLI/HTTP
  connectors + `@host` routing, `digest`, `outline`, `hook`, `verify.awk`), `hooks/` (pre-read, pre-bash,
  post-bash, session-start; they also speak Copilot CLI and Qwen Code dialects), `config/*.json`
  (shared defaults, endpoints, host models), `prompts/*.md`, `hosts/` (Codex, Cursor, Gemini files),
  `dist/` (bundled TypeScript CLI — **committed**, CI checks it is current), `tests/`.
- `packages/cli/` — the **TypeScript engine**: `src/cli.ts`, `src/engine.ts` (model chain), `src/backends/`
  (opencode, http + explore tools, CLI agents, registry with `@host`), `src/commands/` (core, admin,
  setup wizard, dashboard, hook adapters, mcp, install), `src/hosts/install.ts`, `src/integrations/`
  (pi, opencode, amp), `src/ui/dashboard.html`, `test/`.
- `site/index.html` landing page · `docs/` (hosts, backends, commands, configuration, how-it-works,
  VALIDATION, design/, autopilot/ logs) · `evals/` routing table + benchmark · `scripts/` (set-owner,
  protect-main, demo GIF).

## Commands
```bash
cd packages/cli && bun install && bun run build && bun test      # build also refreshes plugins/harness-offload/dist
bash plugins/harness-offload/tests/run.sh                         # conformance, bash engine (~250 checks)
OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node bash plugins/harness-offload/tests/run.sh   # same, TS engine
bash evals/run.sh && bash evals/run.sh --ts                       # routing table
bash plugins/harness-offload/tests/e2e-hosts.sh                   # real Copilot/Crush/Qwen (COPILOT_BIN, CRUSH_BIN, QWEN_CMD)
bash plugins/harness-offload/tests/e2e-backends.sh [--live] [--agents]   # every backend one by one (mock; real URLs; real CLIs)
node packages/cli/scripts/source-hash.mjs --check                 # dist freshness (CI)
node bench/hooks.mjs [--budget-ms 150]                            # hook latency, both engines (CI)
bash bench/claude-e2e.sh                                          # real Claude Code with vs without the plugin
cd packages/cli && npm run release:check && node scripts/pack-smoke.mjs   # what npm would ship + smoke-install the real tarball
```

## Rules
- **Two engines, one behaviour.** Change bash and TypeScript together; the conformance suite runs on both.
- Shared assets live only in `plugins/harness-offload/` (generated into the TS package).
- **Fail open** (hooks, in-process plugins). **Workers never act**: read-only or no tools, `OFFLOAD_DISABLE=1`.
- **Hooks are on the hot path** (every tool call): cheap checks first, worker code loaded only to act, no new
  process per lookup (bash) — re-run `node bench/hooks.mjs` after changing one (docs/performance.md).
- A repo's `.harness-offload.json` is untrusted (no binaries/endpoints/privacy relaxations) unless `offload config trust`.
- Bash must run on macOS bash 3.2 + BSD tools; no jq regex; `LC_ALL=C` for tr/sed/awk.
- No real model calls in tests (stubs: `tests/stub-agent`, `tests/mock_openai.py`, `tests/stub-opencode`).
- No third-party code or references inside source files; credits only in README "Acknowledgements"/LICENSE.
- GitHub owner is `levgiorg` (set by `scripts/set-owner.sh`).
- Any UI work uses the impeccable skill and the Claude Code design skills (see `docs/design/`).
- README stays short; details go to `docs/`. Record decisions in `docs/autopilot/DECISIONS.md`.

## Owner
Talks in Greek; docs and code in English. Wants: same-subscription workers (`@host`) everywhere, every
known harness supported, verification before claims, an honest report of decisions.
