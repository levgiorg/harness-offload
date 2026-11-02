// `offload dashboard` — writes a self-contained HTML report of the stats log
// (works offline from file://: system fonts, no scripts or styles from the
// network) and prints its path. --open opens it, --sample uses example data.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlags, str } from "../args.ts";
import { TASKS, VERSION } from "../assets.ts";
import { modelChain } from "../engine.ts";
import { runProcess } from "../proc.ts";
import { listCooldowns, readStats, stateDir } from "../state.ts";
import { DASHBOARD_TEMPLATE } from "./dashboard-template.ts";

type Row = Record<string, unknown> & { ts: number; kind: string };

/** Plausible example usage for screenshots and docs, clearly flagged in the page. */
export function sampleStats(now = Math.floor(Date.now() / 1000)): Row[] {
  const rows: Row[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const models = ["claude:haiku", "claude:haiku", "claude:haiku", "opencode-go/glm-5.3-flash", "codex:gpt-6-luna"];
  const reads = ["src/billing/ledger.ts", "src/api/routes.ts", "docs/architecture.md", "packages/core/src/index.ts", "migrations/"];
  const cmds = ["npm test", "pnpm build", "cargo test", "pytest -q", "npm run lint"];
  for (let d = 29; d >= 0; d--) {
    const day = now - d * 86400;
    const n = Math.round(2 + rnd() * 9 * (d % 7 === 5 || d % 7 === 6 ? 0.3 : 1));
    for (let i = 0; i < n; i++) {
      const ts = day - Math.floor(rnd() * 30000);
      const model = models[Math.floor(rnd() * models.length)];
      const pick = rnd();
      if (pick < 0.45) {
        const bin = 20000 + Math.floor(rnd() * 120000);
        const bout = 900 + Math.floor(rnd() * 2400);
        const bad = rnd() < 0.08 ? 1 : 0;
        rows.push({ ts, kind: "read", model, label: reads[Math.floor(rnd() * reads.length)], bytes_in: bin, bytes_out: bout, saved_tokens: Math.floor((bin - bout) / 4), seconds: 4 + Math.floor(rnd() * 14), cites_ok: 1 + Math.floor(rnd() * 5), cites_bad: bad, worker_tokens_in: Math.floor(bin / 3.6), worker_tokens_out: 120 + Math.floor(rnd() * 400) });
      } else if (pick < 0.8) {
        const bin = 30000 + Math.floor(rnd() * 200000);
        const ok = rnd() > 0.05;
        rows.push({ ts, kind: "digest", source: rnd() < 0.6 ? "hook" : "run", model: ok ? model : "", model_ok: ok, label: cmds[Math.floor(rnd() * cmds.length)], bytes_in: bin, bytes_out: 2600, saved_tokens: Math.floor((bin - 2600) / 4), seconds: 3 + Math.floor(rnd() * 9), worker_tokens_in: ok ? Math.floor(bin / 4.2) : 0, worker_tokens_out: ok ? 200 + Math.floor(rnd() * 300) : 0 });
      } else if (pick < 0.95) {
        rows.push({ ts, kind: "explore", model, label: "where is the retry policy configured?", bytes_out: 1800, saved_tokens: 6000 + Math.floor(rnd() * 22000), seconds: 18 + Math.floor(rnd() * 40), cites_ok: 2 + Math.floor(rnd() * 4), cites_bad: rnd() < 0.15 ? 1 : 0, worker_tokens_in: 20000 + Math.floor(rnd() * 60000), worker_tokens_out: 600 + Math.floor(rnd() * 900) });
      } else {
        rows.push({ ts, kind: "write", model, label: "tests/test_pricing.py", lines: 120, seconds: 22, saved_tokens: 1400, worker_tokens_in: 5200, worker_tokens_out: 1800 });
      }
      if (rnd() < 0.5) rows.push({ ts: ts - 5, kind: "hook", event: rnd() < 0.7 ? "read_blocked" : "bash_dump_blocked" });
    }
  }
  return rows.sort((a, b) => a.ts - b.ts);
}

/** The report page for a set of stats rows. */
export function renderDashboard(rows: Row[], opts: { source: string; sample?: boolean; days?: number; cooldowns?: { model: string; until: number; reason: string }[] }): string {
  const data = { rows, cooldowns: opts.cooldowns ?? [], source: opts.source, sample: Boolean(opts.sample), generated: Math.floor(Date.now() / 1000), version: VERSION, days: opts.days ?? 0 };
  // JSON inside <script>: "<" escaped so no row can close the element
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return DASHBOARD_TEMPLATE.replace("/*__OFFLOAD_DATA__*/null", json);
}

export async function cmdDashboard(argv: string[]): Promise<number> {
  const { opts } = parseFlags(argv, { out: { alias: ["-o"], value: true }, open: {}, sample: {}, days: { value: true } });
  const sample = Boolean(opts.sample);
  const source = join(stateDir(), "stats.jsonl");
  const rows = sample ? sampleStats() : (readStats() as Row[]);
  const out = str(opts.out) || join(stateDir(), sample ? "dashboard-sample.html" : "dashboard.html");
  const days = Number(str(opts.days)) || 0;
  const now = Math.floor(Date.now() / 1000);
  // cooldown files are named by sanitised model refs: map them back to the refs we know
  const known = new Set<string>(rows.map((r) => String(r.model ?? "")).filter(Boolean));
  for (const t of TASKS) for (const m of modelChain(t)) known.add(m);
  const unsanitise = (f: string) => [...known].find((m) => m.replace(/[^A-Za-z0-9._-]/g, "_") === f) ?? f;
  const cooldowns = sample
    ? [{ model: "opencode-go/glm-5.3-flash", until: now + 212, reason: "rate-limit/quota" }]
    : listCooldowns().map((c) => ({ ...c, model: unsanitise(c.model) }));
  writeFileSync(out, renderDashboard(rows, { source: sample ? "example data" : source, sample, days, cooldowns }));
  process.stdout.write(`${out}\n`);
  if (!sample && !existsSync(source)) process.stderr.write("offload: no activity recorded yet; the report shows how to start\n");
  if (opts.open) {
    const [cmd, args] = process.platform === "darwin" ? ["open", [out]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", out]] : ["xdg-open", [out]];
    const r = await runProcess(cmd, args as string[], { timeoutMs: 10_000 });
    if (r.code !== 0) process.stderr.write(`offload: open it in a browser: ${out}\n`);
  }
  return 0;
}
