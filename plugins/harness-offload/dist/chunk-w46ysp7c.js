import {
  CONNECTORS,
  VERSION,
  color,
  sym
} from "./chunk-25ca7170.js";
import"./chunk-djerf2vs.js";
import {
  stateDir2
} from "./chunk-d1jn8t5x.js";
import {
  HOSTS,
  isHost,
  HOST_LABELS,
  tilde,
  detectHosts,
  PROJECT_SCOPE,
  install,
  uninstall,
  installedHosts,
  describe
} from "./chunk-7abztbby.js";

// src/commands/install.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var AUTO = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin"];
var KIND = {
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
  devin: "plugin"
};
function parse(argv) {
  const f = { yes: false, dry: false, all: false, help: false, hosts: [] };
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const value = () => inline ?? argv[++i] ?? "";
    if (k === "--yes" || k === "-y")
      f.yes = true;
    else if (k === "--dry-run")
      f.dry = true;
    else if (k === "--all")
      f.all = true;
    else if (k === "--help" || k === "-h")
      f.help = true;
    else if (k === "--scope") {
      const v = value();
      if (v === "user" || v === "project")
        f.scope = v;
      else
        f.bad = `--scope takes user or project (got "${v}")`;
    } else if (k === "--agents" || k === "--agent")
      f.agents = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("-"))
      f.bad = `unknown option ${a}`;
    else
      f.hosts.push(a);
  }
  return f;
}
function cannotAsk() {
  const e = process.env;
  if (e.CLAUDECODE === "1" || e.CLAUDE_CODE_ENTRYPOINT)
    return "running inside Claude Code";
  if (e.CODEX_THREAD_ID || e.CODEX_SANDBOX || e.CODEX_CI)
    return "running inside Codex";
  if (e.CURSOR_AGENT || e.CURSOR_CONVERSATION_ID)
    return "running inside Cursor";
  if (e.GEMINI_CLI === "1" || e.GEMINI_SESSION_ID)
    return "running inside Gemini CLI";
  if (e.COPILOT_CLI === "1")
    return "running inside Copilot CLI";
  if (e.QWEN_CODE_SESSION_ID || e.QWEN_PROJECT_DIR)
    return "running inside Qwen Code";
  if (e.CRUSH === "1" || e.CRUSH_SESSION_ID)
    return "running inside Crush";
  if (e.OPENCODE === "1" || e.OPENCODE_SESSION_ID)
    return "running inside OpenCode";
  if (e.PI_CODING_AGENT === "1" || e.PI_SESSION_ID)
    return "running inside Pi";
  if (e.CI && e.CI !== "0" && e.CI !== "false")
    return "running in CI";
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return "no terminal to ask in";
  return;
}
async function me() {
  if (process.env.npm_command === "exec")
    return "npx harness-offload";
  const { which } = await import("./chunk-8z9g0eky.js");
  return await which("offload") ? "offload" : "npx harness-offload";
}
async function readerFor(h) {
  const { workerWords } = await import("./chunk-dmw5qgta.js");
  const prev = process.env.OFFLOAD_HOST;
  process.env.OFFLOAD_HOST = h;
  try {
    return workerWords();
  } finally {
    if (prev === undefined)
      delete process.env.OFFLOAD_HOST;
    else
      process.env.OFFLOAD_HOST = prev;
  }
}
var out = (s = "") => process.stdout.write(s + `
`);
var pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
async function cmdInstall(cmd, argv) {
  const f = parse(argv);
  const self = await me();
  if (f.help)
    return usage(cmd, self, 0);
  if (f.bad) {
    process.stderr.write(`offload: ${f.bad}
`);
    return usage(cmd, self, 2);
  }
  const named = [...f.hosts, ...f.agents ?? []];
  const unknown = named.filter((h) => !isHost(h));
  if (unknown.length) {
    process.stderr.write(`offload: unknown agent ${unknown.join(", ")} — known: ${HOSTS.join(", ")}
`);
    return 2;
  }
  if (f.hosts.length)
    return explicit(cmd, f.hosts, f);
  return cmd === "uninstall" ? removeFlow(f, self) : installFlow(f, self);
}
function usage(cmd, self, code) {
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
async function explicit(cmd, hosts, f) {
  let failed = 0;
  for (const h of hosts) {
    out(`
  ${color.bold(HOST_LABELS[h])}`);
    const steps = cmd === "uninstall" ? await uninstall(h) : await install(h, { dryRun: f.dry, scope: f.scope });
    for (const s of steps) {
      out(`  ${s.ok ? sym.ok : sym.bad} ${s.text}`);
      if (!s.ok)
        failed++;
    }
    const backup = cmd === "install" ? CONNECTORS.host_api_models?.[h] : undefined;
    if (backup) {
      const name = backup.slice(0, backup.indexOf(":"));
      out(`  ${color.dim(`backup if ${HOST_LABELS[h]}'s own route stops working: offload key ${name} && offload model fallback @host-api @default  (→ ${backup})`)}`);
    }
  }
  out();
  return failed ? 1 : 0;
}
async function planLines(items, readers) {
  const { checkoutRoot, ownCopyDir } = await import("./chunk-kzfmw8p4.js");
  const w = Math.max(...items.map((i) => HOST_LABELS[i.host].length), "Offload".length) + 3;
  const lines = [];
  for (const i of items) {
    lines.push(`${pad(HOST_LABELS[i.host], w)}${i.what}`);
    lines.push(`${" ".repeat(w)}${color.dim(i.where)}`);
    lines.push(`${" ".repeat(w)}${color.dim(`reads with ${readers[i.host]}`)}`);
    if (i.note)
      lines.push(`${" ".repeat(w)}${color.yellow(i.note)}`);
  }
  if (!checkoutRoot() && !process.env.OFFLOAD_MARKETPLACE_DIR) {
    lines.push(`${pad("Offload", w)}+ ${tilde(ownCopyDir())}/`);
    lines.push(`${" ".repeat(w)}${color.dim("its own copy, so your agents don't depend on the npx cache")}`);
  }
  return lines;
}
async function installFlow(f, self) {
  const found = await detectHosts();
  const here = AUTO.filter((h) => found[h]);
  const missing = AUTO.filter((h) => !found[h]);
  const why = cannotAsk();
  const ask = !f.yes && !f.dry && !why;
  if (!ask && !f.yes && !f.dry) {
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
  let targets;
  if (f.agents) {
    targets = f.agents;
    const absent = targets.filter((h) => AUTO.includes(h) && !found[h]);
    if (absent.length) {
      process.stderr.write(`offload: not found on this computer: ${absent.map((h) => HOST_LABELS[h]).join(", ")}. Install it first, or leave it out of --agents.
`);
      return 1;
    }
  } else
    targets = here;
  if (!targets.length) {
    const msg = `No supported agent found on this computer. Looked for: ${AUTO.map((h) => HOST_LABELS[h]).join(", ")}.
Install one and run this again, or set up any MCP client: ${self} install mcp`;
    if (ask) {
      const p = await import("./chunk-j8x20cxa.js");
      p.intro(`Harness Offload ${VERSION}`);
      p.outro(msg);
    } else
      out(`
  ${msg.replace(`
`, `
  `)}
`);
    return 1;
  }
  let scope = f.scope ?? "user";
  if (ask) {
    const p = await import("./chunk-j8x20cxa.js");
    const { which } = await import("./chunk-8z9g0eky.js");
    p.intro(`Harness Offload ${VERSION}`);
    p.log.step(`Found on this computer: ${here.map((h) => HOST_LABELS[h]).join(", ")}${missing.length ? color.dim(`
Not found: ${missing.map((h) => HOST_LABELS[h]).join(", ")}`) : ""}`);
    const hints = {};
    for (const h of here) {
      const at = await which(h === "cursor" ? "cursor-agent" : h);
      hints[h] = `${KIND[h] ?? ""}${at ? ` · found ${tilde(at)}` : ""}`;
    }
    const chosen = await p.multiselect({
      message: "Install into which agents?  (space selects, enter confirms)",
      options: here.map((h) => ({ value: h, label: HOST_LABELS[h], hint: hints[h] })),
      initialValues: here,
      required: true
    });
    if (p.isCancel(chosen)) {
      p.cancel("Nothing was changed.");
      return 1;
    }
    targets = chosen;
    if (!f.scope && targets.some((h) => PROJECT_SCOPE.includes(h))) {
      const others = targets.filter((h) => !PROJECT_SCOPE.includes(h));
      const s = await p.select({
        message: "For which projects?",
        options: [
          { value: "user", label: "All my projects (recommended)", hint: "goes in your home folder" },
          { value: "project", label: "This project only", hint: `Claude Code: written into ${tilde(process.cwd())}, committed with the repo${others.length ? "; the others still go in your home folder" : ""}` }
        ],
        initialValue: "user"
      });
      if (p.isCancel(s)) {
        p.cancel("Nothing was changed.");
        return 1;
      }
      scope = s;
    }
  }
  const items = await Promise.all(targets.map((h) => describe(h, scope)));
  const readers = {};
  for (const h of targets)
    readers[h] = await readerFor(h);
  const lines = await planLines(items, readers);
  const undo = `${self} uninstall`;
  if (ask) {
    const p = await import("./chunk-j8x20cxa.js");
    p.note([...lines, "", `Nothing else is touched. Undo any time: ${undo}`].join(`
`), "This will change");
    const go = await p.confirm({ message: "Install?", initialValue: true });
    if (p.isCancel(go) || !go) {
      p.cancel("Nothing was changed.");
      return 1;
    }
  } else {
    out(`
Harness Offload ${VERSION} · ${f.dry ? "dry run, nothing will be written" : "installing without questions (--yes)"}
`);
    out(f.dry ? "Would change:" : "This will change:");
    for (const l of lines)
      out(`  ${l}`);
    out();
    if (f.dry) {
      out(`Run without --dry-run to apply.
`);
      return 0;
    }
  }
  const before = previousVersions();
  let failed = 0;
  const receipt = [];
  const w = Math.max(...targets.map((h) => HOST_LABELS[h].length)) + 2;
  for (const h of targets) {
    const steps = await install(h, { scope });
    const bad = steps.filter((s) => !s.ok);
    if (bad.length) {
      failed++;
      receipt.push(`${sym.bad} ${pad(HOST_LABELS[h], w)}${color.red("not installed:")} ${bad.map((s) => s.text).join("; ")}`);
      continue;
    }
    const was = before[h];
    const verb = was && was !== VERSION ? `updated ${was} → ${VERSION}` : was ? "reinstalled" : "installed";
    receipt.push(`${sym.ok} ${pad(HOST_LABELS[h], w)}${verb}   ${color.dim(`reads with ${readers[h]}`)}`);
    for (const n of steps.filter((s) => s.note && !/^restart |^start a new /.test(s.text)))
      receipt.push(`${sym.warn} ${pad(HOST_LABELS[h], w)}${color.yellow("to do:")} ${n.text}`);
  }
  const end = [
    failed ? `${failed} of ${targets.length} not installed (see above).` : "Done. Restart your agents to load it.",
    `Check: ${self} doctor`,
    `Undo:  ${undo}`
  ];
  if (ask) {
    const p = await import("./chunk-j8x20cxa.js");
    p.log.message(receipt.join(`
`), { symbol: color.dim("│") });
    p.outro(end.join(`
   `));
  } else {
    for (const r of receipt)
      out(r);
    out();
    for (const l of end)
      out(l);
    out();
  }
  return failed ? 1 : 0;
}
function previousVersions() {
  try {
    const all = JSON.parse(readFileSync(join(stateDir2(), "installs.json"), "utf8"));
    return Object.fromEntries(Object.entries(all).map(([h, r]) => [h, r?.version ?? "0.2.0"]));
  } catch {
    return {};
  }
}
async function removeFlow(f, self) {
  const { existsSync, rmSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { runProcess, which } = await import("./chunk-8z9g0eky.js");
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
  const recorded = installedHosts();
  let installed = [...recorded];
  for (const h of ["claude", "copilot"]) {
    if (installed.includes(h) || !await which(h))
      continue;
    const r = await runProcess(h, ["plugin", "list"], { timeoutMs: 60000 });
    if (/harness-offload/.test(r.stdout + r.stderr))
      installed.push(h);
  }
  if (f.agents)
    installed = installed.filter((h) => f.agents.includes(h));
  const { userConfigPath } = await import("./chunk-0tqy95q1.js");
  const { credentialsPath } = await import("./chunk-3xvqp0sn.js");
  const { stateDir } = await import("./chunk-jkzywya7.js");
  const { ownCopyDir } = await import("./chunk-kzfmw8p4.js");
  const cacheDir = join(process.env.OFFLOAD_STATE_DIR || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"), "harness-offload"), "cache");
  const personal = [dirname(userConfigPath()), dirname(credentialsPath()), stateDir(), cacheDir].filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
  let all = f.all;
  let targets = installed;
  if (ask) {
    const p = await import("./chunk-j8x20cxa.js");
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
      required: true
    });
    if (p.isCancel(chosen)) {
      p.cancel("Nothing was changed.");
      return 1;
    }
    targets = chosen;
    if (!f.all && personal.length) {
      const del = await p.confirm({ message: `Also delete your settings, keys and stats? (${personal.map(tilde).join(", ")})`, initialValue: false });
      if (p.isCancel(del)) {
        p.cancel("Nothing was changed.");
        return 1;
      }
      all = Boolean(del);
    }
    p.note([...targets.map((h) => `${HOST_LABELS[h]}`), ...all ? personal.map((d) => `${tilde(d)}/`) : []].join(`
`), "This will remove");
    const go = await p.confirm({ message: "Remove?", initialValue: true });
    if (p.isCancel(go) || !go) {
      p.cancel("Nothing was changed.");
      return 1;
    }
  } else {
    out();
    if (!installed.length)
      out("Harness Offload is not installed in any agent.");
    else
      out(`${f.dry ? "Would remove" : "Removing"} Harness Offload from: ${targets.map((h) => HOST_LABELS[h]).join(", ")}`);
    if (all && personal.length)
      out(`${f.dry ? "Would delete" : "And deleting"}: ${personal.map(tilde).join(", ")}`);
    if (f.dry) {
      out();
      return 0;
    }
  }
  let failed = 0;
  const receipt = [];
  for (const h of targets) {
    const bad = (await uninstall(h)).filter((s) => !s.ok);
    if (bad.length)
      failed++;
    receipt.push(`${bad.length ? sym.bad : sym.ok} ${pad(HOST_LABELS[h], 22)}${bad.length ? color.red("not removed: ") + bad.map((s) => s.text).join("; ") : "removed"}`);
  }
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
  const end = [];
  if (!all && personal.length)
    end.push(`Kept your settings, keys and stats. Delete them too: ${self} uninstall --all`);
  if (self === "offload" && await which("harness-offload"))
    end.push("The offload command itself: npm uninstall -g harness-offload");
  if (ask) {
    const p = await import("./chunk-j8x20cxa.js");
    p.log.message(receipt.join(`
`), { symbol: color.dim("│") });
    p.outro(end.length ? end.join(`
   `) : "Done.");
  } else {
    for (const r of receipt)
      out(r);
    if (end.length)
      out(`
` + end.join(`
`));
    out();
  }
  return failed ? 1 : 0;
}
function previousDates() {
  try {
    const all = JSON.parse(readFileSync(join(stateDir2(), "installs.json"), "utf8"));
    return Object.fromEntries(Object.entries(all).filter(([, r]) => r?.at).map(([h, r]) => [h, r.at]));
  } catch {
    return {};
  }
}
async function cmdSync(argv) {
  const dry = argv.includes("--dry-run");
  const installed = installedHosts();
  const detected = await detectHosts();
  if (!installed.length)
    process.stdout.write(`
  nothing installed yet — run ${color.cyan("offload setup")} or ${color.cyan("offload install <host>")}
`);
  let failed = 0;
  for (const h of installed) {
    process.stdout.write(`
  ${color.bold(HOST_LABELS[h])} ${color.dim("(refresh)")}
`);
    for (const st of await install(h, { dryRun: dry })) {
      process.stdout.write(`  ${st.ok ? sym.ok : sym.bad} ${st.text}
`);
      if (!st.ok)
        failed++;
    }
  }
  const missing = HOSTS.filter((h) => h !== "mcp" && detected[h] && !installed.includes(h));
  if (missing.length)
    process.stdout.write(`
  ${sym.warn} detected but not wired up: ${missing.map((h) => HOST_LABELS[h]).join(", ")} → ${color.cyan(`offload install ${missing.join(" ")}`)}
`);
  process.stdout.write(`
`);
  return failed ? 1 : 0;
}
export {
  cmdInstall,
  cmdSync
};
