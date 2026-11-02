// Per-host installers. Each returns human-readable steps it performed (or
// the instructions to finish by hand), and records what to undo.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess, which } from "../proc.ts";
import { stateDir } from "../state.ts";
import { checkoutRoot, distFile, marketplaceRoot, packageRoot, pluginDir, useOwnCopy } from "./assets.ts";
import { opencodeMajor } from "../backends/opencode.ts";
import { cfgStr } from "../config.ts";

export const HOSTS = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin", "aider", "mcp"] as const;
/** Integrations that work but are not listed anywhere yet (Amp: built from its docs, never run live). */
export const HIDDEN_HOSTS = ["amp"] as const;
export type HostName = (typeof HOSTS)[number] | (typeof HIDDEN_HOSTS)[number];
export const isHost = (h: string): h is HostName => (HOSTS as readonly string[]).includes(h) || (HIDDEN_HOSTS as readonly string[]).includes(h);

export const HOST_LABELS: Record<HostName, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex CLI",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot CLI",
  qwen: "Qwen Code",
  crush: "Crush",
  pi: "Pi",
  opencode: "OpenCode",
  kilo: "Kilo Code CLI",
  amp: "Amp (experimental)",
  devin: "Devin Desktop / Windsurf",
  aider: "Aider (conventions file)",
  mcp: "Any MCP client",
};

const HOST_BIN: Partial<Record<HostName, string>> = { claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", qwen: "qwen", crush: "crush", pi: "pi", opencode: "opencode", kilo: "kilo", amp: "amp", devin: "devin", aider: "aider" };

/** The stdio command an MCP client should start: the global CLI when present,
 * else node + the bundled CLI (absolute, so it works from any client). */
async function mcpCommand(): Promise<{ command: string; args: string[] }> {
  if (await which("harness-offload")) return { command: "harness-offload", args: ["mcp"] };
  return { command: isWin ? process.execPath : "node", args: [join(pluginDir(), "dist", "cli.js"), "mcp"] };
}

/** Config snippets for MCP-only clients (no hook API to intercept tools). */
export async function mcpRecipes(): Promise<Record<string, { file: string; snippet: string }>> {
  const { command, args } = await mcpCommand();
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  const env = { OFFLOAD_HOST: "mcp" };
  const yamlArgs = `[${args.map((a) => JSON.stringify(a)).join(", ")}]`;
  return {
    "Claude Desktop": { file: "claude_desktop_config.json", snippet: json({ mcpServers: { offload: { command, args, env } } }) },
    Cline: { file: "cline_mcp_settings.json (Cline → MCP Servers → Configure)", snippet: json({ mcpServers: { offload: { command, args, env, disabled: false } } }) },
    "VS Code (Copilot Chat agent mode)": { file: ".vscode/mcp.json", snippet: json({ servers: { offload: { type: "stdio", command, args, env } } }) },
    Zed: { file: "~/.config/zed/settings.json", snippet: json({ context_servers: { offload: { command, args, env } } }) },
    Kiro: { file: ".kiro/settings/mcp.json (or ~/.kiro/settings/mcp.json)", snippet: json({ mcpServers: { offload: { command, args, env } } }) },
    Continue: { file: "~/.continue/config.yaml", snippet: `mcpServers:\n  - name: offload\n    command: ${JSON.stringify(command)}\n    args: ${yamlArgs}` },
    Goose: { file: "~/.config/goose/config.yaml", snippet: `extensions:\n  offload:\n    type: stdio\n    enabled: true\n    cmd: ${JSON.stringify(command)}\n    args: ${yamlArgs}\n    timeout: 300` },
  };
}

/** Crush's global config directory (CRUSH_GLOBAL_CONFIG overrides it). */
function crushDir(): string {
  return process.env.CRUSH_GLOBAL_CONFIG || join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "crush");
}
const CRUSH_DEFAULT_CONTEXT = ["~/.config/crush/CRUSH.md", "~/.config/AGENTS.md"];

export interface Step {
  ok: boolean;
  text: string;
  /** an instruction for the user (shown in summaries), not a record of what ran */
  note?: boolean;
}

/** Where Claude Code, Codex and Copilot fetch the plugin from: this checkout
 * when offload runs from one (edits apply live), else GitHub — never the npm
 * or npx cache, which can disappear. OFFLOAD_PLUGIN_SOURCE overrides it. */
export const GITHUB_REPO = "levgiorg/harness-offload";
export function pluginSource(): string {
  return process.env.OFFLOAD_PLUGIN_SOURCE || checkoutRoot() || GITHUB_REPO;
}

const home = () => process.env.OFFLOAD_HOME || homedir();
const record = (host: string, data: unknown) => {
  const f = join(stateDir(), "installs.json");
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    /* new */
  }
  if (data === undefined) delete all[host];
  else all[host] = data;
  writeFileSync(f, JSON.stringify(all, null, 2) + "\n");
};

export async function detectHosts(): Promise<Record<HostName, boolean>> {
  const out = {} as Record<HostName, boolean>;
  for (const h of HOSTS) {
    if (h === "mcp") out[h] = true;
    else if (h === "cursor") out[h] = existsSync(join(home(), ".cursor")) || Boolean(await which("cursor-agent")) || Boolean(await which("cursor"));
    else out[h] = Boolean(await which(h === "opencode" ? cfgStr("opencode.bin", "opencode") : HOST_BIN[h]!));
  }
  return out;
}

async function exec(cmd: string, args: string[]): Promise<Step> {
  const r = await runProcess(cmd, args, { timeoutMs: 180_000 });
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 200);
  return { ok: r.code === 0, text: `${cmd} ${args.join(" ")}${r.code === 0 ? "" : `  → exit ${r.code}: ${tail}`}` };
}

const isWin = process.platform === "win32";

/** Windows can't run the bash launcher: point copied host files at node + the
 * plugin's bundled CLI instead. Returns the command prefix for hooks. */
function winCommand(): string {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(join(pluginDir(), "dist", "cli.js"))}`;
}

function rewriteForWindows(file: string, from: RegExp): void {
  if (!isWin || !existsSync(file)) return;
  const j = JSON.parse(readFileSync(file, "utf8"));
  const walk = (v: any): any => {
    if (typeof v === "string") return v.replace(from, winCommand());
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(j);
  // MCP servers: command + args form
  for (const srv of Object.values<any>(out.mcpServers ?? {})) {
    srv.command = process.execPath;
    srv.args = [join(pluginDir(), "dist", "cli.js"), "mcp"];
  }
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
}

function geminiExtension(dir: string, launcher: string): void {
  const src = join(pluginDir(), "hosts", "gemini");
  mkdirSync(join(dir, "hooks"), { recursive: true });
  const ext = JSON.parse(readFileSync(join(src, "gemini-extension.json"), "utf8"));
  ext.mcpServers.offload.command = launcher;
  writeFileSync(join(dir, "gemini-extension.json"), JSON.stringify(ext, null, 2) + "\n");
  // The template calls the launcher relative to the repo; a copied extension
  // needs the absolute path.
  const hooks = JSON.parse(readFileSync(join(src, "hooks", "hooks.json"), "utf8"));
  for (const groups of Object.values<any[]>(hooks.hooks)) {
    for (const g of groups) for (const h of g.hooks) h.command = String(h.command).replace('"${extensionPath}/../../bin/offload-ts"', JSON.stringify(launcher));
  }
  writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify(hooks, null, 2) + "\n");
  cpSync(join(src, "GEMINI.md"), join(dir, "GEMINI.md"));
  rewriteForWindows(join(dir, "hooks", "hooks.json"), /"[^"]*offload-ts"/g);
  rewriteForWindows(join(dir, "gemini-extension.json"), /"[^"]*offload-ts"/g);
}

export async function install(host: HostName, opts: { dryRun?: boolean } = {}): Promise<Step[]> {
  const steps: Step[] = [];
  if (!opts.dryRun) useOwnCopy();
  const bin = host === "opencode" ? cfgStr("opencode.bin", "opencode") : HOST_BIN[host];
  if (bin && !(await which(bin)) && !["cursor", "mcp", "aider"].includes(host)) {
    return [{ ok: false, text: `${HOST_LABELS[host]} not found on PATH (${bin}); install it first.` }];
  }
  const launcher = join(pluginDir(), "bin", "offload-ts");
  switch (host) {
    case "claude": {
      const root = pluginSource();
      if (opts.dryRun) return [{ ok: true, text: `claude plugin marketplace add ${root} && claude plugin install harness-offload@harness-offload` }];
      steps.push(await exec("claude", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("claude", ["plugin", "install", "harness-offload@harness-offload"]));
      steps.push({ ok: true, note: true, text: "restart Claude Code (or /reload-plugins) to load it" });
      record(host, { marketplace: root });
      break;
    }
    case "codex": {
      const root = pluginSource();
      if (opts.dryRun) return [{ ok: true, text: `codex plugin marketplace add ${root} && codex plugin add harness-offload@harness-offload` }];
      steps.push(await exec("codex", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("codex", ["plugin", "add", "harness-offload@harness-offload"]));
      steps.push({ ok: true, note: true, text: "in Codex, open /hooks and trust the Harness Offload hooks (Codex skips untrusted plugin hooks)" });
      record(host, { marketplace: root });
      break;
    }
    case "cursor": {
      const dest = join(home(), ".cursor", "plugins", "local", "harness-offload");
      if (opts.dryRun) return [{ ok: true, text: `copy ${pluginDir()} → ${dest}` }];
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(join(dest, ".."), { recursive: true });
      cpSync(pluginDir(), dest, { recursive: true });
      rewriteForWindows(join(dest, "hosts", "cursor", "hooks.json"), /"\$\{CURSOR_PLUGIN_ROOT\}\/bin\/offload-ts"/g);
      rewriteForWindows(join(dest, "hosts", "cursor", "mcp.json"), /\$\{CURSOR_PLUGIN_ROOT\}\/bin\/offload-ts/g);
      steps.push({ ok: true, text: `installed local plugin → ${dest}` });
      steps.push({ ok: true, note: true, text: "in Cursor: Developer: Reload Window (CLI: cursor-agent picks it up on the next run)" });
      record(host, { dir: dest });
      break;
    }
    case "gemini": {
      const dest = join(home(), ".gemini", "extensions", "harness-offload");
      if (opts.dryRun) return [{ ok: true, text: `write Gemini extension → ${dest}` }];
      rmSync(dest, { recursive: true, force: true });
      geminiExtension(dest, launcher);
      steps.push({ ok: true, text: `wrote Gemini CLI extension → ${dest} (hooks + MCP + GEMINI.md)` });
      record(host, { dir: dest });
      break;
    }
    case "copilot": {
      // Copilot CLI reads Claude marketplaces and plugins; the plugin's hooks
      // speak Copilot's dialect when COPILOT_CLI=1.
      const root = pluginSource();
      if (opts.dryRun) return [{ ok: true, text: `copilot plugin marketplace add ${root} && copilot plugin install harness-offload@harness-offload` }];
      steps.push(await exec("copilot", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("copilot", ["plugin", "install", "harness-offload@harness-offload"]));
      steps.push({ ok: true, note: true, text: "start a new Copilot session to load it" });
      record(host, { marketplace: root });
      break;
    }
    case "qwen": {
      // Qwen Code converts a Claude plugin into an extension on install.
      if (opts.dryRun) return [{ ok: true, text: `qwen extensions install ${pluginDir()} --consent` }];
      steps.push(await exec("qwen", ["extensions", "install", pluginDir(), "--consent"]));
      steps.push({ ok: true, note: true, text: "Qwen Code can't replace tool output, so long command output is not digested there; reads and the guide work" });
      record(host, { plugin: pluginDir() });
      break;
    }
    case "crush": {
      // No plugin system: hooks + a global context file in crush.json.
      const dir = crushDir();
      const file = join(dir, "crush.json");
      const guide = join(stateDir(), "crush-guide.md");
      const cmd = isWin ? winCommand() : JSON.stringify(launcher);
      if (opts.dryRun) return [{ ok: true, text: `add hooks + context path to ${file}` }];
      let cfg: Record<string, any> = {};
      if (existsSync(file)) {
        try {
          cfg = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          return [{ ok: false, text: `${file} is not plain JSON; add the hooks by hand (see docs/hosts.md#crush)` }];
        }
        writeFileSync(`${file}.bak-harness-offload`, readFileSync(file));
      }
      const { sessionGuide } = await import("../hooks/logic.ts");
      writeFileSync(guide, sessionGuide("crush", isWin ? winCommand() : JSON.stringify(join(pluginDir(), "bin", "offload"))) + "\n");
      const ours = (h: any) => h?.name === "harness-offload";
      cfg.hooks ??= {};
      cfg.hooks.PreToolUse = [...(cfg.hooks.PreToolUse ?? []).filter((h: any) => !ours(h)), { name: "harness-offload", matcher: "^(view|bash)$", command: `${cmd} hook crush pre-tool`, timeout: 20 }];
      cfg.hooks.PostToolUse = [...(cfg.hooks.PostToolUse ?? []).filter((h: any) => !ours(h)), { name: "harness-offload", matcher: "^bash$", command: `${cmd} hook crush post-tool`, timeout: 120 }];
      cfg.options ??= {};
      const ctx: string[] = cfg.options.global_context_paths ?? [...CRUSH_DEFAULT_CONTEXT]; // setting it replaces the defaults
      if (!ctx.includes(guide)) ctx.push(guide);
      cfg.options.global_context_paths = ctx;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      steps.push({ ok: true, text: `added hooks and the guide (${guide}) to ${file}` });
      record(host, { file, guide });
      break;
    }
    case "pi": {
      const pkg = packageRoot();
      if (opts.dryRun) return [{ ok: true, text: `pi install ${pkg}` }];
      steps.push(await exec("pi", ["install", pkg]));
      record(host, { source: pkg });
      break;
    }
    case "opencode": {
      const major = await opencodeMajor();
      const dir = join(home(), ".config", "opencode", major >= 2 ? "plugins" : "plugin");
      const file = join(dir, "harness-offload.js");
      if (opts.dryRun) return [{ ok: true, text: `write ${file} (OpenCode v${major})` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for OpenCode (generated by \`offload install opencode\`)\nexport { default } from ${JSON.stringify(pathToFileURL(distFile("opencode.js")).href)};\n`);
      steps.push({ ok: true, text: `wrote ${file} (OpenCode v${major})` });
      record(host, { file });
      break;
    }
    case "kilo": {
      // Kilo Code is an OpenCode v1 fork with the same plugin API.
      const dir = join(home(), ".config", "kilo", "plugin");
      const file = join(dir, "harness-offload.js");
      if (opts.dryRun) return [{ ok: true, text: `write ${file}` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for Kilo Code (generated by \`offload install kilo\`)\nexport { default } from ${JSON.stringify(pathToFileURL(distFile("opencode.js")).href)};\n`);
      steps.push({ ok: true, text: `wrote ${file}` });
      record(host, { file });
      break;
    }
    case "amp": {
      const dir = join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "amp", "plugins");
      const file = join(dir, "harness-offload.ts");
      if (opts.dryRun) return [{ ok: true, text: `write ${file}` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for Amp (generated by \`offload install amp\`; experimental)\nexport { default } from ${JSON.stringify(pathToFileURL(distFile("amp.js")).href)};\n`);
      steps.push({ ok: true, text: `wrote ${file} — in Amp run "plugins: reload" (experimental: built from Amp's plugin API docs)` });
      record(host, { file });
      break;
    }
    case "devin": {
      if (opts.dryRun) return [{ ok: true, text: `devin plugins install --local ${pluginDir()}` }];
      steps.push(await exec("devin", ["plugins", "install", "--local", pluginDir()]));
      record(host, { plugin: pluginDir() });
      break;
    }
    case "aider": {
      // Aider has neither hooks nor MCP: a conventions file read at start-up
      // teaches it to call the CLI from /run.
      const file = join(stateDir(), "aider-conventions.md");
      if (opts.dryRun) return [{ ok: true, text: `write ${file}` }];
      const { sessionGuide } = await import("../hooks/logic.ts");
      const cli = isWin ? winCommand() : JSON.stringify(join(pluginDir(), "bin", "offload"));
      writeFileSync(file, `# Harness Offload\n\n${sessionGuide("aider" as any, cli)}\n\nIn Aider, run these with /run (the output comes back into the chat).\n`);
      steps.push({ ok: true, text: `wrote ${file}` });
      steps.push({ ok: true, text: `use it with: aider --read ${JSON.stringify(file)}   (or add to ~/.aider.conf.yml →  read: [${JSON.stringify(file)}])` });
      record(host, { file });
      break;
    }
    case "mcp": {
      const { command, args } = await mcpCommand();
      steps.push({ ok: true, text: `stdio command for any MCP client: ${[command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}` });
      for (const [client, r] of Object.entries(await mcpRecipes())) steps.push({ ok: true, text: `${client} — ${r.file}:\n${r.snippet}` });
      break;
    }
  }
  return steps;
}

export async function uninstall(host: HostName): Promise<Step[]> {
  const steps: Step[] = [];
  switch (host) {
    case "claude":
      steps.push(await exec("claude", ["plugin", "uninstall", "harness-offload@harness-offload"]));
      steps.push(await exec("claude", ["plugin", "marketplace", "remove", "harness-offload"]));
      break;
    case "codex":
      steps.push(await exec("codex", ["plugin", "remove", "harness-offload@harness-offload"]));
      steps.push(await exec("codex", ["plugin", "marketplace", "remove", "harness-offload"]));
      break;
    case "cursor":
    case "gemini": {
      const dir = host === "cursor" ? join(home(), ".cursor", "plugins", "local", "harness-offload") : join(home(), ".gemini", "extensions", "harness-offload");
      rmSync(dir, { recursive: true, force: true });
      steps.push({ ok: true, text: `removed ${dir}` });
      break;
    }
    case "copilot":
      steps.push(await exec("copilot", ["plugin", "uninstall", "harness-offload@harness-offload"]));
      steps.push(await exec("copilot", ["plugin", "marketplace", "remove", "harness-offload"]));
      break;
    case "qwen":
      steps.push(await exec("qwen", ["extensions", "uninstall", "harness-offload"]));
      break;
    case "crush": {
      const file = join(crushDir(), "crush.json");
      try {
        const cfg = JSON.parse(readFileSync(file, "utf8"));
        const ours = (h: any) => h?.name === "harness-offload";
        for (const ev of Object.keys(cfg.hooks ?? {})) cfg.hooks[ev] = cfg.hooks[ev].filter((h: any) => !ours(h));
        const guide = join(stateDir(), "crush-guide.md");
        if (Array.isArray(cfg.options?.global_context_paths)) {
          cfg.options.global_context_paths = cfg.options.global_context_paths.filter((p: string) => p !== guide);
          if (JSON.stringify(cfg.options.global_context_paths) === JSON.stringify(CRUSH_DEFAULT_CONTEXT)) delete cfg.options.global_context_paths;
        }
        writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
        steps.push({ ok: true, text: `removed Harness Offload hooks and guide from ${file}` });
      } catch {
        steps.push({ ok: false, text: `could not edit ${file}; remove the "harness-offload" hooks by hand` });
      }
      break;
    }
    case "pi":
      // the path it was installed from (offload's own copy, or a checkout)
      steps.push(await exec("pi", ["remove", recorded(host).source || packageRoot()]));
      break;
    case "opencode":
      for (const d of ["plugins", "plugin"]) {
        const f = join(home(), ".config", "opencode", d, "harness-offload.js");
        if (existsSync(f)) {
          rmSync(f, { force: true });
          steps.push({ ok: true, text: `removed ${f}` });
        }
      }
      break;
    case "kilo": {
      const f = join(home(), ".config", "kilo", "plugin", "harness-offload.js");
      rmSync(f, { force: true });
      steps.push({ ok: true, text: `removed ${f}` });
      break;
    }
    case "amp": {
      const f = join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "amp", "plugins", "harness-offload.ts");
      rmSync(f, { force: true });
      steps.push({ ok: true, text: `removed ${f}` });
      break;
    }
    case "devin":
      steps.push(await exec("devin", ["plugins", "uninstall", "harness-offload"]));
      break;
    case "aider": {
      const f = join(stateDir(), "aider-conventions.md");
      rmSync(f, { force: true });
      steps.push({ ok: true, text: `removed ${f} (drop it from ~/.aider.conf.yml if you added it)` });
      break;
    }
    case "mcp":
      steps.push({ ok: true, text: "remove the offload entry from your MCP client's config" });
  }
  record(host, undefined);
  return steps;
}

/** What `install` recorded for a host (e.g. the source Pi was installed from). */
function recorded(host: HostName): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(stateDir(), "installs.json"), "utf8"))[host] ?? {};
  } catch {
    return {};
  }
}

export function installedHosts(): HostName[] {
  try {
    const all = JSON.parse(readFileSync(join(stateDir(), "installs.json"), "utf8"));
    return Object.keys(all).filter((h): h is HostName => (HOSTS as readonly string[]).includes(h));
  } catch {
    return [];
  }
}
