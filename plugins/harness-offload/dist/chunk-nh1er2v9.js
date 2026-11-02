import {
  runProcess,
  which
} from "./chunk-yj9cq959.js";
import {
  cfgStr
} from "./chunk-e63v2s9a.js";
import {
  stateDir2,
  opencodeMajor
} from "./chunk-qwa0fbdf.js";

// src/hosts/install.ts
import { cpSync, existsSync as existsSync2, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

// src/hosts/assets.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var here = () => dirname(fileURLToPath(import.meta.url));
function marketplaceRoot() {
  const candidates = [
    process.env.OFFLOAD_MARKETPLACE_DIR,
    join(here(), "..", "assets", "marketplace"),
    join(here(), "..", "..", "..", "assets", "marketplace"),
    resolve(here(), "..", "..", ".."),
    resolve(here(), "..", "..", "..", "..")
  ].filter(Boolean);
  for (const c of candidates)
    if (existsSync(join(c, ".claude-plugin", "marketplace.json")) && existsSync(join(c, "plugins", "harness-offload")))
      return c;
  throw new Error("cannot find the bundled plugin files (set OFFLOAD_MARKETPLACE_DIR)");
}
var pluginDir = () => join(marketplaceRoot(), "plugins", "harness-offload");
function packageRoot() {
  for (const c of [join(here(), ".."), join(here(), "..", "..")])
    if (existsSync(join(c, "package.json")) && existsSync(join(c, "dist")))
      return resolve(c);
  return resolve(here(), "..");
}
var distFile = (name) => join(packageRoot(), "dist", name);

// src/hosts/install.ts
var HOSTS = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin", "aider", "mcp"];
var HIDDEN_HOSTS = ["amp"];
var isHost = (h) => HOSTS.includes(h) || HIDDEN_HOSTS.includes(h);
var HOST_LABELS = {
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
  mcp: "Any MCP client"
};
var HOST_BIN = { claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", qwen: "qwen", crush: "crush", pi: "pi", opencode: "opencode", kilo: "kilo", amp: "amp", devin: "devin", aider: "aider" };
async function mcpCommand() {
  if (await which("harness-offload"))
    return { command: "harness-offload", args: ["mcp"] };
  return { command: isWin ? process.execPath : "node", args: [join2(pluginDir(), "dist", "cli.js"), "mcp"] };
}
async function mcpRecipes() {
  const { command, args } = await mcpCommand();
  const json = (o) => JSON.stringify(o, null, 2);
  const env = { OFFLOAD_HOST: "mcp" };
  const yamlArgs = `[${args.map((a) => JSON.stringify(a)).join(", ")}]`;
  return {
    "Claude Desktop": { file: "claude_desktop_config.json", snippet: json({ mcpServers: { offload: { command, args, env } } }) },
    Cline: { file: "cline_mcp_settings.json (Cline → MCP Servers → Configure)", snippet: json({ mcpServers: { offload: { command, args, env, disabled: false } } }) },
    "VS Code (Copilot Chat agent mode)": { file: ".vscode/mcp.json", snippet: json({ servers: { offload: { type: "stdio", command, args, env } } }) },
    Zed: { file: "~/.config/zed/settings.json", snippet: json({ context_servers: { offload: { command, args, env } } }) },
    Kiro: { file: ".kiro/settings/mcp.json (or ~/.kiro/settings/mcp.json)", snippet: json({ mcpServers: { offload: { command, args, env } } }) },
    Continue: { file: "~/.continue/config.yaml", snippet: `mcpServers:
  - name: offload
    command: ${JSON.stringify(command)}
    args: ${yamlArgs}` },
    Goose: { file: "~/.config/goose/config.yaml", snippet: `extensions:
  offload:
    type: stdio
    enabled: true
    cmd: ${JSON.stringify(command)}
    args: ${yamlArgs}
    timeout: 300` }
  };
}
function crushDir() {
  return process.env.CRUSH_GLOBAL_CONFIG || join2(process.env.XDG_CONFIG_HOME || join2(home(), ".config"), "crush");
}
var CRUSH_DEFAULT_CONTEXT = ["~/.config/crush/CRUSH.md", "~/.config/AGENTS.md"];
var home = () => process.env.OFFLOAD_HOME || homedir();
var record = (host, data) => {
  const f = join2(stateDir2(), "installs.json");
  let all = {};
  try {
    all = JSON.parse(readFileSync(f, "utf8"));
  } catch {}
  if (data === undefined)
    delete all[host];
  else
    all[host] = data;
  writeFileSync(f, JSON.stringify(all, null, 2) + `
`);
};
async function detectHosts() {
  const out = {};
  for (const h of HOSTS) {
    if (h === "mcp")
      out[h] = true;
    else if (h === "cursor")
      out[h] = existsSync2(join2(home(), ".cursor")) || Boolean(await which("cursor-agent")) || Boolean(await which("cursor"));
    else
      out[h] = Boolean(await which(h === "opencode" ? cfgStr("opencode.bin", "opencode") : HOST_BIN[h]));
  }
  return out;
}
async function exec(cmd, args) {
  const r = await runProcess(cmd, args, { timeoutMs: 180000 });
  const tail = (r.stdout + r.stderr).trim().split(`
`).slice(-2).join(" ").slice(0, 200);
  return { ok: r.code === 0, text: `${cmd} ${args.join(" ")}${r.code === 0 ? "" : `  → exit ${r.code}: ${tail}`}` };
}
var isWin = process.platform === "win32";
function winCommand() {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(join2(pluginDir(), "dist", "cli.js"))}`;
}
function rewriteForWindows(file, from) {
  if (!isWin || !existsSync2(file))
    return;
  const j = JSON.parse(readFileSync(file, "utf8"));
  const walk = (v) => {
    if (typeof v === "string")
      return v.replace(from, winCommand());
    if (Array.isArray(v))
      return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(j);
  for (const srv of Object.values(out.mcpServers ?? {})) {
    srv.command = process.execPath;
    srv.args = [join2(pluginDir(), "dist", "cli.js"), "mcp"];
  }
  writeFileSync(file, JSON.stringify(out, null, 2) + `
`);
}
function geminiExtension(dir, launcher) {
  const src = join2(pluginDir(), "hosts", "gemini");
  mkdirSync(join2(dir, "hooks"), { recursive: true });
  const ext = JSON.parse(readFileSync(join2(src, "gemini-extension.json"), "utf8"));
  ext.mcpServers.offload.command = launcher;
  writeFileSync(join2(dir, "gemini-extension.json"), JSON.stringify(ext, null, 2) + `
`);
  const hooks = JSON.parse(readFileSync(join2(src, "hooks", "hooks.json"), "utf8"));
  for (const groups of Object.values(hooks.hooks)) {
    for (const g of groups)
      for (const h of g.hooks)
        h.command = String(h.command).replace('"${extensionPath}/../../bin/offload-ts"', JSON.stringify(launcher));
  }
  writeFileSync(join2(dir, "hooks", "hooks.json"), JSON.stringify(hooks, null, 2) + `
`);
  cpSync(join2(src, "GEMINI.md"), join2(dir, "GEMINI.md"));
  rewriteForWindows(join2(dir, "hooks", "hooks.json"), /"[^"]*offload-ts"/g);
  rewriteForWindows(join2(dir, "gemini-extension.json"), /"[^"]*offload-ts"/g);
}
async function install(host, opts = {}) {
  const steps = [];
  const bin = host === "opencode" ? cfgStr("opencode.bin", "opencode") : HOST_BIN[host];
  if (bin && !await which(bin) && !["cursor", "mcp", "aider"].includes(host)) {
    return [{ ok: false, text: `${HOST_LABELS[host]} not found on PATH (${bin}); install it first.` }];
  }
  const launcher = join2(pluginDir(), "bin", "offload-ts");
  switch (host) {
    case "claude": {
      const root = marketplaceRoot();
      if (opts.dryRun)
        return [{ ok: true, text: `claude plugin marketplace add ${root} && claude plugin install harness-offload@harness-offload` }];
      steps.push(await exec("claude", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("claude", ["plugin", "install", "harness-offload@harness-offload"]));
      steps.push({ ok: true, text: "restart Claude Code (or /reload-plugins) to load it" });
      record(host, { marketplace: root });
      break;
    }
    case "codex": {
      const root = marketplaceRoot();
      if (opts.dryRun)
        return [{ ok: true, text: `codex plugin marketplace add ${root} && codex plugin add harness-offload@harness-offload` }];
      steps.push(await exec("codex", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("codex", ["plugin", "add", "harness-offload@harness-offload"]));
      steps.push({ ok: true, text: "in Codex, open /hooks and trust the Harness Offload hooks (Codex skips untrusted plugin hooks)" });
      record(host, { marketplace: root });
      break;
    }
    case "cursor": {
      const dest = join2(home(), ".cursor", "plugins", "local", "harness-offload");
      if (opts.dryRun)
        return [{ ok: true, text: `copy ${pluginDir()} → ${dest}` }];
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(join2(dest, ".."), { recursive: true });
      cpSync(pluginDir(), dest, { recursive: true });
      rewriteForWindows(join2(dest, "hosts", "cursor", "hooks.json"), /"\$\{CURSOR_PLUGIN_ROOT\}\/bin\/offload-ts"/g);
      rewriteForWindows(join2(dest, "hosts", "cursor", "mcp.json"), /\$\{CURSOR_PLUGIN_ROOT\}\/bin\/offload-ts/g);
      steps.push({ ok: true, text: `installed local plugin → ${dest}` });
      steps.push({ ok: true, text: "in Cursor: Developer: Reload Window (CLI: cursor-agent picks it up on the next run)" });
      record(host, { dir: dest });
      break;
    }
    case "gemini": {
      const dest = join2(home(), ".gemini", "extensions", "harness-offload");
      if (opts.dryRun)
        return [{ ok: true, text: `write Gemini extension → ${dest}` }];
      rmSync(dest, { recursive: true, force: true });
      geminiExtension(dest, launcher);
      steps.push({ ok: true, text: `wrote Gemini CLI extension → ${dest} (hooks + MCP + GEMINI.md)` });
      record(host, { dir: dest });
      break;
    }
    case "copilot": {
      const root = marketplaceRoot();
      if (opts.dryRun)
        return [{ ok: true, text: `copilot plugin marketplace add ${root} && copilot plugin install harness-offload@harness-offload` }];
      steps.push(await exec("copilot", ["plugin", "marketplace", "add", root]));
      steps.push(await exec("copilot", ["plugin", "install", "harness-offload@harness-offload"]));
      steps.push({ ok: true, text: "start a new Copilot session to load it" });
      record(host, { marketplace: root });
      break;
    }
    case "qwen": {
      if (opts.dryRun)
        return [{ ok: true, text: `qwen extensions install ${pluginDir()} --consent` }];
      steps.push(await exec("qwen", ["extensions", "install", pluginDir(), "--consent"]));
      steps.push({ ok: true, text: "Qwen Code can't replace tool output, so long command output is not digested there; reads and the guide work" });
      record(host, { plugin: pluginDir() });
      break;
    }
    case "crush": {
      const dir = crushDir();
      const file = join2(dir, "crush.json");
      const guide = join2(stateDir2(), "crush-guide.md");
      const cmd = isWin ? winCommand() : JSON.stringify(launcher);
      if (opts.dryRun)
        return [{ ok: true, text: `add hooks + context path to ${file}` }];
      let cfg = {};
      if (existsSync2(file)) {
        try {
          cfg = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          return [{ ok: false, text: `${file} is not plain JSON; add the hooks by hand (see docs/hosts.md#crush)` }];
        }
        writeFileSync(`${file}.bak-harness-offload`, readFileSync(file));
      }
      const { sessionGuide } = await import("./chunk-qs3aqz7g.js");
      writeFileSync(guide, sessionGuide("crush", isWin ? winCommand() : JSON.stringify(join2(pluginDir(), "bin", "offload"))) + `
`);
      const ours = (h) => h?.name === "harness-offload";
      cfg.hooks ??= {};
      cfg.hooks.PreToolUse = [...(cfg.hooks.PreToolUse ?? []).filter((h) => !ours(h)), { name: "harness-offload", matcher: "^(view|bash)$", command: `${cmd} hook crush pre-tool`, timeout: 20 }];
      cfg.hooks.PostToolUse = [...(cfg.hooks.PostToolUse ?? []).filter((h) => !ours(h)), { name: "harness-offload", matcher: "^bash$", command: `${cmd} hook crush post-tool`, timeout: 120 }];
      cfg.options ??= {};
      const ctx = cfg.options.global_context_paths ?? [...CRUSH_DEFAULT_CONTEXT];
      if (!ctx.includes(guide))
        ctx.push(guide);
      cfg.options.global_context_paths = ctx;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(cfg, null, 2) + `
`);
      steps.push({ ok: true, text: `added hooks and the guide (${guide}) to ${file}` });
      record(host, { file, guide });
      break;
    }
    case "pi": {
      const pkg = packageRoot();
      if (opts.dryRun)
        return [{ ok: true, text: `pi install ${pkg}` }];
      steps.push(await exec("pi", ["install", pkg]));
      record(host, { source: pkg });
      break;
    }
    case "opencode": {
      const major = await opencodeMajor();
      const dir = join2(home(), ".config", "opencode", major >= 2 ? "plugins" : "plugin");
      const file = join2(dir, "harness-offload.js");
      if (opts.dryRun)
        return [{ ok: true, text: `write ${file} (OpenCode v${major})` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for OpenCode (generated by \`offload install opencode\`)
export { default } from ${JSON.stringify(pathToFileURL(distFile("opencode.js")).href)};
`);
      steps.push({ ok: true, text: `wrote ${file} (OpenCode v${major})` });
      record(host, { file });
      break;
    }
    case "kilo": {
      const dir = join2(home(), ".config", "kilo", "plugin");
      const file = join2(dir, "harness-offload.js");
      if (opts.dryRun)
        return [{ ok: true, text: `write ${file}` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for Kilo Code (generated by \`offload install kilo\`)
export { default } from ${JSON.stringify(pathToFileURL(distFile("opencode.js")).href)};
`);
      steps.push({ ok: true, text: `wrote ${file}` });
      record(host, { file });
      break;
    }
    case "amp": {
      const dir = join2(process.env.XDG_CONFIG_HOME || join2(home(), ".config"), "amp", "plugins");
      const file = join2(dir, "harness-offload.ts");
      if (opts.dryRun)
        return [{ ok: true, text: `write ${file}` }];
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `// Harness Offload for Amp (generated by \`offload install amp\`; experimental)
export { default } from ${JSON.stringify(pathToFileURL(distFile("amp.js")).href)};
`);
      steps.push({ ok: true, text: `wrote ${file} — in Amp run "plugins: reload" (experimental: built from Amp's plugin API docs)` });
      record(host, { file });
      break;
    }
    case "devin": {
      if (opts.dryRun)
        return [{ ok: true, text: `devin plugins install --local ${pluginDir()}` }];
      steps.push(await exec("devin", ["plugins", "install", "--local", pluginDir()]));
      record(host, { plugin: pluginDir() });
      break;
    }
    case "aider": {
      const file = join2(stateDir2(), "aider-conventions.md");
      if (opts.dryRun)
        return [{ ok: true, text: `write ${file}` }];
      const { sessionGuide } = await import("./chunk-qs3aqz7g.js");
      const cli = isWin ? winCommand() : JSON.stringify(join2(pluginDir(), "bin", "offload"));
      writeFileSync(file, `# Harness Offload

${sessionGuide("aider", cli)}

In Aider, run these with /run (the output comes back into the chat).
`);
      steps.push({ ok: true, text: `wrote ${file}` });
      steps.push({ ok: true, text: `use it with: aider --read ${JSON.stringify(file)}   (or add to ~/.aider.conf.yml →  read: [${JSON.stringify(file)}])` });
      record(host, { file });
      break;
    }
    case "mcp": {
      const { command, args } = await mcpCommand();
      steps.push({ ok: true, text: `stdio command for any MCP client: ${[command, ...args].map((a) => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")}` });
      for (const [client, r] of Object.entries(await mcpRecipes()))
        steps.push({ ok: true, text: `${client} — ${r.file}:
${r.snippet}` });
      break;
    }
  }
  return steps;
}
async function uninstall(host) {
  const steps = [];
  switch (host) {
    case "claude":
      steps.push(await exec("claude", ["plugin", "uninstall", "harness-offload@harness-offload"]));
      break;
    case "codex":
      steps.push(await exec("codex", ["plugin", "remove", "harness-offload@harness-offload"]));
      break;
    case "cursor":
    case "gemini": {
      const dir = host === "cursor" ? join2(home(), ".cursor", "plugins", "local", "harness-offload") : join2(home(), ".gemini", "extensions", "harness-offload");
      rmSync(dir, { recursive: true, force: true });
      steps.push({ ok: true, text: `removed ${dir}` });
      break;
    }
    case "copilot":
      steps.push(await exec("copilot", ["plugin", "uninstall", "harness-offload@harness-offload"]));
      break;
    case "qwen":
      steps.push(await exec("qwen", ["extensions", "uninstall", "harness-offload"]));
      break;
    case "crush": {
      const file = join2(crushDir(), "crush.json");
      try {
        const cfg = JSON.parse(readFileSync(file, "utf8"));
        const ours = (h) => h?.name === "harness-offload";
        for (const ev of Object.keys(cfg.hooks ?? {}))
          cfg.hooks[ev] = cfg.hooks[ev].filter((h) => !ours(h));
        const guide = join2(stateDir2(), "crush-guide.md");
        if (Array.isArray(cfg.options?.global_context_paths)) {
          cfg.options.global_context_paths = cfg.options.global_context_paths.filter((p) => p !== guide);
          if (JSON.stringify(cfg.options.global_context_paths) === JSON.stringify(CRUSH_DEFAULT_CONTEXT))
            delete cfg.options.global_context_paths;
        }
        writeFileSync(file, JSON.stringify(cfg, null, 2) + `
`);
        steps.push({ ok: true, text: `removed Harness Offload hooks and guide from ${file}` });
      } catch {
        steps.push({ ok: false, text: `could not edit ${file}; remove the "harness-offload" hooks by hand` });
      }
      break;
    }
    case "pi":
      steps.push(await exec("pi", ["remove", packageRoot()]));
      break;
    case "opencode":
      for (const d of ["plugins", "plugin"]) {
        const f = join2(home(), ".config", "opencode", d, "harness-offload.js");
        if (existsSync2(f)) {
          rmSync(f, { force: true });
          steps.push({ ok: true, text: `removed ${f}` });
        }
      }
      break;
    case "kilo": {
      const f = join2(home(), ".config", "kilo", "plugin", "harness-offload.js");
      rmSync(f, { force: true });
      steps.push({ ok: true, text: `removed ${f}` });
      break;
    }
    case "amp": {
      const f = join2(process.env.XDG_CONFIG_HOME || join2(home(), ".config"), "amp", "plugins", "harness-offload.ts");
      rmSync(f, { force: true });
      steps.push({ ok: true, text: `removed ${f}` });
      break;
    }
    case "devin":
      steps.push(await exec("devin", ["plugins", "uninstall", "harness-offload"]));
      break;
    case "aider": {
      const f = join2(stateDir2(), "aider-conventions.md");
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
function installedHosts() {
  try {
    const all = JSON.parse(readFileSync(join2(stateDir2(), "installs.json"), "utf8"));
    return Object.keys(all).filter((h) => HOSTS.includes(h));
  } catch {
    return [];
  }
}

export { HOSTS, isHost, HOST_LABELS, detectHosts, install, uninstall, installedHosts };
