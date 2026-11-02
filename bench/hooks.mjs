#!/usr/bin/env node
// Hook latency benchmark: how long each offload hook keeps a harness waiting
// before (or after) a tool call, for both engines, against spawn baselines.
//
//   node bench/hooks.mjs [--runs N] [--warmup N] [--engine bash|ts|both] [--only NAME,...]
//                        [--json FILE] [--markdown] [--budget-ms N]
//
// Every scenario runs the real hook script (bash engine) or `node cli.js hook
// claude EVENT` (TypeScript engine, the path Codex, Cursor, Gemini and the
// other hosts use) with a Claude-format payload, in an isolated HOME/config/
// state, with the offline stub worker. Each run's output is checked (pass,
// deny, note, digest) so a fast wrong answer can't pass as a fast hook.
// --budget-ms N exits 1 when the median of a scenario that lets the tool call
// through (the path nearly every call takes) exceeds N ms. CI uses it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const PLUGIN = join(ROOT, "plugins", "harness-offload");
const CLI = process.env.OFFLOAD_BENCH_CLI || join(PLUGIN, "dist", "cli.js");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const RUNS = Number(opt("--runs", 25));
const WARMUP = Number(opt("--warmup", 3));
const ENGINE = opt("--engine", "both");
const ONLY = opt("--only", "") ? opt("--only", "").split(",") : null;
const JSON_OUT = opt("--json", "");
const BUDGET = opt("--budget-ms", "") ? Number(opt("--budget-ms", "")) : null;

// ---- isolated workspace
const W = mkdtempSync(join(tmpdir(), "offload-bench-"));
const P = join(W, "project");
mkdirSync(P, { recursive: true });
mkdirSync(join(W, "home"), { recursive: true });
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";
writeFileSync(join(P, "small.ts"), lines(80, (i) => `export const v${i} = ${i};`));
writeFileSync(join(P, "big.ts"), lines(5000, (i) => (i % 50 === 1 ? `export function section${i}(a: number): number {` : i % 50 === 0 ? "}" : `  const x${i} = a + ${i}; // padding line ${i}`)));
const smallOut = lines(20, (i) => `ok ${i}`);
const bigOut = lines(3000, (i) => (i % 400 === 0 ? `ERROR test_${i} failed: expected 1, got 2` : `PASS test_${i} (${i % 7} ms)`));

const baseEnv = {
  PATH: process.env.PATH,
  HOME: join(W, "home"),
  XDG_CONFIG_HOME: join(W, "cfg"),
  XDG_STATE_HOME: join(W, "state-home"),
  OFFLOAD_STATE_DIR: join(W, "state"),
  OFFLOAD_CONFIG: join(W, "config.json"),
  OFFLOAD_OPENCODE_BIN: join(PLUGIN, "tests", "stub-opencode"),
  OFFLOAD_MODEL: "stub/ok",
  STUB_VERSION: "1.19.5",
  CLAUDE_PLUGIN_ROOT: PLUGIN,
  CLAUDE_PROJECT_DIR: P,
  LANG: "C.UTF-8",
};

const ev = (event, extra) => JSON.stringify({ session_id: "bench", transcript_path: join(W, "t.jsonl"), cwd: P, hook_event_name: event, ...extra });
const read = (file, more = {}) => ev("PreToolUse", { tool_name: "Read", tool_input: { file_path: join(P, file), ...more } });
const bash = (command) => ev("PreToolUse", { tool_name: "Bash", tool_input: { command, description: "bench" } });
const post = (command, stdout) => ev("PostToolUse", { tool_name: "Bash", tool_input: { command, description: "bench" }, tool_response: { stdout, stderr: "", interrupted: false, isImage: false } });

// name, hook event (bash script / ts event), payload, expected outcome, extra env, uses a model?
const SCENARIOS = [
  ["session-start", "session-start", ev("SessionStart", { source: "startup" }), "note", {}, false],
  ["read: small file (pass)", "pre-read", read("small.ts"), "pass", {}, false],
  ["read: big file (deny + outline)", "pre-read", read("big.ts"), "deny", {}, false],
  ["read: big file slice (pass)", "pre-read", read("big.ts", { offset: 100, limit: 200 }), "pass", {}, false],
  ["bash: ls (pass)", "pre-bash", bash("ls -la"), "pass", {}, false],
  ["bash: cat big file (deny)", "pre-bash", bash("cat big.ts"), "deny", {}, false],
  ["post-bash: short output (pass)", "post-bash", post("npm test", smallOut), "pass", {}, false],
  ["post-bash: long output, no model", "post-bash", post("npm test", bigOut), "digest", { OFFLOAD_NO_MODEL: "1" }, false],
  ["post-bash: long output, stub model", "post-bash", post("npm test", bigOut), "digest", {}, true],
  ["disabled: read small (pass)", "pre-read", read("small.ts"), "pass", { OFFLOAD_DISABLE: "1" }, false],
  ["disabled: bash ls (pass)", "pre-bash", bash("ls -la"), "pass", { OFFLOAD_DISABLE: "1" }, false],
  ["disabled: post-bash short (pass)", "post-bash", post("npm test", smallOut), "pass", { OFFLOAD_DISABLE: "1" }, false],
  ["no backend: read big (pass)", "pre-read", read("big.ts"), "pass", { OFFLOAD_OPENCODE_BIN: join(W, "missing-opencode") }, false],
];

function classify(out) {
  const s = out.trim();
  if (!s) return "pass";
  let j;
  try {
    j = JSON.parse(s.split("\n").pop());
  } catch {
    return "garbage";
  }
  const h = j.hookSpecificOutput || {};
  if (h.permissionDecision === "deny" || j.decision === "deny") return "deny";
  if (h.updatedToolOutput || j.modifiedResult) return "digest";
  if (h.additionalContext || j.systemMessage || j.additionalContext) return "note";
  return "other";
}

// bash: the hook script itself; ts: the launcher every other host calls
// (bin/offload-ts → node dist/hook.cjs), unless OFFLOAD_BENCH_CLI names a CLI
function command(engine, event) {
  if (engine === "bash") return [join(PLUGIN, "hooks", event), []];
  if (process.env.OFFLOAD_BENCH_CLI) return [process.execPath, [CLI, "hook", "claude", event]];
  return [join(PLUGIN, "bin", "offload-ts"), ["hook", "claude", event]];
}

function time(cmd, argv, input, env) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, argv, { input, env, cwd: P, encoding: "utf8", maxBuffer: 64 << 20 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, out: r.stdout || "", err: r.stderr || "", status: r.status };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { median: q(0.5), p90: q(0.9), min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length, runs: s.length };
}

function bench(label, cmd, argv, input, env, expect) {
  for (let i = 0; i < WARMUP; i++) time(cmd, argv, input, env);
  const ms = [];
  let bad = "";
  for (let i = 0; i < RUNS; i++) {
    const r = time(cmd, argv, input, env);
    ms.push(r.ms);
    if (expect) {
      const got = classify(r.out);
      if (got !== expect && !bad) bad = `expected ${expect}, got ${got}${r.err ? ` (stderr: ${r.err.trim().split("\n").pop()})` : ""}`;
    }
  }
  return { label, ...stats(ms), error: bad || undefined };
}

const results = { machine: { cpus: cpus().length, model: cpus()[0]?.model, node: process.version, platform: process.platform }, runs: RUNS, baselines: [], hooks: [] };

// ---- baselines: what any hook costs before it does anything
const which = (b) => spawnSync("sh", ["-c", `command -v ${b}`], { encoding: "utf8" }).stdout.trim();
const baselines = [
  ["spawn `true`", which("true"), []],
  ["bash -c :", which("bash"), ["-c", ":"]],
  ["jq -n 1 (one jq call)", which("jq"), ["-n", "1"]],
  ["node -e 0", process.execPath, ["-e", "0"]],
  ["node cli.js --version", process.execPath, [CLI, "--version"]],
];
for (const [label, cmd, argv] of baselines) if (cmd) results.baselines.push(bench(label, cmd, argv, "", baseEnv));

const engines = ENGINE === "both" ? ["bash", "ts"] : [ENGINE];
for (const [name, event, input, expect, extra, model] of SCENARIOS) {
  if (ONLY && !ONLY.some((o) => name.includes(o))) continue;
  for (const engine of engines) {
    const [cmd, argv] = command(engine, event);
    const env = { ...baseEnv, ...extra };
    rmSync(join(W, "state"), { recursive: true, force: true });
    results.hooks.push({ scenario: name, engine, model, expect, ...bench(`${engine}: ${name}`, cmd, argv, input, env, expect) });
  }
}

// ---- report
const f = (x) => x.toFixed(1).padStart(7);
const out = [];
out.push(`machine: ${results.machine.cpus}× ${results.machine.model} · node ${results.machine.node} · ${RUNS} runs + ${WARMUP} warm-up per row`);
out.push("");
out.push("| baseline | median ms | p90 ms |");
out.push("|---|---:|---:|");
for (const b of results.baselines) out.push(`| ${b.label} | ${f(b.median)} | ${f(b.p90)} |`);
out.push("");
out.push(`| scenario | ${engines.map((e) => `${e} median | ${e} p90`).join(" | ")} |`);
out.push(`|---|${engines.map(() => "---:|---:").join("|")}|`);
const names = [...new Set(results.hooks.map((h) => h.scenario))];
let failed = false;
for (const n of names) {
  const cells = engines.map((e) => {
    const h = results.hooks.find((x) => x.scenario === n && x.engine === e);
    if (!h) return " | ";
    if (h.error) failed = true;
    const flag = h.error ? " ✗" : "";
    return `${f(h.median)}${flag} | ${f(h.p90)}`;
  });
  out.push(`| ${n} | ${cells.join(" | ")} |`);
}
const errs = results.hooks.filter((h) => h.error);
if (errs.length) {
  out.push("");
  for (const e of errs) out.push(`✗ ${e.engine}: ${e.scenario}: ${e.error}`);
}
let over = [];
if (BUDGET !== null) {
  over = results.hooks.filter((h) => h.expect === "pass" && h.median > BUDGET);
  out.push("");
  out.push(over.length ? `over the ${BUDGET} ms budget: ${over.map((h) => `${h.engine}: ${h.scenario} (${h.median.toFixed(1)} ms)`).join("; ")}` : `every pass-through hook is under the ${BUDGET} ms budget`);
}
console.log(out.join("\n"));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2) + "\n");
rmSync(W, { recursive: true, force: true });
process.exit(failed || over.length ? 1 : 0);
