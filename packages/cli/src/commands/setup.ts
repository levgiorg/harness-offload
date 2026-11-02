// `offload setup` — the interactive wizard (and a --yes mode for scripts).
// Detects agent harnesses and worker backends, asks which backends to use
// (OpenCode subscriptions, other agent CLIs, API keys, local models), picks
// models per task, sets the read guard, installs host integrations and runs
// a live test.
import * as p from "@clack/prompts";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { list, parseFlags, str } from "../args.ts";
import { Task } from "../assets.ts";
import { readConfigFile, resetConfig, writeConfigFile } from "../config.ts";
import { credentialsPath, endpoint, PRESETS } from "../backends/http.ts";
import { CLI_AGENTS } from "../backends/agents.ts";
import { backendFor, detectHost } from "../backends/registry.ts";
import { CONNECTORS } from "../assets.ts";
import { invoke } from "../engine.ts";
import { detectHosts, HOST_LABELS, HOSTS, HostName, install, isHost } from "../hosts/install.ts";
import { projectConfigPath, userConfigPath } from "../paths.ts";
import { workDir } from "../state.ts";
import { banner, color } from "../ui.ts";

const HOST_MODELS = CONNECTORS.host_models as Record<string, string>;
const HOST_API = CONNECTORS.host_api_models as Record<string, string>;

interface BackendInfo {
  name: string;
  label: string;
  ready: boolean;
  detail: string;
  kind: "opencode" | "agent" | "http";
  local?: boolean;
}

async function detectBackends(): Promise<BackendInfo[]> {
  const out: BackendInfo[] = [];
  const oc = backendFor("opencode")!;
  const a = await oc.available();
  out.push({ name: "opencode", label: "OpenCode (Zen/Go, ChatGPT, Copilot, coding plans, local…)", ready: a.ok, detail: a.detail, kind: "opencode" });
  for (const name of Object.keys(CLI_AGENTS)) {
    const b = backendFor(name)!;
    const av = await b.available();
    out.push({ name, label: b.label, ready: av.ok, detail: av.detail, kind: "agent" });
  }
  for (const name of Object.keys(PRESETS)) {
    const ep = endpoint(name)!;
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
      const av = await backendFor(name)!.available();
      ready = av.ok;
      detail = av.ok ? "API key found" : `needs ${ep.api_key_env ?? "an API key"}`;
    }
    out.push({ name, label: ep.label ?? name, ready, detail, kind: "http", local });
  }
  return out;
}

function storeKey(name: string, key: string): void {
  const f = credentialsPath();
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    /* new file */
  }
  all[name] = key;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* windows */
  }
}

async function modelsFor(b: BackendInfo): Promise<string[]> {
  const backend = backendFor(b.name);
  if (!backend?.models) return [];
  try {
    const ms = await backend.models();
    return ms.map((m) => (b.kind === "opencode" ? m : `${b.name}:${m}`));
  } catch {
    return [];
  }
}

const CHEAP = /(flash|mini|lite|luna|haiku|nano|small|8b|7b|turbo|fast|air|tiny)/i;
const CODER = /(coder|code|codex|devstral|kimi|qwen3|glm|deepseek)/i;
function rank(models: string[], prefer: RegExp): string[] {
  return [...models].sort((x, y) => Number(prefer.test(y)) - Number(prefer.test(x)) || x.localeCompare(y));
}

function bail<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) {
    p.cancel("Setup cancelled — nothing was changed.");
    process.exit(0);
  }
  return v as Exclude<T, symbol>;
}

async function pickModel(message: string, candidates: string[], initial?: string): Promise<string> {
  if (!candidates.length) {
    return bail(await p.text({ message: `${message} (BACKEND:MODEL, or provider/model for OpenCode)`, placeholder: "openrouter:qwen/qwen3-coder", initialValue: initial ?? "", validate: (v) => (v && v.trim() ? undefined : "required") }));
  }
  const manual = "__manual__";
  const options = [...candidates.slice(0, 400).map((m) => ({ value: m, label: m })), { value: manual, label: "type another model id…" }];
  const v = bail(await p.autocomplete({ message, options, initialValue: initial && candidates.includes(initial) ? initial : candidates[0], maxItems: 12, placeholder: "type to filter" }));
  if (v === manual) return bail(await p.text({ message: "Model id", placeholder: "openrouter:qwen/qwen3-coder" }));
  return v as string;
}

function writeSettings(target: string, models: Partial<Record<Task | "default", string>>, fallback: string[], guard: string): void {
  const cur = readConfigFile(target);
  const m = (cur.models as Record<string, unknown>) ?? {};
  cur.models = { ...m, ...models, fallback };
  cur.hooks = { ...((cur.hooks as Record<string, unknown>) ?? {}), read_guard: guard };
  writeConfigFile(target, cur);
}

async function nonInteractive(opts: Record<string, unknown>): Promise<number> {
  // default: the calling harness's own plan (claude:haiku in Claude Code, …)
  const model = str(opts.model) || "@host";
  // --api-backup: an API key takes over when the harness's own route fails
  const fallback = [...(opts["api-backup"] ? ["@host-api"] : []), ...list(opts.fallback)];
  for (const kv of list(opts.key)) {
    const i = kv.indexOf("=");
    if (i > 0) storeKey(kv.slice(0, i), kv.slice(i + 1));
  }
  const target = opts.project ? projectConfigPath() : userConfigPath();
  writeSettings(target, { default: model }, fallback, str(opts.guard) || "block");
  process.stdout.write(`wrote ${target}\n`);
  let failed = 0;
  for (const h of str(opts.hosts).split(",").filter(Boolean) as HostName[]) {
    if (!isHost(h)) continue;
    for (const s of await install(h)) {
      process.stdout.write(`${s.ok ? "✓" : "✗"} ${s.text}\n`);
      if (!s.ok) failed++;
    }
  }
  return failed ? 1 : 0;
}

export async function cmdSetup(argv: string[]): Promise<number> {
  const { opts } = parseFlags(argv, { yes: { alias: ["-y"] }, model: { alias: ["-m"], value: true }, fallback: { value: true, multi: true }, hosts: { value: true }, key: { value: true, multi: true }, guard: { value: true }, project: {}, "api-backup": {} });
  if (opts.yes || !process.stdin.isTTY || !process.stdout.isTTY) return nonInteractive(opts);

  process.stdout.write(banner("setup"));
  p.intro(color.bold("Let's set up Harness Offload"));
  const s = p.spinner();
  s.start("Looking for agent harnesses and worker backends");
  const [hosts, backends] = await Promise.all([detectHosts(), detectBackends()]);
  s.stop("Scan complete");

  const foundHosts = HOSTS.filter((h) => hosts[h] && h !== "mcp");
  p.note(
    [
      `${color.bold("Agent harnesses")}: ${foundHosts.length ? foundHosts.map((h) => HOST_LABELS[h]).join(", ") : "none detected"}`,
      `${color.bold("Ready worker backends")}: ${backends.filter((b) => b.ready).map((b) => b.name).join(", ") || "none yet"}`,
    ].join("\n"),
    "Found",
  );

  // 1. Same subscription as the harness, or other backends?
  const agentNames = Object.keys(CLI_AGENTS);
  const readyAgents = backends.filter((b) => b.kind === "agent" && b.ready).map((b) => b.name);
  const hostLine = foundHosts
    .map((h) => [h, HOST_MODELS[h]] as const)
    .filter(([, m]) => m)
    .map(([h, m]) => `${HOST_LABELS[h as HostName]} ${color.dim("→")} ${m}`)
    .join(", ");
  const apiLine = foundHosts
    .filter((h) => HOST_API[h])
    .map((h) => `${HOST_LABELS[h]} ${color.dim("→")} ${HOST_API[h]}`)
    .join(", ");
  const mode = bail(
    await p.select({
      message: "Who should do the cheap work?",
      options: [
        { value: "host", label: "My agent's own subscription (@host)", hint: hostLine || "Claude Code → claude:haiku, Codex → codex:gpt-6-luna, Gemini CLI → gemini:flash-lite" },
        { value: "host+", label: "My agent's own subscription + a fallback from another backend", hint: "used when the plan hits a usage limit" },
        { value: "api", label: "My agent's model family through an API key (@host-api)", hint: apiLine || "Claude Code → anthropic:claude-haiku-5-5, Codex → openai:gpt-6-luna — pay per use" },
        { value: "pick", label: "Backends I choose", hint: "OpenCode Zen/Go, ChatGPT/Codex, API keys, local models…" },
      ],
      initialValue: readyAgents.length || foundHosts.length ? "host" : "pick",
    }),
  ) as string;
  if (mode === "api") {
    p.note(
      [
        "Each harness calls the same model family through your own API key",
        "(e.g. Claude Code → anthropic:claude-haiku-5-5, Codex → openai:gpt-6-luna).",
        "Pay per use, separate from your plan; nothing depends on the harness's CLI.",
      ].join("\n"),
      "@host-api — an API key",
    );
  } else if (mode !== "pick") {
    p.note(
      [
        "Each harness delegates to a small, fast model on the plan you already pay for",
        "(e.g. Claude Code → Haiku via `claude -p`, Codex → gpt-6-luna via `codex exec`).",
        "",
        `${color.bold("What you save")}: the big files, logs and searches never enter your main`,
        "session's context, so it stays short, fast and cheap to continue.",
        `${color.bold("What it costs")}: worker calls count toward the same plan's usage limits,`,
        "at the small model's rate. Add a fallback if you hit limits often.",
      ].join("\n"),
      "@host — your agent's own plan",
    );
  }

  // An API key as the backup (or the main route): if the harness's own CLI
  // route stops working — headless use blocked, logged out, plan limits —
  // the same model family answers through the key instead.
  let backupHosts: string[] = [];
  if (mode !== "pick") {
    const withApi = (foundHosts.length ? foundHosts : (["claude", "codex", "gemini"] as HostName[])).filter((h) => HOST_API[h]);
    if (withApi.length && mode === "api") backupHosts = withApi;
    else if (withApi.length) {
      const want = bail(await p.confirm({ message: "Add an API key as a backup, in case your agent's own route stops working (headless use blocked, logged out, plan limits)?", initialValue: false }));
      if (want) {
        backupHosts = bail(
          await p.multiselect({
            message: "Backup for which harnesses? (space to toggle)",
            options: withApi.map((h) => ({ value: h, label: `${HOST_LABELS[h]} ${color.dim("→")} ${HOST_API[h]}`, hint: "pay per use, only when the plan route fails" })),
            initialValues: withApi,
            required: true,
          }),
        ) as string[];
      }
    }
    const needKey = [...new Set(backupHosts.map((h) => HOST_API[h].slice(0, HOST_API[h].indexOf(":"))))].filter((n) => !backends.find((x) => x.name === n)?.ready);
    if (needKey.length) p.log.info(`Keys are saved to ${credentialsPath()} (only you can read it). Press Enter to skip one: set its env var later, or run ${color.cyan("offload key NAME")}.`);
    for (const name of needKey) {
      const b = backends.find((x) => x.name === name);
      if (!b) continue;
      const key = bail(await p.password({ message: `API key for ${b.label} (Enter to skip)` }));
      if (key) storeKey(name, key);
      else p.log.warn(`${b.label}: no key yet — the backup is skipped until one is there (offload key ${name})`);
    }
  }

  let chosen: string[] = [];
  if (mode !== "host" && mode !== "api") {
    chosen = bail(
      await p.multiselect({
        message: mode === "pick" ? "Which worker backends should do the cheap work? (space to toggle)" : "Which backend for the fallback? (space to toggle)",
        options: backends.map((b) => ({ value: b.name, label: b.label, hint: b.ready ? color.green(b.detail || "ready") : b.detail })),
        initialValues: backends.filter((b) => b.ready && (!agentNames.includes(b.name) || b.name === "opencode")).map((b) => b.name).slice(0, mode === "pick" ? 3 : 1),
        required: true,
      }),
    ) as string[];
  }

  for (const name of chosen) {
    const b = backends.find((x) => x.name === name)!;
    if (b.kind === "http" && !b.ready && !b.local) {
      const key = bail(await p.password({ message: `API key for ${b.label} (saved to ${credentialsPath()}, mode 600; empty = use $${endpoint(name)?.api_key_env ?? "ENV"})` }));
      if (key) storeKey(name, key);
    }
    if (b.kind === "agent" && !b.ready) p.log.warn(`${b.label}: ${b.detail}`);
  }
  resetConfig();

  const candidates: string[] = [];
  if (chosen.length) {
    s.start("Fetching model lists");
    for (const name of chosen) candidates.push(...(await modelsFor(backends.find((x) => x.name === name)!)));
    s.stop(`${candidates.length} models available`);
  }

  let readModel = "@host";
  let exploreModel = "@host";
  let writeModel = "@host";
  let fallback: string[] = [];
  if (mode === "pick") {
    readModel = await pickModel("Model for reading & digesting (fast, cheap, long context)", rank(candidates, CHEAP));
    const sameExplore = bail(await p.confirm({ message: "Use the same model for codebase exploration?", initialValue: true }));
    exploreModel = sameExplore ? readModel : await pickModel("Model for exploration (good at tool calling)", rank(candidates, CHEAP));
    writeModel = await pickModel("Model for writing boilerplate/tests (best cheap coder)", rank(candidates, CODER), readModel);
    const backendOf = (m: string) => (m.includes(":") ? m.split(":")[0] : "opencode");
    const others = candidates.filter((m) => backendOf(m) !== backendOf(readModel));
    if (others.length) {
      const fb = bail(await p.select({ message: "Fallback model from a different backend (used when the first hits a quota wall)", options: [{ value: "", label: "no fallback" }, ...rank(others, CHEAP).slice(0, 60).map((m) => ({ value: m, label: m }))] }));
      if (fb) fallback = [fb as string];
    }
  } else if (mode === "host+") {
    fallback = [await pickModel("Fallback model (used when your plan hits a usage limit)", rank(candidates, CHEAP))];
  } else if (mode === "api") {
    readModel = exploreModel = writeModel = "@host-api";
  }
  if (mode !== "api" && mode !== "pick" && backupHosts.length) fallback = ["@host-api", ...fallback];

  const guard = bail(
    await p.select({
      message: "When the agent tries to read a huge file in one go…",
      options: [
        { value: "block", label: "Block it and show an outline + options", hint: "recommended" },
        { value: "suggest", label: "Allow it, but suggest offload next time" },
        { value: "ask", label: "Ask me each time" },
        { value: "off", label: "Do nothing (tools only)" },
      ],
      initialValue: "block",
    }),
  ) as string;

  const scope = bail(await p.select({ message: "Save these settings for…", options: [{ value: "user", label: "all my projects", hint: userConfigPath() }, { value: "project", label: "this project only", hint: projectConfigPath() }] }));
  const target = scope === "project" ? projectConfigPath() : userConfigPath();
  const models: Partial<Record<Task | "default", string>> = { default: readModel, read: readModel, summarize: readModel, explore: exploreModel, write: writeModel, ask: readModel };
  writeSettings(target, models, fallback, guard);
  p.log.success(`Saved ${target}`);

  const installable = HOSTS.filter((h) => h !== "mcp");
  const which = bail(
    await p.multiselect({
      message: "Install the integration into…",
      options: [...installable.map((h) => ({ value: h, label: HOST_LABELS[h], hint: hosts[h] ? "detected" : "not found" })), { value: "mcp", label: HOST_LABELS.mcp, hint: "prints the config" }],
      initialValues: foundHosts,
      required: false,
    }),
  ) as HostName[];
  for (const h of which) {
    s.start(`Installing for ${HOST_LABELS[h]}`);
    const steps = await install(h);
    s.stop(`${HOST_LABELS[h]}`);
    for (const st of steps) (st.ok ? p.log.success : p.log.error)(st.text);
  }

  if (bail(await p.confirm({ message: "Run a live test (one tiny request per model)?", initialValue: true }))) {
    // @host resolves to the harness running this shell (if any); hooks and MCP set it per harness
    for (const ref of [...new Set([readModel, exploreModel, writeModel, ...fallback])].filter((r) => (r !== "@host" && r !== "@host-api") || detectHost())) {
      s.start(`Pinging ${ref}`);
      try {
        const r = await invoke("ask" as Task, "Reply with exactly the word: pong\n", workDir(), ref);
        s.stop(`${color.green("✓")} ${ref} → ${r.text.trim().slice(0, 30)} (${r.seconds}s)`);
      } catch (e) {
        s.stop(`${color.red("✗")} ${ref} → ${String((e as Error).message).split("\n").slice(0, 2).join(" ").slice(0, 160)}`);
      }
    }
  }
  p.outro(`Done. Try ${color.cyan('offload read -q "what does this do?" <big-file>')} — and ${color.cyan("offload doctor")} any time.`);
  return 0;
}
