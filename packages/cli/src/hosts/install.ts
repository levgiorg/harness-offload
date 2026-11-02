// Per-host installers. Each returns human-readable steps it performed (or
// the instructions to finish by hand), and records what to undo.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess, which } from "../proc.ts";
import { stateDir } from "../state.ts";
import { distFile, marketplaceRoot, packageRoot, pluginDir } from "./assets.ts";
import { opencodeMajor } from "../backends/opencode.ts";
import { cfgStr } from "../config.ts";

export const HOSTS = ["claude", "codex", "cursor", "gemini", "pi", "opencode", "kilo", "devin", "mcp"] as const;
export type HostName = (typeof HOSTS)[number];

export const HOST_LABELS: Record<HostName, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex CLI",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  pi: "Pi",
  opencode: "OpenCode",
  kilo: "Kilo Code CLI",
  devin: "Devin Desktop / Windsurf",
  mcp: "Any MCP client",
};

const HOST_BIN: Partial<Record<HostName, string>> = { claude: "claude", codex: "codex", gemini: "gemini", pi: "pi", opencode: "opencode", kilo: "kilo", devin: "devin" };

export interface Step {
  ok: boolean;
  text: string;
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
  const bin = host === "opencode" ? cfgStr("opencode.bin", "opencode") : HOST_BIN[host];
  if (bin && !(await which(bin)) && !["cursor", "mcp"].includes(host)) {
    return [{ ok: false, text: `${HOST_LABELS[host]} not found on PATH (${bin}); install it first.` }];
  }
  const launcher = join(pluginDir(), "bin", "offload-ts");
  switch (host) {
    case "claude": {
      const root = marketplaceRoot();
      if (opts.dryRun) return [{ ok: true, text: `claude plugin marketplace add ${root} && claude plugin install harness-offload@harness-offload` }];
      steps.push(await exec("claude", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("claude", ["plugin", "install", "harness-offload@harness-offload"]));
      steps.push({ ok: true, text: "restart Claude Code (or /reload-plugins) to load it" });
      record(host, { marketplace: root });
      break;
    }
    case "codex": {
      const root = marketplaceRoot();
      if (opts.dryRun) return [{ ok: true, text: `codex plugin marketplace add ${root} && codex plugin add harness-offload@harness-offload` }];
      steps.push(await exec("codex", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("codex", ["plugin", "add", "harness-offload@harness-offload"]));
      steps.push({ ok: true, text: "in Codex, open /hooks and trust the Harness Offload hooks (Codex skips untrusted plugin hooks)" });
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
      steps.push({ ok: true, text: "in Cursor: Developer: Reload Window (CLI: cursor-agent picks it up on the next run)" });
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
    case "devin": {
      if (opts.dryRun) return [{ ok: true, text: `devin plugins install --local ${pluginDir()}` }];
      steps.push(await exec("devin", ["plugins", "install", "--local", pluginDir()]));
      record(host, { plugin: pluginDir() });
      break;
    }
    case "mcp": {
      steps.push({ ok: true, text: `stdio command for any MCP client: ${launcher} mcp   (or: harness-offload mcp)` });
      steps.push({ ok: true, text: `JSON: {"mcpServers":{"offload":{"command":"harness-offload","args":["mcp"]}}}` });
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
      break;
    case "codex":
      steps.push(await exec("codex", ["plugin", "remove", "harness-offload@harness-offload"]));
      break;
    case "cursor":
    case "gemini": {
      const dir = host === "cursor" ? join(home(), ".cursor", "plugins", "local", "harness-offload") : join(home(), ".gemini", "extensions", "harness-offload");
      rmSync(dir, { recursive: true, force: true });
      steps.push({ ok: true, text: `removed ${dir}` });
      break;
    }
    case "pi":
      steps.push(await exec("pi", ["remove", packageRoot()]));
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
    case "devin":
      steps.push(await exec("devin", ["plugins", "uninstall", "harness-offload"]));
      break;
    case "mcp":
      steps.push({ ok: true, text: "remove the offload entry from your MCP client's config" });
  }
  record(host, undefined);
  return steps;
}

export function installedHosts(): HostName[] {
  try {
    const all = JSON.parse(readFileSync(join(stateDir(), "installs.json"), "utf8"));
    return Object.keys(all).filter((h): h is HostName => (HOSTS as readonly string[]).includes(h));
  } catch {
    return [];
  }
}
