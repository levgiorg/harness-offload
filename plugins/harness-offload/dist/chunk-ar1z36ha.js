import {
  isCancel2,
  autocomplete2,
  confirm2,
  multiselect2,
  log2,
  cancel2,
  intro2,
  outro2,
  note2,
  password2,
  spinner2,
  select2,
  text2
} from "./chunk-bhydkp8n.js";
import {
  CONNECTORS,
  parseFlags,
  str,
  list,
  color,
  banner
} from "./chunk-31bdmre5.js";
import {
  userConfigPath2,
  projectConfigPath2,
  resetConfig2,
  writeConfigFile2,
  readConfigFile2
} from "./chunk-t2kssrkb.js";
import {
  PRESETS2,
  credentialsPath2,
  endpoint2
} from "./chunk-ay6k04v0.js";
import {
  workDir2
} from "./chunk-9wbe25j8.js";
import {
  CLI_AGENTS,
  detectHost,
  backendFor
} from "./chunk-fsknd7zt.js";
import {
  invoke2
} from "./chunk-w1fzxj4r.js";
import {
  HOSTS,
  isHost,
  HOST_LABELS,
  detectHosts,
  install
} from "./chunk-cpk7ekvv.js";

// src/commands/setup.ts
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var HOST_MODELS = CONNECTORS.host_models;
var HOST_API = CONNECTORS.host_api_models;
async function detectBackends() {
  const out = [];
  const oc = backendFor("opencode");
  const a = await oc.available();
  out.push({ name: "opencode", label: "OpenCode (Zen/Go, ChatGPT, Copilot, coding plans, local…)", ready: a.ok, detail: a.detail, kind: "opencode" });
  for (const name of Object.keys(CLI_AGENTS)) {
    const b = backendFor(name);
    const av = await b.available();
    out.push({ name, label: b.label, ready: av.ok, detail: av.detail, kind: "agent" });
  }
  for (const name of Object.keys(PRESETS2)) {
    const ep = endpoint2(name);
    const local = /127\.0\.0\.1|localhost/.test(ep.base_url);
    let ready = false;
    let detail = "";
    if (local) {
      try {
        const r = await fetch(`${ep.base_url}/models`, { signal: AbortSignal.timeout(800) });
        ready = r.ok;
        detail = ready ? `running at ${ep.base_url}` : "not running";
      } catch {
        detail = "not running";
      }
    } else {
      const av = await backendFor(name).available();
      ready = av.ok;
      detail = av.ok ? "API key found" : `needs ${ep.api_key_env ?? "an API key"}`;
    }
    out.push({ name, label: ep.label ?? name, ready, detail, kind: "http", local });
  }
  return out;
}
function storeKey(name, key) {
  const f = credentialsPath2();
  let all = {};
  try {
    all = JSON.parse(readFileSync(f, "utf8"));
  } catch {}
  all[name] = key;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2) + `
`, { mode: 384 });
  try {
    chmodSync(f, 384);
  } catch {}
}
async function modelsFor(b) {
  const backend = backendFor(b.name);
  if (!backend?.models)
    return [];
  try {
    const ms = await backend.models();
    return ms.map((m) => b.kind === "opencode" ? m : `${b.name}:${m}`);
  } catch {
    return [];
  }
}
var CHEAP = /(flash|mini|lite|luna|haiku|nano|small|8b|7b|turbo|fast|air|tiny)/i;
var CODER = /(coder|code|codex|devstral|kimi|qwen3|glm|deepseek)/i;
function rank(models, prefer) {
  return [...models].sort((x, y) => Number(prefer.test(y)) - Number(prefer.test(x)) || x.localeCompare(y));
}
function bail(v) {
  if (isCancel2(v)) {
    cancel2("Setup cancelled — nothing was changed.");
    process.exit(0);
  }
  return v;
}
async function pickModel(message, candidates, initial) {
  if (!candidates.length) {
    return bail(await text2({ message: `${message} (BACKEND:MODEL, or provider/model for OpenCode)`, placeholder: "openrouter:qwen/qwen3-coder", initialValue: initial ?? "", validate: (v) => v && v.trim() ? undefined : "required" }));
  }
  const manual = "__manual__";
  const options = [...candidates.slice(0, 400).map((m) => ({ value: m, label: m })), { value: manual, label: "type another model id…" }];
  const v = bail(await autocomplete2({ message, options, initialValue: initial && candidates.includes(initial) ? initial : candidates[0], maxItems: 12, placeholder: "type to filter" }));
  if (v === manual)
    return bail(await text2({ message: "Model id", placeholder: "openrouter:qwen/qwen3-coder" }));
  return v;
}
function writeSettings(target, models, fallback, guard) {
  const cur = readConfigFile2(target);
  const m = cur.models ?? {};
  cur.models = { ...m, ...models, fallback };
  cur.hooks = { ...cur.hooks ?? {}, read_guard: guard };
  writeConfigFile2(target, cur);
}
async function nonInteractive(opts) {
  const model = str(opts.model) || "@host";
  const fallback = [...opts["api-backup"] ? ["@host-api"] : [], ...list(opts.fallback)];
  for (const kv of list(opts.key)) {
    const i = kv.indexOf("=");
    if (i > 0)
      storeKey(kv.slice(0, i), kv.slice(i + 1));
  }
  const target = opts.project ? projectConfigPath2() : userConfigPath2();
  writeSettings(target, { default: model }, fallback, str(opts.guard) || "block");
  process.stdout.write(`wrote ${target}
`);
  let failed = 0;
  for (const h of str(opts.hosts).split(",").filter(Boolean)) {
    if (!isHost(h))
      continue;
    for (const s of await install(h)) {
      process.stdout.write(`${s.ok ? "✓" : "✗"} ${s.text}
`);
      if (!s.ok)
        failed++;
    }
  }
  return failed ? 1 : 0;
}
async function cmdSetup(argv) {
  const { opts } = parseFlags(argv, { yes: { alias: ["-y"] }, model: { alias: ["-m"], value: true }, fallback: { value: true, multi: true }, hosts: { value: true }, key: { value: true, multi: true }, guard: { value: true }, project: {}, "api-backup": {} });
  if (opts.yes || !process.stdin.isTTY || !process.stdout.isTTY)
    return nonInteractive(opts);
  process.stdout.write(banner("setup"));
  intro2(color.bold("Let's set up Harness Offload"));
  const s = spinner2();
  s.start("Looking for agent harnesses and worker backends");
  const [hosts, backends] = await Promise.all([detectHosts(), detectBackends()]);
  s.stop("Scan complete");
  const foundHosts = HOSTS.filter((h) => hosts[h] && h !== "mcp");
  note2([
    `${color.bold("Agent harnesses")}: ${foundHosts.length ? foundHosts.map((h) => HOST_LABELS[h]).join(", ") : "none detected"}`,
    `${color.bold("Ready worker backends")}: ${backends.filter((b) => b.ready).map((b) => b.name).join(", ") || "none yet"}`
  ].join(`
`), "Found");
  const agentNames = Object.keys(CLI_AGENTS);
  const readyAgents = backends.filter((b) => b.kind === "agent" && b.ready).map((b) => b.name);
  const hostLine = foundHosts.map((h) => [h, HOST_MODELS[h]]).filter(([, m]) => m).map(([h, m]) => `${HOST_LABELS[h]} ${color.dim("→")} ${m}`).join(", ");
  const apiLine = foundHosts.filter((h) => HOST_API[h]).map((h) => `${HOST_LABELS[h]} ${color.dim("→")} ${HOST_API[h]}`).join(", ");
  const mode = bail(await select2({
    message: "Who should do the cheap work?",
    options: [
      { value: "host", label: "My agent's own subscription (@host)", hint: hostLine || "Claude Code → claude:haiku, Codex → codex:gpt-6-luna, Gemini CLI → gemini:flash-lite" },
      { value: "host+", label: "My agent's own subscription + a fallback from another backend", hint: "used when the plan hits a usage limit" },
      { value: "api", label: "My agent's model family through an API key (@host-api)", hint: apiLine || "Claude Code → anthropic:claude-haiku-5-5, Codex → openai:gpt-6-luna — pay per use" },
      { value: "pick", label: "Backends I choose", hint: "OpenCode Zen/Go, ChatGPT/Codex, API keys, local models…" }
    ],
    initialValue: readyAgents.length || foundHosts.length ? "host" : "pick"
  }));
  if (mode === "api") {
    note2([
      "Each harness calls the same model family through your own API key",
      "(e.g. Claude Code → anthropic:claude-haiku-5-5, Codex → openai:gpt-6-luna).",
      "Pay per use, separate from your plan; nothing depends on the harness's CLI."
    ].join(`
`), "@host-api — an API key");
  } else if (mode !== "pick") {
    note2([
      "Each harness delegates to a small, fast model on the plan you already pay for",
      "(e.g. Claude Code → Haiku via `claude -p`, Codex → gpt-6-luna via `codex exec`).",
      "",
      `${color.bold("What you save")}: the big files, logs and searches never enter your main`,
      "session's context, so it stays short, fast and cheap to continue.",
      `${color.bold("What it costs")}: worker calls count toward the same plan's usage limits,`,
      "at the small model's rate. Add a fallback if you hit limits often."
    ].join(`
`), "@host — your agent's own plan");
  }
  let backupHosts = [];
  if (mode !== "pick") {
    const withApi = (foundHosts.length ? foundHosts : ["claude", "codex", "gemini"]).filter((h) => HOST_API[h]);
    if (withApi.length && mode === "api")
      backupHosts = withApi;
    else if (withApi.length) {
      const want = bail(await confirm2({ message: "Add an API key as a backup, in case your agent's own route stops working (headless use blocked, logged out, plan limits)?", initialValue: false }));
      if (want) {
        backupHosts = bail(await multiselect2({
          message: "Backup for which harnesses? (space to toggle)",
          options: withApi.map((h) => ({ value: h, label: `${HOST_LABELS[h]} ${color.dim("→")} ${HOST_API[h]}`, hint: "pay per use, only when the plan route fails" })),
          initialValues: withApi,
          required: true
        }));
      }
    }
    const needKey = [...new Set(backupHosts.map((h) => HOST_API[h].slice(0, HOST_API[h].indexOf(":"))))].filter((n) => !backends.find((x) => x.name === n)?.ready);
    if (needKey.length)
      log2.info(`Keys are saved to ${credentialsPath2()} (only you can read it). Press Enter to skip one: set its env var later, or run ${color.cyan("offload key NAME")}.`);
    for (const name of needKey) {
      const b = backends.find((x) => x.name === name);
      if (!b)
        continue;
      const key = bail(await password2({ message: `API key for ${b.label} (Enter to skip)` }));
      if (key)
        storeKey(name, key);
      else
        log2.warn(`${b.label}: no key yet — the backup is skipped until one is there (offload key ${name})`);
    }
  }
  let chosen = [];
  if (mode !== "host" && mode !== "api") {
    chosen = bail(await multiselect2({
      message: mode === "pick" ? "Which worker backends should do the cheap work? (space to toggle)" : "Which backend for the fallback? (space to toggle)",
      options: backends.map((b) => ({ value: b.name, label: b.label, hint: b.ready ? color.green(b.detail || "ready") : b.detail })),
      initialValues: backends.filter((b) => b.ready && (!agentNames.includes(b.name) || b.name === "opencode")).map((b) => b.name).slice(0, mode === "pick" ? 3 : 1),
      required: true
    }));
  }
  for (const name of chosen) {
    const b = backends.find((x) => x.name === name);
    if (b.kind === "http" && !b.ready && !b.local) {
      const key = bail(await password2({ message: `API key for ${b.label} (saved to ${credentialsPath2()}, mode 600; empty = use $${endpoint2(name)?.api_key_env ?? "ENV"})` }));
      if (key)
        storeKey(name, key);
    }
    if (b.kind === "agent" && !b.ready)
      log2.warn(`${b.label}: ${b.detail}`);
  }
  resetConfig2();
  const candidates = [];
  if (chosen.length) {
    s.start("Fetching model lists");
    for (const name of chosen)
      candidates.push(...await modelsFor(backends.find((x) => x.name === name)));
    s.stop(`${candidates.length} models available`);
  }
  let readModel = "@host";
  let exploreModel = "@host";
  let writeModel = "@host";
  let fallback = [];
  if (mode === "pick") {
    readModel = await pickModel("Model for reading & digesting (fast, cheap, long context)", rank(candidates, CHEAP));
    const sameExplore = bail(await confirm2({ message: "Use the same model for codebase exploration?", initialValue: true }));
    exploreModel = sameExplore ? readModel : await pickModel("Model for exploration (good at tool calling)", rank(candidates, CHEAP));
    writeModel = await pickModel("Model for writing boilerplate/tests (best cheap coder)", rank(candidates, CODER), readModel);
    const backendOf = (m) => m.includes(":") ? m.split(":")[0] : "opencode";
    const others = candidates.filter((m) => backendOf(m) !== backendOf(readModel));
    if (others.length) {
      const fb = bail(await select2({ message: "Fallback model from a different backend (used when the first hits a quota wall)", options: [{ value: "", label: "no fallback" }, ...rank(others, CHEAP).slice(0, 60).map((m) => ({ value: m, label: m }))] }));
      if (fb)
        fallback = [fb];
    }
  } else if (mode === "host+") {
    fallback = [await pickModel("Fallback model (used when your plan hits a usage limit)", rank(candidates, CHEAP))];
  } else if (mode === "api") {
    readModel = exploreModel = writeModel = "@host-api";
  }
  if (mode !== "api" && mode !== "pick" && backupHosts.length)
    fallback = ["@host-api", ...fallback];
  const guard = bail(await select2({
    message: "When the agent tries to read a huge file in one go…",
    options: [
      { value: "block", label: "Block it and show an outline + options", hint: "recommended" },
      { value: "suggest", label: "Allow it, but suggest offload next time" },
      { value: "ask", label: "Ask me each time" },
      { value: "off", label: "Do nothing (tools only)" }
    ],
    initialValue: "block"
  }));
  const scope = bail(await select2({ message: "Save these settings for…", options: [{ value: "user", label: "all my projects", hint: userConfigPath2() }, { value: "project", label: "this project only", hint: projectConfigPath2() }] }));
  const target = scope === "project" ? projectConfigPath2() : userConfigPath2();
  const models = { default: readModel, read: readModel, summarize: readModel, explore: exploreModel, write: writeModel, ask: readModel };
  writeSettings(target, models, fallback, guard);
  log2.success(`Saved ${target}`);
  const installable = HOSTS.filter((h) => h !== "mcp");
  const which = bail(await multiselect2({
    message: "Install the integration into…",
    options: [...installable.map((h) => ({ value: h, label: HOST_LABELS[h], hint: hosts[h] ? "detected" : "not found" })), { value: "mcp", label: HOST_LABELS.mcp, hint: "prints the config" }],
    initialValues: foundHosts,
    required: false
  }));
  for (const h of which) {
    s.start(`Installing for ${HOST_LABELS[h]}`);
    const steps = await install(h);
    s.stop(`${HOST_LABELS[h]}`);
    for (const st of steps)
      (st.ok ? log2.success : log2.error)(st.text);
  }
  if (bail(await confirm2({ message: "Run a live test (one tiny request per model)?", initialValue: true }))) {
    for (const ref of [...new Set([readModel, exploreModel, writeModel, ...fallback])].filter((r) => r !== "@host" && r !== "@host-api" || detectHost())) {
      s.start(`Pinging ${ref}`);
      try {
        const r = await invoke2("ask", `Reply with exactly the word: pong
`, workDir2(), ref);
        s.stop(`${color.green("✓")} ${ref} → ${r.text.trim().slice(0, 30)} (${r.seconds}s)`);
      } catch (e) {
        s.stop(`${color.red("✗")} ${ref} → ${String(e.message).split(`
`).slice(0, 2).join(" ").slice(0, 160)}`);
      }
    }
  }
  outro2(`Done. Try ${color.cyan('offload read -q "what does this do?" <big-file>')} — and ${color.cyan("offload doctor")} any time.`);
  return 0;
}
export {
  cmdSetup
};
