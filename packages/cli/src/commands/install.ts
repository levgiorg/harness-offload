// `offload install` / `offload uninstall`.
//
// With no agent named it works the way big installers do (rustup, Homebrew,
// Vercel skills, Claude Code's /plugin): it asks which agents and where, shows
// exactly what will change, waits for one "yes", then prints what it did and
// how to check or undo it. Every question has a flag (--agents, --scope, --yes),
// and where it can't ask (no terminal, CI, inside an agent) it never guesses:
// it stops and prints the exact command to run instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECTORS, VERSION } from "../assets.ts";
import { stateDir } from "../state.ts";
import { describe, detectHosts, HOST_LABELS, HOSTS, HostName, install, installedHosts, isHost, PlanItem, PROJECT_SCOPE, Scope, tilde, uninstall } from "../hosts/install.ts";
import { color, sym } from "../ui.ts";

/** Agents `offload install` sets up when it finds them. */
const AUTO: HostName[] = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin"];

/** What each agent gets, for the agent list. */
const KIND: Partial<Record<HostName, string>> = {
  claude: "plugin",
  codex: "plugin + hooks",
  cursor: "local plugin",
  gemini: "extension",
  copilot: "plugin",
  qwen: "extension",
  crush: "hooks in crush.json",
  pi: "package",
  opencode: "plugin file",
  kilo: "plugin file",
  devin: "plugin",
};

interface Flags {
  yes: boolean;
  dry: boolean;
  all: boolean;
  help: boolean;
  scope?: Scope;
  agents?: string[];
  hosts: string[];
  bad?: string;
}

function parse(argv: string[]): Flags {
  const f: Flags = { yes: false, dry: false, all: false, help: false, hosts: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const value = () => inline ?? argv[++i] ?? "";
    if (k === "--yes" || k === "-y") f.yes = true;
    else if (k === "--dry-run") f.dry = true;
    else if (k === "--all") f.all = true;
    else if (k === "--help" || k === "-h") f.help = true;
    else if (k === "--scope") {
      const v = value();
      if (v === "user" || v === "project") f.scope = v;
      else f.bad = `--scope takes user or project (got "${v}")`;
    } else if (k === "--agents" || k === "--agent") f.agents = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("-")) f.bad = `unknown option ${a}`;
    else f.hosts.push(a);
  }
  return f;
}

/** Why we can't ask questions here, if we can't. */
function cannotAsk(): string | undefined {
  const e = process.env;
  if (e.CLAUDECODE === "1" || e.CLAUDE_CODE_ENTRYPOINT) return "running inside Claude Code";
  if (e.CODEX_THREAD_ID || e.CODEX_SANDBOX || e.CODEX_CI) return "running inside Codex";
  if (e.CURSOR_AGENT || e.CURSOR_CONVERSATION_ID) return "running inside Cursor";
  if (e.GEMINI_CLI === "1" || e.GEMINI_SESSION_ID) return "running inside Gemini CLI";
  if (e.COPILOT_CLI === "1") return "running inside Copilot CLI";
  if (e.QWEN_CODE_SESSION_ID || e.QWEN_PROJECT_DIR) return "running inside Qwen Code";
  if (e.CRUSH === "1" || e.CRUSH_SESSION_ID) return "running inside Crush";
  if (e.OPENCODE === "1" || e.OPENCODE_SESSION_ID) return "running inside OpenCode";
  if (e.PI_CODING_AGENT === "1" || e.PI_SESSION_ID) return "running inside Pi";
  if (e.CI && e.CI !== "0" && e.CI !== "false") return "running in CI";
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "no terminal to ask in";
  return undefined;
}

/** How to call us again: `offload` when installed, else through npx. */
async function me(): Promise<string> {
  if (process.env.npm_command === "exec") return "npx harness-offload";
  const { which } = await import("../proc.ts");
  return (await which("offload")) ? "offload" : "npx harness-offload";
}

/** Who will do the reading for this agent: always the agent's own (decision 60). */
async function readerFor(h: HostName): Promise<string> {
  const { workerWords } = await import("../hooks/logic.ts");
  const prev = process.env.OFFLOAD_HOST;
  process.env.OFFLOAD_HOST = h;
  try {
    return workerWords();
  } finally {
    if (prev === undefined) delete process.env.OFFLOAD_HOST;
    else process.env.OFFLOAD_HOST = prev;
  }
}

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - s.length));

export async function cmdInstall(cmd: string, argv: string[]): Promise<number> {
  const f = parse(argv);
  const self = await me();
  if (f.help) return usage(cmd, self, 0);
  if (f.bad) {
    process.stderr.write(`offload: ${f.bad}\n`);
    return usage(cmd, self, 2);
  }
  const named = [...f.hosts, ...(f.agents ?? [])];
  const unknown = named.filter((h) => !isHost(h));
  if (unknown.length) {
    process.stderr.write(`offload: unknown agent ${unknown.join(", ")} — known: ${HOSTS.join(", ")}\n`);
    return 2;
  }
  // `offload install codex` (an agent named as a word): that one, no questions
  if (f.hosts.length) return explicit(cmd, f.hosts as HostName[], f);
  return cmd === "uninstall" ? removeFlow(f, self) : installFlow(f, self);
}

function usage(cmd: string, self: string, code: number): number {
  const w = code ? process.stderr : process.stdout;
  if (cmd === "uninstall") {
    w.write(`usage: ${self} uninstall [--yes] [--agents a,b] [--all] [--dry-run]
  Asks which agents to remove it from, and whether to delete your settings too (no by default).
  --yes            don't ask: every agent it is installed in
  --agents a,b     only these agents
  --all            also delete settings, keys and stats
  --dry-run        show what would be removed
`);
  } else {
    w.write(`usage: ${self} install [--yes] [--agents a,b] [--scope user|project] [--dry-run]
  Asks which agents and where, shows what will change, then installs after you say yes.
  --yes            don't ask: the agents found here (or --agents), for all your projects
  --agents a,b     only these agents (${AUTO.join(", ")})
  --scope project  this project only (Claude Code; the others always go in your home folder)
  --dry-run        show what would change, change nothing
  ${self} install <agent>   one agent, no questions (also: mcp, aider, amp)
`);
  }
  return code;
}

/** The old per-agent form: `offload install claude codex`. */
async function explicit(cmd: string, hosts: HostName[], f: Flags): Promise<number> {
  let failed = 0;
  for (const h of hosts) {
    out(`\n  ${color.bold(HOST_LABELS[h])}`);
    const steps = cmd === "uninstall" ? await uninstall(h) : await install(h, { dryRun: f.dry, scope: f.scope });
    for (const s of steps) {
      out(`  ${s.ok ? sym.ok : sym.bad} ${s.text}`);
      if (!s.ok) failed++;
    }
    // if the harness's own route ever stops working, an API key can take over
    const backup = cmd === "install" ? CONNECTORS.host_api_models?.[h] : undefined;
    if (backup) {
      const name = backup.slice(0, backup.indexOf(":"));
      out(`  ${color.dim(`backup if ${HOST_LABELS[h]}'s own route stops working: offload key ${name} && offload model fallback @host-api @default  (→ ${backup})`)}`);
    }
  }
  out();
  return failed ? 1 : 0;
}

/** The lines of the plan: per agent what happens, where, and who reads. */
async function planLines(items: PlanItem[], readers: Record<string, string>): Promise<string[]> {
  const { checkoutRoot, ownCopyDir } = await import("../hosts/assets.ts");
  const w = Math.max(...items.map((i) => HOST_LABELS[i.host].length), "Offload".length) + 3;
  const lines: string[] = [];
  for (const i of items) {
    lines.push(`${pad(HOST_LABELS[i.host], w)}${i.what}`);
    lines.push(`${" ".repeat(w)}${color.dim(i.where)}`);
    lines.push(`${" ".repeat(w)}${color.dim(`reads with ${readers[i.host]}`)}`);
    if (i.note) lines.push(`${" ".repeat(w)}${color.yellow(i.note)}`);
  }
  if (!checkoutRoot() && !process.env.OFFLOAD_MARKETPLACE_DIR) {
    lines.push(`${pad("Offload", w)}+ ${tilde(ownCopyDir())}/`);
    lines.push(`${" ".repeat(w)}${color.dim("its own copy, so your agents don't depend on the npx cache")}`);
  }
  return lines;
}

async function installFlow(f: Flags, self: string): Promise<number> {
  const found = await detectHosts();
  const here = AUTO.filter((h) => found[h]);
  const missing = AUTO.filter((h) => !found[h]);
  const why = cannotAsk();
  const ask = !f.yes && !f.dry && !why;

  if (!ask && !f.yes && !f.dry) {
    // never guess on someone's behalf: say why, and what to run
    process.stderr.write(`offload: can't ask questions here (${why}).
Say what to install, for example:

  ${self} install --yes
      every agent found on this computer${here.length ? ` (${here.map((h) => HOST_LABELS[h]).join(", ")})` : ""}, for all your projects
  ${self} install --yes --agents claude --scope project
      only Claude Code, only this project

Or run it in a terminal to choose step by step.
`);
    return 2;
  }

  let targets: HostName[];
  if (f.agents) {
    targets = f.agents as HostName[];
    const absent = targets.filter((h) => AUTO.includes(h) && !found[h]);
    if (absent.length) {
      process.stderr.write(`offload: not found on this computer: ${absent.map((h) => HOST_LABELS[h]).join(", ")}. Install it first, or leave it out of --agents.\n`);
      return 1;
    }
  } else targets = here;

  if (!targets.length) {
    const msg = `No supported agent found on this computer. Looked for: ${AUTO.map((h) => HOST_LABELS[h]).join(", ")}.\nInstall one and run this again, or set up any MCP client: ${self} install mcp`;
    if (ask) {
      const p = await import("@clack/prompts");
      p.intro(`Harness Offload ${VERSION}`);
      p.outro(msg);
    } else out(`\n  ${msg.replace("\n", "\n  ")}\n`);
    return 1;
  }

  let scope: Scope = f.scope ?? "user";
  if (ask) {
    const p = await import("@clack/prompts");
    const { which } = await import("../proc.ts");
    p.intro(`Harness Offload ${VERSION}`);
    p.log.step(`Found on this computer: ${here.map((h) => HOST_LABELS[h]).join(", ")}${missing.length ? color.dim(`\nNot found: ${missing.map((h) => HOST_LABELS[h]).join(", ")}`) : ""}`);
    const hints: Record<string, string> = {};
    for (const h of here) {
      const at = await which(h === "cursor" ? "cursor-agent" : h);
      hints[h] = `${KIND[h] ?? ""}${at ? ` · found ${tilde(at)}` : ""}`;
    }
    const chosen = await p.multiselect({
      message: "Install into which agents?  (space selects, enter confirms)",
      options: here.map((h) => ({ value: h, label: HOST_LABELS[h], hint: hints[h] })),
      initialValues: here,
      required: true,
    });
    if (p.isCancel(chosen)) {
      p.cancel("Nothing was changed.");
      return 1;
    }
    targets = chosen as HostName[];
    if (!f.scope && targets.some((h) => PROJECT_SCOPE.includes(h))) {
      const others = targets.filter((h) => !PROJECT_SCOPE.includes(h));
      const s = await p.select({
        message: "For which projects?",
        options: [
          { value: "user", label: "All my projects (recommended)", hint: "goes in your home folder" },
          { value: "project", label: "This project only", hint: `Claude Code: written into ${tilde(process.cwd())}, committed with the repo${others.length ? "; the others still go in your home folder" : ""}` },
        ],
        initialValue: "user",
      });
      if (p.isCancel(s)) {
        p.cancel("Nothing was changed.");
        return 1;
      }
      scope = s as Scope;
    }
  }

  const items = await Promise.all(targets.map((h) => describe(h, scope)));
  const readers: Record<string, string> = {};
  for (const h of targets) readers[h] = await readerFor(h);
  const lines = await planLines(items, readers);
  const undo = `${self} uninstall`;

  if (ask) {
    const p = await import("@clack/prompts");
    p.note([...lines, "", `Nothing else is touched. Undo any time: ${undo}`].join("\n"), "This will change");
    const go = await p.confirm({ message: "Install?", initialValue: true });
    if (p.isCancel(go) || !go) {
      p.cancel("Nothing was changed.");
      return 1;
    }
  } else {
    out(`\nHarness Offload ${VERSION} · ${f.dry ? "dry run, nothing will be written" : "installing without questions (--yes)"}\n`);
    out(f.dry ? "Would change:" : "This will change:");
    for (const l of lines) out(`  ${l}`);
    out();
    if (f.dry) {
      out(`Run without --dry-run to apply.\n`);
      return 0;
    }
  }

  // install, then the receipt: one line per agent, words next to every symbol
  const before = previousVersions();
  let failed = 0;
  const failedHosts: HostName[] = [];
  const receipt: string[] = [];
  const w = Math.max(...targets.map((h) => HOST_LABELS[h].length)) + 2;
  for (const h of targets) {
    // one agent failing (even by throwing) never stops the others
    let steps: Awaited<ReturnType<typeof install>>;
    try {
      steps = await install(h, { scope });
    } catch (e) {
      steps = [{ ok: false, text: String((e as Error)?.message ?? e).split("\n")[0] }];
    }
    const bad = steps.filter((s) => !s.ok);
    if (bad.length) {
      failed++;
      failedHosts.push(h);
      receipt.push(`${sym.bad} ${pad(HOST_LABELS[h], w)}${color.red("not installed:")} ${bad.map((s) => s.text).join("; ")}`);
      continue;
    }
    const was = before[h];
    const verb = was && was !== VERSION ? `updated ${was} → ${VERSION}` : was ? "reinstalled" : "installed";
    receipt.push(`${sym.ok} ${pad(HOST_LABELS[h], w)}${verb}   ${color.dim(`reads with ${readers[h]}`)}`);
    // "restart" notes are covered by the closing line; the rest is the one step left for the person
    for (const n of steps.filter((s) => s.note && !/^restart |^start a new /.test(s.text))) receipt.push(`${sym.warn} ${pad(HOST_LABELS[h], w)}${color.yellow("to do:")} ${n.text}`);
  }
  const end = [
    ...(failed
      ? [
          `${failed} of ${targets.length} not installed (see above).${failed < targets.length ? " The others are installed: restart them to load it." : ""}`,
          `Retry: ${self} install --yes --agents ${failedHosts.join(",")}${scope === "project" ? " --scope project" : ""}`,
        ]
      : ["Done. Restart your agents to load it."]),
    `Check: ${self} doctor`,
    `Undo:  ${undo}`,
  ];
  if (ask) {
    const p = await import("@clack/prompts");
    p.log.message(receipt.join("\n"), { symbol: color.dim("│") });
    p.outro(end.join("\n   "));
  } else {
    for (const r of receipt) out(r);
    out();
    for (const l of end) out(l);
    out();
  }
  return failed ? 1 : 0;
}

/** Versions recorded by earlier installs, to say "updated 0.2.0 → 0.3.0". */
function previousVersions(): Record<string, string> {
  try {
    const all = JSON.parse(readFileSync(join(stateDir(), "installs.json"), "utf8"));
    return Object.fromEntries(Object.entries<any>(all).map(([h, r]) => [h, r?.version ?? "0.2.0"]));
  } catch {
    return {};
  }
}

async function removeFlow(f: Flags, self: string): Promise<number> {
  const { existsSync, rmSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { runProcess, which } = await import("../proc.ts");
  const why = cannotAsk();
  const ask = !f.yes && !f.dry && !why;
  if (!ask && !f.yes && !f.dry) {
    process.stderr.write(`offload: can't ask questions here (${why}).
Say what to remove, for example:

  ${self} uninstall --yes            from every agent it is installed in (keeps your settings)
  ${self} uninstall --yes --all      and delete settings, keys and stats too
  ${self} uninstall --yes --agents codex
`);
    return 2;
  }

  // installed by us, or by hand with /plugin install
  const recorded = installedHosts();
  let installed = [...recorded];
  for (const h of ["claude", "copilot"] as HostName[]) {
    if (installed.includes(h) || !(await which(h))) continue;
    const r = await runProcess(h, ["plugin", "list"], { timeoutMs: 60_000 });
    if (/harness-offload/.test(r.stdout + r.stderr)) installed.push(h);
  }
  if (f.agents) installed = installed.filter((h) => f.agents!.includes(h));

  const { userConfigPath } = await import("../paths.ts");
  const { credentialsPath } = await import("../backends/http.ts");
  const { stateDir } = await import("../state.ts");
  const { ownCopyDir } = await import("../hosts/assets.ts");
  const cacheDir = join(process.env.OFFLOAD_STATE_DIR || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"), "harness-offload"), "cache");
  const personal = [dirname(userConfigPath()), dirname(credentialsPath()), stateDir(), cacheDir].filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
  let all = f.all;
  let targets = installed;

  if (ask) {
    const p = await import("@clack/prompts");
    p.intro(`Harness Offload ${VERSION} · remove`);
    if (!installed.length) {
      p.outro("It isn't installed in any agent.");
      return 0;
    }
    const dates = previousDates();
    const chosen = await p.multiselect({
      message: "Remove it from which agents?",
      options: installed.map((h) => ({ value: h, label: HOST_LABELS[h], hint: dates[h] ? `installed ${dates[h]}` : "installed" })),
      initialValues: installed,
      required: true,
    });
    if (p.isCancel(chosen)) {
      p.cancel("Nothing was changed.");
      return 1;
    }
    targets = chosen as HostName[];
    if (!f.all && personal.length) {
      const del = await p.confirm({ message: `Also delete your settings, keys and stats? (${personal.map(tilde).join(", ")})`, initialValue: false });
      if (p.isCancel(del)) {
        p.cancel("Nothing was changed.");
        return 1;
      }
      all = Boolean(del);
    }
    p.note([...targets.map((h) => `${HOST_LABELS[h]}`), ...(all ? personal.map((d) => `${tilde(d)}/`) : [])].join("\n"), "This will remove");
    const go = await p.confirm({ message: "Remove?", initialValue: true });
    if (p.isCancel(go) || !go) {
      p.cancel("Nothing was changed.");
      return 1;
    }
  } else {
    out();
    if (!installed.length) out("Harness Offload is not installed in any agent.");
    else out(`${f.dry ? "Would remove" : "Removing"} Harness Offload from: ${targets.map((h) => HOST_LABELS[h]).join(", ")}`);
    if (all && personal.length) out(`${f.dry ? "Would delete" : "And deleting"}: ${personal.map(tilde).join(", ")}`);
    if (f.dry) {
      out();
      return 0;
    }
  }

  let failed = 0;
  const receipt: string[] = [];
  for (const h of targets) {
    const bad = (await uninstall(h)).filter((s) => !s.ok);
    if (bad.length) failed++;
    receipt.push(`${bad.length ? sym.bad : sym.ok} ${pad(HOST_LABELS[h], 22)}${bad.length ? color.red("not removed: ") + bad.map((s) => s.text).join("; ") : "removed"}`);
  }
  // offload's own copy exists only for the agents: gone once none is left
  if (!installedHosts().length && existsSync(ownCopyDir())) {
    rmSync(ownCopyDir(), { recursive: true, force: true });
    receipt.push(`${sym.ok} ${pad("Offload's own copy", 22)}removed`);
  }
  if (all) {
    for (const d of personal) {
      rmSync(d, { recursive: true, force: true });
      receipt.push(`${sym.ok} ${pad(tilde(d), 22)}deleted`);
    }
  }
  const end: string[] = [];
  if (!all && personal.length) end.push(`Kept your settings, keys and stats. Delete them too: ${self} uninstall --all`);
  if (self === "offload" && (await which("harness-offload"))) end.push("The offload command itself: npm uninstall -g harness-offload");
  if (ask) {
    const p = await import("@clack/prompts");
    p.log.message(receipt.join("\n"), { symbol: color.dim("│") });
    p.outro(end.length ? end.join("\n   ") : "Done.");
  } else {
    for (const r of receipt) out(r);
    if (end.length) out("\n" + end.join("\n"));
    out();
  }
  return failed ? 1 : 0;
}

function previousDates(): Record<string, string> {
  try {
    const all = JSON.parse(readFileSync(join(stateDir(), "installs.json"), "utf8"));
    return Object.fromEntries(Object.entries<any>(all).filter(([, r]) => r?.at).map(([h, r]) => [h, r.at]));
  } catch {
    return {};
  }
}

export async function cmdSync(argv: string[]): Promise<number> {
  const dry = argv.includes("--dry-run");
  const installed = installedHosts();
  const detected = await detectHosts();
  if (!installed.length) process.stdout.write(`\n  nothing installed yet — run ${color.cyan("offload setup")} or ${color.cyan("offload install <host>")}\n`);
  let failed = 0;
  for (const h of installed) {
    process.stdout.write(`\n  ${color.bold(HOST_LABELS[h])} ${color.dim("(refresh)")}\n`);
    for (const st of await install(h, { dryRun: dry })) {
      process.stdout.write(`  ${st.ok ? sym.ok : sym.bad} ${st.text}\n`);
      if (!st.ok) failed++;
    }
  }
  const missing = HOSTS.filter((h) => h !== "mcp" && detected[h] && !installed.includes(h));
  if (missing.length) process.stdout.write(`\n  ${sym.warn} detected but not wired up: ${missing.map((h) => HOST_LABELS[h]).join(", ")} → ${color.cyan(`offload install ${missing.join(" ")}`)}\n`);
  process.stdout.write("\n");
  return failed ? 1 : 0;
}
