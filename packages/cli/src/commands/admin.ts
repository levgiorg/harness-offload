import { existsSync } from "node:fs";
import { parseFlags, str } from "../args.ts";
import { TASKS } from "../assets.ts";
import { cfgStr, ignoredProjectKeys, loadConfig, readConfigFile, setConfigValue, warnings, writeConfigFile } from "../config.ts";
import { modelChain } from "../engine.ts";
import { allBackendNames, backendFor, detectHost, hostModel, parseRef } from "../backends/registry.ts";
import { opencodeConfig, opencodeMajor } from "../backends/opencode.ts";
import { projectConfigPath, projectDir, userConfigPath } from "../paths.ts";
import { runProcess, which } from "../proc.ts";
import { clearCooldowns, cooling, readStats, stateDir } from "../state.ts";
import { fmtInt } from "../text.ts";
import { banner, color, section, sym, table } from "../ui.ts";
import { VERSION } from "../assets.ts";
import { ExitError } from "./core.ts";

export async function cmdDoctor(argv: string[]): Promise<number> {
  const { opts } = parseFlags(argv, { ping: {}, reset: {}, json: {} });
  const out: string[] = [];
  const report: Record<string, unknown> = { version: VERSION, checks: [] as unknown[] };
  let problems = 0;
  const check = (ok: boolean | "warn", label: string, detail = "") => {
    (report.checks as unknown[]).push({ ok, label, detail });
    if (ok === false) problems++;
    out.push(`  ${ok === true ? sym.ok : ok === "warn" ? sym.warn : sym.bad} ${label}${detail ? color.dim(`  ${detail}`) : ""}`);
  };
  out.push(banner(`doctor · v${VERSION}`));
  out.push(section("Runtime"));
  check(true, `node ${process.version}`, process.platform + "/" + process.arch);
  for (const w of warnings) check(false, w);
  for (const f of [userConfigPath(), projectConfigPath()]) {
    if (existsSync(f)) check(true, "config", f);
    else check("warn", "config not present", f);
  }
  loadConfig();
  const ign = ignoredProjectKeys();
  if (ign.length) check("warn", `project config keys ignored (untrusted repo): ${ign.join(", ")} — \`offload config trust\` if this repo is yours`);
  if (cfgStr("enabled") === "false") check("warn", "offload is disabled (enabled=false or OFFLOAD_DISABLE=1)");
  if (opts.reset) {
    clearCooldowns();
    check(true, "cooldowns cleared");
  }

  out.push(section("Models (task → chain)"));
  const refs = new Set<string>();
  for (const t of TASKS) {
    const chain = modelChain(t);
    chain.forEach((r) => refs.add(r));
    out.push(`  ${color.cyan(t.padEnd(9))} ${sym.arrow} ${chain.join(color.dim(" → "))}`);
  }
  out.push(section("Backends in use"));
  const host = detectHost();
  if (host) check(true, `@host = the calling harness's own plan: ${host} ${sym.arrow} ${hostModel(host) ?? "?"}`);
  else out.push(`  ${color.dim(`- @host = the calling harness's own plan (no harness detected here; hooks and MCP set OFFLOAD_HOST)`)}`);
  const used = new Set<string>();
  for (const r of refs) {
    try {
      const p = parseRef(r);
      used.add(p.backend);
      if (p.ref !== r) out.push(`  ${color.dim(`${r} ${sym.arrow} ${p.ref}`)}`);
    } catch (e) {
      if (r === "@host" || r === "@self") check("warn", `${r}: resolved per harness at run time`, "none detected in this shell");
      else check(false, r, (e as Error).message);
    }
  }
  for (const name of used) {
    const b = backendFor(name);
    if (!b) {
      check(false, `${name}: unknown backend`, `known: ${allBackendNames().join(", ")}`);
      continue;
    }
    const a = await b.available();
    check(a.ok, `${b.label}`, a.detail);
    if (name === "opencode" && a.ok) {
      const major = await opencodeMajor();
      const bin = cfgStr("opencode.bin", "opencode");
      const cfg = JSON.stringify(opencodeConfig(major));
      const env = { ...process.env, OPENCODE_CONFIG_CONTENT: cfg };
      let ok = false;
      let detail = "";
      if (major >= 2) {
        const r = await runProcess(bin, ["run", "--standalone", "--format", "json", "--agent", "offload-read", "--title", "offload:doctor", "-m", "offload-doctor/none"], { input: "ping\n", env, cwd: stateDir(), timeoutMs: 60_000 });
        ok = /no-route|Model unavailable/.test(r.stdout + r.stderr);
        detail = ok ? "" : (r.stdout + r.stderr).slice(-200);
      } else {
        const r = await runProcess(bin, ["debug", "agent", "offload-read"], { env, timeoutMs: 60_000 });
        ok = r.code === 0;
        detail = ok ? "" : r.stderr.slice(-200);
      }
      check(ok, `worker agents load in opencode (v${major})`, detail);
    }
  }
  for (const r of refs) {
    const c = cooling(r);
    if (c) check("warn", `${r} cooling down`, `${c} — offload doctor --reset`);
    if (r === "@default") check("warn", "@default = the backend's own default model", "pin a cheap one: offload setup");
  }
  if (opts.ping) {
    out.push(section("Live ping"));
    const { invoke } = await import("../engine.ts");
    for (const r of refs) {
      const t0 = Date.now();
      try {
        const res = await invoke("ask", "Reply with exactly the word: pong\n", (await import("../state.ts")).workDir(), r);
        check(true, r, `${res.text.trim().slice(0, 40)} (${Math.round((Date.now() - t0) / 1000)}s)`);
      } catch (e) {
        check(false, r, String((e as Error).message).split("\n")[0].slice(0, 160));
      }
    }
  }
  out.push(section("Hooks"));
  out.push(`  read_guard=${cfgStr("hooks.read_guard")} (>${cfgStr("hooks.read_threshold_lines")} lines or >${cfgStr("hooks.read_threshold_tokens")} tokens) ${sym.dot} summarize_bash_output=${cfgStr("hooks.summarize_bash_output")} ${sym.dot} autowrap=${cfgStr("hooks.autowrap")}`);
  out.push(`  state: ${stateDir()}`);
  out.push(problems ? `\n  ${color.red(`${problems} problem(s) found.`)}\n` : `\n  ${color.green("All good.")}\n`);
  if (opts.json) process.stdout.write(JSON.stringify({ ...report, problems }, null, 2) + "\n");
  else process.stdout.write(out.join("\n") + "\n");
  return problems ? 1 : 0;
}

export function cmdStats(argv: string[]): void {
  const { opts } = parseFlags(argv, { days: { value: true }, json: {} });
  const days = Number(str(opts.days)) || 0;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const all = readStats().filter((r) => !days || r.ts >= since);
  if (!all.length) {
    process.stdout.write(`No offload activity recorded yet (${stateDir()}/stats.jsonl).\n`);
    return;
  }
  const del = all.filter((r) => r.kind !== "hook");
  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const groups = new Map<string, any[]>();
  for (const r of del) {
    const k = r.kind + (r.source ? `:${r.source}` : "");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ delegations: del.length, saved_tokens: sum(del, "saved_tokens"), worker_tokens_in: sum(del, "worker_tokens_in"), worker_tokens_out: sum(del, "worker_tokens_out"), by_kind: Object.fromEntries([...groups].map(([k, v]) => [k, { count: v.length, saved_tokens: sum(v, "saved_tokens") }])) }, null, 2) + "\n");
    return;
  }
  const hooks = new Map<string, number>();
  for (const r of all.filter((r) => r.kind === "hook")) hooks.set(r.event, (hooks.get(r.event) ?? 0) + 1);
  let s = `offload stats${days ? ` (last ${days} days)` : " (all time)"}\n`;
  s += `  delegations: ${del.length}   est. Claude tokens kept out of context: ${color.bold(color.green(fmtInt(sum(del, "saved_tokens"))))}\n`;
  s += `  worker tokens used: in ${fmtInt(sum(del, "worker_tokens_in"))} / out ${fmtInt(sum(del, "worker_tokens_out"))}\n\n`;
  s += table(
    [...groups].sort().map(([k, v]) => [k, String(v.length), fmtInt(sum(v, "saved_tokens")), String(Math.round((sum(v, "seconds") / v.length) * 10) / 10), String(v.filter((r) => r.model_ok === false).length)]),
    ["kind", "count", "saved≈tok", "avg s", "model-failures"],
  );
  // last 14 days of saved tokens as a sparkline
  const dayOf = (ts: number) => Math.floor(ts / 86400);
  const today = dayOf(Date.now() / 1000);
  const perDay = Array.from({ length: 14 }, (_, i) => sum(del.filter((r) => dayOf(r.ts) === today - 13 + i), "saved_tokens"));
  const max = Math.max(...perDay, 1);
  const bars = "▁▂▃▄▅▆▇█";
  s += `\n  last 14 days  ${color.cyan(perDay.map((v) => (v === 0 ? "·" : bars[Math.min(7, Math.floor((v / max) * 7.999))])).join(""))}  (today ${fmtInt(perDay[13])} tok)\n`;
  s += `\n  hook events: ${[...hooks].map(([k, v]) => `${k}=${v}`).join("  ")}\n`;
  s += `  citations: ${sum(del, "cites_ok")} verified, ${sum(del, "cites_bad")} unverified\n`;
  s += "  (estimates: bytes/4 of what was kept out of context; extra turns and cache effects are not counted)\n";
  process.stdout.write(s);
}

export function cmdConfig(argv: string[]): void {
  const project = argv.includes("--project");
  const args = argv.filter((a) => a !== "--project");
  const sub = args[0] ?? "show";
  const target = project ? projectConfigPath() : userConfigPath();
  switch (sub) {
    case "show":
      process.stdout.write(`# defaults: built in\n# user:     ${userConfigPath()}${existsSync(userConfigPath()) ? "" : " (absent)"}\n# project:  ${projectConfigPath()}${existsSync(projectConfigPath()) ? "" : " (absent)"}\n`);
      {
        const ign = ignoredProjectKeys();
        if (ign.length) process.stdout.write(`# project keys ignored (untrusted repo; \`offload config trust\` to allow): ${ign.join(", ")}\n`);
        // API keys stay out of terminals and logs
        const shown = structuredClone(loadConfig()) as Record<string, any>;
        for (const ep of Object.values<any>(shown.endpoints ?? {})) if (ep && typeof ep === "object" && ep.api_key) ep.api_key = "***";
        process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
      }
      return;
    case "trust": {
      const cur = readConfigFile(userConfigPath());
      const list = Array.isArray(cur.trusted_projects) ? (cur.trusted_projects as string[]) : [];
      const dir = projectDir();
      if (!list.includes(dir)) list.push(dir);
      writeConfigFile(userConfigPath(), { ...cur, trusted_projects: list });
      process.stdout.write(`trusted ${dir}: its .harness-offload.json may now set binaries, endpoints and privacy options\n`);
      return;
    }
    case "path":
      process.stdout.write(target + "\n");
      return;
    case "init":
      if (existsSync(target)) {
        process.stderr.write(`offload: config init: ${target} already exists (edit it, or use: offload config set KEY VALUE)\n`);
        throw new ExitError(2);
      }
      writeConfigFile(target, { models: { default: "", read: "", explore: "", summarize: "", write: "", fallback: [] }, hooks: { read_guard: "block", read_threshold_lines: 600, read_threshold_tokens: 6000, summarize_bash_output: true } });
      process.stdout.write(`wrote ${target} — set models with: offload config set models.default BACKEND:MODEL (see: offload models)\n`);
      return;
    case "set": {
      if (args.length < 3) {
        process.stderr.write("offload: config set KEY VALUE [--project]   e.g. offload config set models.read openrouter:qwen/qwen3-coder\n");
        throw new ExitError(2);
      }
      const file = setConfigValue(args[1], args[2], project);
      process.stdout.write(`set ${args[1]} = ${args[2]} in ${file}\n`);
      return;
    }
    case "get": {
      const v = readConfigFile(target);
      process.stdout.write(JSON.stringify(v, null, 2) + "\n");
      return;
    }
  }
  process.stderr.write(`offload: config: unknown subcommand ${sub} (show|path|init|set|get|trust)\n`);
  throw new ExitError(2);
}

export async function cmdModels(argv: string[]): Promise<void> {
  const names = argv.length ? argv : allBackendNames();
  for (const n of names) {
    const b = backendFor(n);
    if (!b) continue;
    const a = await b.available();
    if (!a.ok) {
      if (argv.length) process.stdout.write(`${color.dim(`# ${n}: ${a.detail}`)}\n`);
      continue;
    }
    if (!b.models) {
      process.stdout.write(`${color.dim(`# ${n}: lists no models; use ${n}:<model-id>`)}\n`);
      continue;
    }
    const ms = await b.models();
    for (const m of ms) process.stdout.write(n === "opencode" ? `${m}\n` : `${n}:${m}\n`);
  }
}

export async function which_(cmd: string) {
  return which(cmd);
}

/** One short line for status bars (Claude Code statusLine, tmux, starship…). */
export function cmdStatusline(): void {
  const now = Math.floor(Date.now() / 1000);
  const since = now - (now % 86400); // UTC day, same as the bash engine
  let rows: Record<string, any>[] = [];
  try {
    rows = readStats().filter((r) => r.kind !== "hook" && r.ts >= since);
  } catch {
    /* no state yet */
  }
  const saved = rows.reduce((s, r) => s + (Number(r.saved_tokens) || 0), 0);
  const k = saved >= 1000 ? `${Math.floor(saved / 100) / 10}k` : String(saved);
  process.stdout.write(`${color.cyan("▌")}offload ${rows.length} · ~${k} saved today\n`);
}
