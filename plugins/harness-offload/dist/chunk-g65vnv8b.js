import {
  which2,
  ExitError2
} from "./chunk-yrbt2j5y.js";
import {
  userConfigPath2,
  projectConfigPath2,
  loadConfig2,
  getPath2,
  cfg2,
  cfgStr2,
  writeConfigKey2
} from "./chunk-fprvy154.js";
import {
  PRESETS2,
  endpoint2,
  apiKey2
} from "./chunk-rh4zgg1b.js";
import {
  E
} from "./chunk-t783jg2c.js";
import {
  CLI_AGENTS,
  detectHost,
  hostModel,
  hostApiModel
} from "./chunk-hc19sd6m.js";
import"./chunk-20nw982y.js";
import"./chunk-7pg52q8v.js";
import"./chunk-6npywwhf.js";
import {
  taskNames
} from "./chunk-x3bqkf9c.js";

// src/commands/model.ts
var SLOTS = ["default", "read", "summarize", "explore", "write", "ask", "fallback"];
var AGENTS = ["claude", "codex", "gemini", "cursor", "pi", "copilot", "qwen", "crush"].filter((a) => (a in CLI_AGENTS));
var die = (m) => {
  process.stderr.write(`offload: ${m}
`);
  throw new ExitError2(E.USAGE);
};
function knownBackends() {
  const own = Object.keys(cfg2("endpoints") ?? {}).sort();
  return [...new Set(["opencode", ...AGENTS, ...Object.keys(PRESETS2).sort(), ...own])];
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0;j <= b.length; j++)
    d[0][j] = j;
  for (let i = 1;i <= a.length; i++)
    for (let j = 1;j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function didYouMean(w) {
  let best;
  let bs = Infinity;
  for (const k of knownBackends()) {
    const s = lev(w, k);
    if (s < bs)
      [best, bs] = [k, s];
  }
  return bs <= 2 ? best : undefined;
}
var isAgent = (b) => b === "opencode" || AGENTS.includes(b);
async function refCheck(ref) {
  const def = cfgStr2("backend", "opencode");
  if (ref === "@host" || ref === "@self") {
    const h = detectHost();
    const m = h ? hostModel(h) : undefined;
    return { note: h && m ? `${m} via ${h}'s own plan` : "your harness's own model (resolved when a harness calls offload)" };
  }
  if (ref === "@host-api") {
    const h = detectHost();
    if (!h)
      return { note: "your harness's model through an API key (resolved when a harness calls offload)" };
    const m = hostApiModel(h);
    if (!m || m.startsWith("@"))
      return { note: `${h} has no API-key backup; this entry is skipped` };
    const ep = endpoint2(m.slice(0, m.indexOf(":")));
    const key = !ep || /127\.0\.0\.1|localhost/.test(ep.base_url) || apiKey2(ep);
    return { note: key ? `${m} via ${h}'s API key` : `${m} via ${h}'s API key; warning: no key yet (offload key ${ep.name})` };
  }
  if (ref === "@default")
    return { note: `${def}'s default model` };
  if (!ref)
    return { err: "give a model reference, e.g. groq:llama-3.3-70b, claude:haiku or @host" };
  let backend = def;
  let model = ref;
  const i = ref.indexOf(":");
  if (i >= 0 && !ref.slice(0, i).includes("/")) {
    const prefix = ref.slice(0, i);
    if (isAgent(prefix) || endpoint2(prefix))
      [backend, model] = [prefix, ref.slice(i + 1)];
    else {
      const near = didYouMean(prefix);
      return { err: `unknown backend "${prefix}" in ${ref}${near ? ` — did you mean ${near}:${ref.slice(i + 1)}?` : ""} (backends: ${knownBackends().join(", ")})` };
    }
  }
  if (backend === "opencode") {
    if (model && !model.includes("/")) {
      if (AGENTS.includes(model) || endpoint2(model))
        return { err: `"${model}" is a backend — write ${model}:MODEL (offload models ${model} lists them)` };
      return { err: `"${ref}" is not a model reference — write BACKEND:MODEL (e.g. openrouter:qwen/qwen3-coder), provider/model for OpenCode, or @host` };
    }
    const ok = await which2(cfgStr2("opencode.bin", "opencode"));
    return { note: ok ? "OpenCode" : "OpenCode; warning: opencode is not installed" };
  }
  if (AGENTS.includes(backend)) {
    const bin = cfgStr2(`agents.${backend}.bin`, CLI_AGENTS[backend].bin);
    const note = model ? `${backend} CLI` : `${backend} CLI, its default model`;
    return { note: await which2(bin) ? note : `${note}; warning: ${bin} is not installed` };
  }
  const ep = endpoint2(backend);
  if (!model)
    return { err: `${backend} needs a model id, e.g. ${backend}:MODEL (offload models ${backend} lists them)` };
  const note = ep.label || backend;
  return { note: !apiKey2(ep) && ep.api_key_env ? `${note}; warning: no API key (export ${ep.api_key_env} or run offload setup)` : note };
}
function exploreProblem(ref) {
  let r = ref;
  if (r === "@host" || r === "@self") {
    const h = detectHost();
    r = h && hostModel(h) || "";
  }
  const i = r.indexOf(":");
  const backend = i > 0 && !r.slice(0, i).includes("/") ? r.slice(0, i) : "";
  return backend && AGENTS.includes(backend) ? CLI_AGENTS[backend].noExplore : undefined;
}
var exploreWarning = (ref) => {
  const p = exploreProblem(ref);
  return p ? `; warning: ${p} — explore uses the next model in the chain (set one: offload model explore claude:haiku, or another CLI or provider)` : "";
};
function slotKey(slot) {
  if (SLOTS.includes(slot))
    return `models.${slot}`;
  if (/^[a-z0-9_][a-z0-9_-]*$/.test(slot) && cfg2(`tasks.${slot}`) !== undefined)
    return `tasks.${slot}.model`;
  return;
}
var pad = (s) => s.padEnd(18);
var shown = (v) => Array.isArray(v) ? v.join(", ") : String(v ?? "");
async function line(slot, key) {
  const label = key.startsWith("tasks.") ? `task ${slot}` : slot;
  const raw = getPath2(loadConfig2(), key);
  if (slot === "fallback") {
    const v = Array.isArray(raw) ? raw.join(", ") : "";
    return `  ${pad(label)} ${v || "(none)"}
`;
  }
  let v = typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw);
  if (!v) {
    if (slot !== "default")
      return `  ${pad(label)} (default)
`;
    v = "@default";
  }
  const r = await refCheck(v);
  const explores = slot === "explore" || slot === "default" && !cfgStr2("models.explore");
  return `  ${pad(label)} ${v} — ${r.err ? `error: ${r.err}` : r.note + (explores ? exploreWarning(v) : "")}
`;
}
function badSlot(w) {
  if (isAgent(w))
    die(`model: "${w}" is a backend — write ${w}: for its default model or ${w}:MODEL`);
  if (endpoint2(w))
    die(`model: "${w}" is a backend — write ${w}:MODEL (offload models ${w} lists them)`);
  return die(`model: "${w}" is neither a task (default, read, summarize, explore, write, ask, fallback, or one of offload tasks) nor a model reference (BACKEND:MODEL, provider/model, @host)`);
}
async function cmdModel(argv) {
  let project = false;
  let reset = false;
  const args = [];
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project")
      project = true;
    else if (a === "--reset")
      reset = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(`offload model [TASK] [REF...] [--reset] [--project]
`);
      return 0;
    } else if (a === "--")
      args.push(...argv.slice(i + 1)), i = argv.length;
    else if (a.startsWith("-"))
      die(`model: unknown option ${a}`);
    else
      args.push(a);
  }
  const target = project ? projectConfigPath2() : userConfigPath2();
  let slot = "";
  let key = "";
  let refs = [];
  if (args.length) {
    const k = slotKey(args[0]);
    if (k)
      [slot, key, refs] = [args[0], k, args.slice(1)];
    else if (/[:/@]/.test(args[0]) && args.length === 1 && !reset)
      [slot, key, refs] = ["default", "models.default", [args[0]]];
    else
      badSlot(args[0]);
  }
  const out = (s) => process.stdout.write(s);
  if (reset) {
    if (refs.length)
      die("model: --reset takes no model");
    if (!slot)
      [slot, key] = ["default", "models.default"];
    try {
      writeConfigKey2(key, undefined, project);
    } catch (e) {
      die(`model: ${e.message}`);
    }
    out(`✓ ${key} reset in ${target}
`);
    out(await line(slot, key));
    return 0;
  }
  if (!refs.length) {
    if (slot) {
      out(await line(slot, key));
      return 0;
    }
    out(`Models (change: offload model [TASK] REF · undo: offload model [TASK] --reset · --project for this repo):
`);
    for (const s of SLOTS)
      out(await line(s, `models.${s}`));
    for (const n of taskNames())
      out(await line(n, `tasks.${n}.model`));
    out(`References: @host (your harness's own plan) · BACKEND:MODEL · provider/model (OpenCode). List models: offload models BACKEND
`);
    return 0;
  }
  if (slot !== "fallback" && refs.length !== 1)
    die("model: give one model (only fallback takes several)");
  let notes = "";
  for (const r of refs) {
    const c = await refCheck(r);
    if (c.err)
      die(`model: ${c.err} (to store it anyway: offload config set ${key} VALUE)`);
    const explores = slot === "explore" || slot === "default" && !cfgStr2("models.explore");
    notes += `  ${r} — ${c.note}${explores ? exploreWarning(r) : ""}
`;
  }
  const val = slot === "fallback" ? refs : refs[0];
  try {
    writeConfigKey2(key, val, project);
  } catch (e) {
    die(`model: ${e.message}`);
  }
  out(`✓ ${key} = ${shown(val)}
${notes}  saved in ${target} · try it: offload doctor --ping
`);
  const eff = getPath2(loadConfig2(), key);
  if (JSON.stringify(eff) !== JSON.stringify(val))
    out(`  note: another config file overrides this (in effect: ${shown(eff)}); use --project to change this repo's setting
`);
  return 0;
}
export {
  cmdModel,
  refCheck
};
