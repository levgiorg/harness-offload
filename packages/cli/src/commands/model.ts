// `offload model [TASK] [REF...] [--reset] [--project]` — show, change or undo
// which model does the work, with the reference checked first (unknown
// backend, missing model id, typos) and a warning when it cannot run here
// (CLI not installed, no API key). No model call. Twin: cmd_model in bash.
import { getPath, loadConfig, cfg, cfgStr, writeConfigKey, type Json } from "../config.ts";
import { projectConfigPath, userConfigPath } from "../paths.ts";
import { apiKey, endpoint, PRESETS } from "../backends/http.ts";
import { CLI_AGENTS } from "../backends/agents.ts";
import { detectHost, hostApiModel, hostModel } from "../backends/registry.ts";
import { which } from "../proc.ts";
import { taskNames } from "../tasks.ts";
import { E } from "../backends/types.ts";
import { ExitError } from "./core.ts";

const SLOTS = ["default", "read", "summarize", "explore", "write", "ask", "fallback"];
const AGENTS = ["claude", "codex", "gemini", "cursor", "pi", "copilot", "qwen", "crush"].filter((a) => a in CLI_AGENTS);

const die = (m: string): never => {
  process.stderr.write(`offload: ${m}\n`);
  throw new ExitError(E.USAGE);
};

function knownBackends(): string[] {
  const own = Object.keys((cfg("endpoints") as Record<string, unknown>) ?? {}).sort();
  return [...new Set(["opencode", ...AGENTS, ...Object.keys(PRESETS).sort(), ...own])];
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest known backend within two edits, for "did you mean". */
function didYouMean(w: string): string | undefined {
  let best: string | undefined;
  let bs = Infinity;
  for (const k of knownBackends()) {
    const s = lev(w, k);
    if (s < bs) [best, bs] = [k, s];
  }
  return bs <= 2 ? best : undefined;
}

const isAgent = (b: string) => b === "opencode" || AGENTS.includes(b);

/** { note } when the reference is usable (maybe with a warning), { err } when not. */
export async function refCheck(ref: string): Promise<{ note?: string; err?: string }> {
  const def = cfgStr("backend", "opencode");
  if (ref === "@host" || ref === "@self") {
    const h = detectHost();
    const m = h ? hostModel(h) : undefined;
    return { note: h && m ? `${m} via ${h}'s own plan` : "your harness's own model (resolved when a harness calls offload)" };
  }
  if (ref === "@host-api") {
    const h = detectHost();
    if (!h) return { note: "your harness's model through an API key (resolved when a harness calls offload)" };
    const m = hostApiModel(h);
    if (!m || m.startsWith("@")) return { note: `${h} has no API-key backup; this entry is skipped` };
    const ep = endpoint(m.slice(0, m.indexOf(":")));
    const key = !ep || /127\.0\.0\.1|localhost/.test(ep.base_url) || apiKey(ep);
    return { note: key ? `${m} via ${h}'s API key` : `${m} via ${h}'s API key; warning: no key yet (offload key ${ep!.name})` };
  }
  if (ref === "@default") return { note: `${def}'s default model` };
  if (!ref) return { err: "give a model reference, e.g. groq:llama-3.3-70b, claude:haiku or @host" };
  let backend = def;
  let model = ref;
  const i = ref.indexOf(":");
  if (i >= 0 && !ref.slice(0, i).includes("/")) {
    const prefix = ref.slice(0, i);
    if (isAgent(prefix) || endpoint(prefix)) [backend, model] = [prefix, ref.slice(i + 1)];
    else {
      const near = didYouMean(prefix);
      return { err: `unknown backend "${prefix}" in ${ref}${near ? ` — did you mean ${near}:${ref.slice(i + 1)}?` : ""} (backends: ${knownBackends().join(", ")})` };
    }
  }
  if (backend === "opencode") {
    if (model && !model.includes("/")) {
      if (AGENTS.includes(model) || endpoint(model)) return { err: `"${model}" is a backend — write ${model}:MODEL (offload models ${model} lists them)` };
      return { err: `"${ref}" is not a model reference — write BACKEND:MODEL (e.g. openrouter:qwen/qwen3-coder), provider/model for OpenCode, or @host` };
    }
    const ok = await which(cfgStr("opencode.bin", "opencode"));
    return { note: ok ? "OpenCode" : "OpenCode; warning: opencode is not installed" };
  }
  if (AGENTS.includes(backend)) {
    const bin = cfgStr(`agents.${backend}.bin`, CLI_AGENTS[backend].bin);
    const note = model ? `${backend} CLI` : `${backend} CLI, its default model`;
    return { note: (await which(bin)) ? note : `${note}; warning: ${bin} is not installed` };
  }
  const ep = endpoint(backend)!;
  if (!model) return { err: `${backend} needs a model id, e.g. ${backend}:MODEL (offload models ${backend} lists them)` };
  const note = ep.label || backend;
  return { note: !apiKey(ep) && ep.api_key_env ? `${note}; warning: no API key (export ${ep.api_key_env} or run offload setup)` : note };
}

/** Why REF can't do explore (read-only tool use), or undefined. @host is resolved for the
 *  calling harness. Explore then falls to the next model in the chain. */
export function exploreProblem(ref: string): string | undefined {
  let r = ref;
  if (r === "@host" || r === "@self") {
    const h = detectHost();
    r = (h && hostModel(h)) || "";
  }
  const i = r.indexOf(":");
  const backend = i > 0 && !r.slice(0, i).includes("/") ? r.slice(0, i) : "";
  return backend && AGENTS.includes(backend) ? CLI_AGENTS[backend].noExplore : undefined;
}
const exploreWarning = (ref: string) => {
  const p = exploreProblem(ref);
  return p ? `; warning: ${p} — explore uses the next model in the chain (set one: offload model explore claude:haiku, or another CLI or provider)` : "";
};

function slotKey(slot: string): string | undefined {
  if (SLOTS.includes(slot)) return `models.${slot}`;
  if (/^[a-z0-9_][a-z0-9_-]*$/.test(slot) && cfg(`tasks.${slot}`) !== undefined) return `tasks.${slot}.model`;
  return undefined;
}

const pad = (s: string) => s.padEnd(18);
const shown = (v: Json | undefined) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));

async function line(slot: string, key: string): Promise<string> {
  const label = key.startsWith("tasks.") ? `task ${slot}` : slot;
  const raw = getPath(loadConfig(), key);
  if (slot === "fallback") {
    const v = Array.isArray(raw) ? raw.join(", ") : "";
    return `  ${pad(label)} ${v || "(none)"}\n`;
  }
  let v = typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw);
  if (!v) {
    if (slot !== "default") return `  ${pad(label)} (default)\n`;
    v = "@default";
  }
  const r = await refCheck(v);
  const explores = slot === "explore" || (slot === "default" && !cfgStr("models.explore"));
  return `  ${pad(label)} ${v} — ${r.err ? `error: ${r.err}` : r.note + (explores ? exploreWarning(v) : "")}\n`;
}

function badSlot(w: string): never {
  if (isAgent(w)) die(`model: "${w}" is a backend — write ${w}: for its default model or ${w}:MODEL`);
  if (endpoint(w)) die(`model: "${w}" is a backend — write ${w}:MODEL (offload models ${w} lists them)`);
  return die(`model: "${w}" is neither a task (default, read, summarize, explore, write, ask, fallback, or one of offload tasks) nor a model reference (BACKEND:MODEL, provider/model, @host)`);
}

export async function cmdModel(argv: string[]): Promise<number> {
  let project = false;
  let reset = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = true;
    else if (a === "--reset") reset = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write("offload model [TASK] [REF...] [--reset] [--project]\n");
      return 0;
    } else if (a === "--") args.push(...argv.slice(i + 1)), (i = argv.length);
    else if (a.startsWith("-")) die(`model: unknown option ${a}`);
    else args.push(a);
  }
  const target = project ? projectConfigPath() : userConfigPath();
  let slot = "";
  let key = "";
  let refs: string[] = [];
  if (args.length) {
    const k = slotKey(args[0]);
    if (k) [slot, key, refs] = [args[0], k, args.slice(1)];
    else if (/[:/@]/.test(args[0]) && args.length === 1 && !reset) [slot, key, refs] = ["default", "models.default", [args[0]]];
    else badSlot(args[0]);
  }
  const out = (s: string) => process.stdout.write(s);
  if (reset) {
    if (refs.length) die("model: --reset takes no model");
    if (!slot) [slot, key] = ["default", "models.default"];
    try {
      writeConfigKey(key, undefined, project);
    } catch (e) {
      die(`model: ${(e as Error).message}`);
    }
    out(`✓ ${key} reset in ${target}\n`);
    out(await line(slot, key));
    return 0;
  }
  if (!refs.length) {
    if (slot) {
      out(await line(slot, key));
      return 0;
    }
    out("Models (change: offload model [TASK] REF · undo: offload model [TASK] --reset · --project for this repo):\n");
    for (const s of SLOTS) out(await line(s, `models.${s}`));
    for (const n of taskNames()) out(await line(n, `tasks.${n}.model`));
    out("References: @host (your harness's own plan) · BACKEND:MODEL · provider/model (OpenCode). List models: offload models BACKEND\n");
    return 0;
  }
  if (slot !== "fallback" && refs.length !== 1) die("model: give one model (only fallback takes several)");
  let notes = "";
  for (const r of refs) {
    const c = await refCheck(r);
    if (c.err) die(`model: ${c.err} (to store it anyway: offload config set ${key} VALUE)`);
    const explores = slot === "explore" || (slot === "default" && !cfgStr("models.explore"));
    notes += `  ${r} — ${c.note}${explores ? exploreWarning(r) : ""}\n`;
  }
  const val: Json = slot === "fallback" ? refs : refs[0];
  try {
    writeConfigKey(key, val, project);
  } catch (e) {
    die(`model: ${(e as Error).message}`);
  }
  out(`✓ ${key} = ${shown(val)}\n${notes}  saved in ${target} · try it: offload doctor --ping\n`);
  const eff = getPath(loadConfig(), key);
  if (JSON.stringify(eff) !== JSON.stringify(val)) out(`  note: another config file overrides this (in effect: ${shown(eff)}); use --project to change this repo's setting\n`);
  return 0;
}
