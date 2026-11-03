# Development

```bash
cd packages/cli && bun install && bun run build && bun test   # TypeScript: unit, adapters, MCP, installers
bash plugins/harness-offload/tests/run.sh                         # conformance suite (bash engine)
OFFLOAD_CLI=$PWD/packages/cli/dist/offload-node bash plugins/harness-offload/tests/run.sh   # … TS engine
TS=$PWD/packages/cli/dist/offload-node; OFFLOAD_ENGINE=ts OFFLOAD_TS_CLI=$TS OFFLOAD_CLI=$TS bash plugins/harness-offload/tests/run.sh   # … TS answering the hooks too
bash plugins/harness-offload/tests/run.sh --e2e                   # + real Claude Code against a mock API
bash plugins/harness-offload/tests/e2e-backends.sh                # every HTTP preset in both engines (mock; CI)
bash plugins/harness-offload/tests/e2e-backends.sh --live --agents   # + real URLs with a fake key, real CLIs logged out
bash evals/run.sh [--ts]                                       # host-neutral routing table (49 cases)
bash evals/benchmark.sh -m <model>                             # token savings with a real model
node bench/hooks.mjs [--engine bash|ts] [--budget-ms N]           # hook latency, both engines (CI: --budget-ms)
bash bench/claude-e2e.sh [RUNS]                                # real Claude Code with vs without the plugin
```

## Trying your checkout in Claude Code (both engines)

```bash
claude plugin install harness-offload --marketplace ~/path/to/harness-offload   # once; Claude reads the checkout live
claude                        # bash engine: the plugin's own hooks (what users get)
OFFLOAD_ENGINE=ts claude      # same plugin, the TypeScript engine answers every hook and `offload` command
OFFLOAD_DISABLE=1 claude      # offload off, to compare (/context, /cost)
claude plugin uninstall harness-offload@harness-offload && claude plugin marketplace remove harness-offload
```

`offload doctor` inside a session shows which engine answered (the TypeScript one prints its own report).
Other agents from the checkout: `node packages/cli/dist/cli.js install` (asks which agents and where, points
them at the checkout) and `… uninstall` to undo. Installs from npm/npx copy their files to
`~/.local/share/harness-offload` first (the npx cache can vanish) and install Claude Code, Codex and Copilot from
GitHub.

## Trying a command by hand without spending anything

Inside Claude Code (or any harness `offload` knows), a hand-run `offload read …` uses the real worker: `@host`
resolves to the harness's own model, so it is a real, billed call. To try commands for free, use the stub
worker the tests use:

```bash
export OFFLOAD_OPENCODE_BIN=$PWD/plugins/harness-offload/tests/stub-opencode OFFLOAD_HOST=opencode \
       OFFLOAD_STATE_DIR=$(mktemp -d) OFFLOAD_CONFIG=$(mktemp -d)/config.json
STUB_ANSWER='fn3 — big.ts:L3 `export function fn3`' offload read -q "what does fn3 do?" big.ts
```

`STUB_ANSWER` is what the "worker" says; the stub never calls a model. Real-model runs are for validation only
(`evals/benchmark.sh`, recorded in `docs/VALIDATION.md`).

## The installer

`offload install` with no agent named asks which agents (the ones found are ticked) and, when Claude Code is
among them, for all projects or this one; shows the plan (what runs, which files, who reads for each agent);
installs on yes; prints a receipt (`installed` / `updated A → B`, the one step left, Check and Undo). Every
question has a flag (`--yes`, `--agents`, `--scope`, `--dry-run`); with no terminal, in CI or inside an agent it
never prompts and never guesses: it exits 2 and prints the exact command. `uninstall` mirrors it. Tests:
`packages/cli/test/install.test.ts` (flags, refusals, scope; and the prompts in a real terminal through
`test/pty-run.py`), `node scripts/pack-smoke.mjs` (the real npm tarball, installed like npx does).

## Releasing

Nothing runs at `npm install` time (no `preinstall`/`postinstall`): npm 12, pnpm 10 and Bun block those, and
they are how the 2025 npm worms spread. `scripts/pack-check.mjs` fails the build if one appears, if a needed file
is missing from the tarball, or if sources/tests would ship.

**Where it stands.** `harness-offload@0.2.1` was published by hand (the first release; `0.2.0` was withdrawn
before anyone installed it and npm never lets a number be reused). The package has a *Trusted Publisher* on
npmjs.com (GitHub Actions, owner `levgiorg`, repository `harness-offload`, workflow `release.yml`, "Allow npm
publish" ticked, no environment), and publishing access is set to *Require two-factor authentication and
disallow tokens*. No npm token is stored anywhere.

**Every release from now on:** bump the version in every manifest (CI checks they agree), move the CHANGELOG
entry under the new version, tag and push (`git tag v0.2.2 && git push --tags`; never tag a version that was
published by hand, npm refuses a second publish of it). `release.yml` checks the tag matches, builds, runs the
pack checks and the smoke install, publishes with provenance (npm adds it by itself with trusted publishing),
and attaches the standalone binaries and the plugin zip to the GitHub release. Users update by running
`npx harness-offload@latest install` again.

**Before tagging**, check what would ship, from `packages/cli` with the Bun in `.bun-version` first on `PATH`:

```bash
bun install --frozen-lockfile && bun run build
npm run release:check          # copies README/LICENSEs in, checks the tarball
node scripts/pack-smoke.mjs    # installs the real tarball in a throwaway home and runs the installer
npm publish --dry-run --access public
```

If trusted publishing ever has to be redone (a new package name, say), the first publish of a name must be
done by hand with `npm publish --access public` (asks for your 2FA code); the Trusted Publisher can only be
added once the package exists. A tombstone left by `npm unpublish` can answer the first try with a 409 for a
few minutes; trying again works.

## Performance

Hooks run before and after every tool call, so keep them cheap: decide from what is already known (sizes,
the command's shape) before loading worker code, start as few processes as possible (bash) or as little
JavaScript as possible (`dist/hook.cjs`), and re-run `node bench/hooks.mjs` after touching a hook. See
[performance.md](performance.md).

No test ever calls a paid model: `tests/mock_openai.py` stands in for providers and
`tests/mock_anthropic.py` scripts Claude Code's tool calls. Releases (`git tag vX.Y.Z`) build
standalone binaries for macOS/Linux/Windows and publish to npm. Set the GitHub owner once with
`scripts/set-owner.sh <owner>`.

```
plugins/harness-offload/     Claude Code plugin (bash hooks, CLI, prompts, config) + Codex/Cursor/Gemini host files
packages/cli/             TypeScript package: CLI, wizard, MCP server, connectors, host adapters, Pi/OpenCode integrations
evals/                    routing table, fixtures, benchmarks
docs/                     design notes, host details, research, autopilot logs
```

## Dependencies

Three at run time, each for one feature, loaded only when that feature runs:
`@clack/prompts` (the installer's and the setup wizard's questions), `@modelcontextprotocol/sdk` (`offload mcp`) and
`zod` (the MCP tools' input schemas, which the SDK requires). `typebox` is provided by the Pi host (external in the
build). Everything else is Node's standard library. The release job checks every dependency's registry signature
(`npm audit signatures`), attaches a CycloneDX SBOM (`harness-offload.cdx.json`) and SHA-256 sums, and `pack-check`
fails when the package grows past 1.5 MB packed / 5 MB unpacked.
