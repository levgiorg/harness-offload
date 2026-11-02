## What changes and why

## Checklist
- [ ] Both engines updated together (bash `plugins/harness-offload` and TypeScript `packages/cli`), or the change is engine-specific
- [ ] `bun run build` run and `plugins/harness-offload/dist/` committed
- [ ] New behaviour has a test (conformance suite, bun test, or `tests/e2e-hosts.sh`)
- [ ] Docs updated (`docs/…`, and the README only if the first-minute story changed)
- [ ] No real model calls in tests; no secrets in fixtures
