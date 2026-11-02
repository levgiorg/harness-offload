import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, sandbox } from "./helpers";

function withStubs() {
  const s = sandbox();
  const bin = join(s.dir, "bin");
  mkdirSync(bin);
  for (const name of ["claude", "codex", "pi", "gemini", "devin", "kilo", "copilot", "qwen", "crush", "amp"]) {
    const f = join(bin, name);
    writeFileSync(f, `#!/bin/sh\necho "${name} $*" >> "${join(s.dir, "calls.log")}"\n`);
    chmodSync(f, 0o755);
  }
  const env: NodeJS.ProcessEnv = { ...s.env, OFFLOAD_HOME: join(s.dir, "home"), XDG_CONFIG_HOME: join(s.dir, "home", ".config"), PATH: `${bin}:${process.env.PATH}` };
  delete env.CRUSH_GLOBAL_CONFIG;
  return { ...s, env };
}

describe("offload install", () => {
  const s = withStubs();
  const calls = () => (existsSync(join(s.dir, "calls.log")) ? readFileSync(join(s.dir, "calls.log"), "utf8") : "");

  test("claude: marketplace add + plugin install", () => {
    const r = cli(["install", "claude"], { env: s.env });
    expect(r.code).toBe(0);
    expect(calls()).toMatch(/claude plugin marketplace add .+\nclaude plugin install harness-offload@harness-offload/);
  });
  test("codex: marketplace add + plugin add, with a /hooks trust reminder", () => {
    const r = cli(["install", "codex"], { env: s.env });
    expect(calls()).toContain("codex plugin add harness-offload@harness-offload");
    expect(r.stdout).toContain("/hooks");
  });
  test("cursor: local plugin copy", () => {
    expect(cli(["install", "cursor"], { env: s.env }).code).toBe(0);
    const dir = join(s.dir, "home", ".cursor", "plugins", "local", "harness-offload");
    expect(JSON.parse(readFileSync(join(dir, ".cursor-plugin", "plugin.json"), "utf8")).name).toBe("harness-offload");
    expect(existsSync(join(dir, "hosts", "cursor", "rules", "harness-offload.mdc"))).toBe(true);
    expect(cli(["uninstall", "cursor"], { env: s.env }).code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
  test("gemini: self-contained extension with absolute launcher", () => {
    expect(cli(["install", "gemini"], { env: s.env }).code).toBe(0);
    const dir = join(s.dir, "home", ".gemini", "extensions", "harness-offload");
    const ext = JSON.parse(readFileSync(join(dir, "gemini-extension.json"), "utf8"));
    expect(ext.mcpServers.offload.command).toMatch(/\/bin\/offload-ts$/);
    const hooks = JSON.parse(readFileSync(join(dir, "hooks", "hooks.json"), "utf8"));
    expect(hooks.hooks.BeforeTool[0].hooks[0].command).toMatch(/^".*\/bin\/offload-ts" hook gemini before-tool$/);
  });
  test("opencode: plugin re-export file for the detected major version", () => {
    expect(cli(["install", "opencode"], { env: s.env }).code).toBe(0);
    const f = join(s.dir, "home", ".config", "opencode", "plugin", "harness-offload.js");
    expect(readFileSync(f, "utf8")).toMatch(/export \{ default \} from "file:\/\/.*\/dist\/opencode\.js";/);
  });
  test("kilo: OpenCode-v1-style plugin file", () => {
    expect(cli(["install", "kilo"], { env: s.env }).code).toBe(0);
    expect(readFileSync(join(s.dir, "home", ".config", "kilo", "plugin", "harness-offload.js"), "utf8")).toContain("dist/opencode.js");
  });
  test("pi and devin call their CLIs", () => {
    cli(["install", "pi", "devin"], { env: s.env });
    expect(calls()).toMatch(/pi install .*packages\/cli/);
    expect(calls()).toMatch(/devin plugins install --local .*plugins\/harness-offload/);
  });
  test("sync refreshes recorded installs and lists unwired hosts", () => {
    const r = cli(["sync", "--dry-run"], { env: s.env });
    expect(r.stdout).toContain("(refresh)");
    expect(r.stdout).toContain("Cursor");
  });
  test("copilot: marketplace add + plugin install (Copilot reads Claude plugins)", () => {
    expect(cli(["install", "copilot"], { env: s.env }).code).toBe(0);
    expect(calls()).toMatch(/copilot plugin marketplace add .+\ncopilot plugin install harness-offload@harness-offload/);
  });
  test("qwen: converts the Claude plugin into an extension", () => {
    expect(cli(["install", "qwen"], { env: s.env }).code).toBe(0);
    expect(calls()).toMatch(/qwen extensions install .*plugins\/harness-offload --consent/);
  });
  test("crush: hooks + guide merged into crush.json, removed again on uninstall", () => {
    const f = join(s.dir, "home", ".config", "crush", "crush.json");
    mkdirSync(join(s.dir, "home", ".config", "crush"), { recursive: true });
    writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [{ name: "mine", command: "true" }] }, options: { debug: true } }));
    expect(cli(["install", "crush"], { env: s.env }).code).toBe(0);
    expect(cli(["install", "crush"], { env: s.env }).code).toBe(0); // idempotent
    const cfg = JSON.parse(readFileSync(f, "utf8"));
    expect(cfg.hooks.PreToolUse.map((h: any) => h.name)).toEqual(["mine", "harness-offload"]);
    expect(cfg.hooks.PostToolUse[0].command).toMatch(/hook crush post-tool$/);
    expect(cfg.options.debug).toBe(true);
    expect(cfg.options.global_context_paths).toContain("~/.config/crush/CRUSH.md");
    expect(cfg.options.global_context_paths.some((p: string) => p.endsWith("crush-guide.md"))).toBe(true);
    expect(cli(["uninstall", "crush"], { env: s.env }).code).toBe(0);
    const after = JSON.parse(readFileSync(f, "utf8"));
    expect(after.hooks.PreToolUse.map((h: any) => h.name)).toEqual(["mine"]);
    expect(after.options.global_context_paths).toBeUndefined();
  });
  test("amp: plugin re-export file (experimental)", () => {
    expect(cli(["install", "amp"], { env: s.env }).code).toBe(0);
    expect(readFileSync(join(s.dir, "home", ".config", "amp", "plugins", "harness-offload.ts"), "utf8")).toContain("dist/amp.js");
  });
  test("mcp: per-client snippets with a command that works here", () => {
    const r = cli(["install", "mcp"], { env: s.env });
    expect(r.code).toBe(0);
    for (const client of ["Cline", "Zed", "Kiro", "Continue", "Goose", "VS Code", "Claude Desktop"]) expect(r.stdout).toContain(client);
    expect(r.stdout).toMatch(/cli\.js"?,?\s*"?mcp|harness-offload mcp/);
  });
  test("aider: conventions file to pass with --read", () => {
    const r = cli(["install", "aider"], { env: s.env });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("aider --read");
  });
  test("unknown host → usage error", () => {
    expect(cli(["install", "notepad"], { env: s.env }).code).toBe(2);
  });
});

/** The sandbox env without the variables that say "you are inside an agent"
 * (these tests may themselves run inside one) or in CI. */
function plain(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e = { ...env };
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CODEX_THREAD_ID", "CODEX_SANDBOX", "CODEX_CI", "CURSOR_AGENT", "CURSOR_CONVERSATION_ID", "GEMINI_CLI", "GEMINI_SESSION_ID", "COPILOT_CLI", "QWEN_CODE_SESSION_ID", "QWEN_PROJECT_DIR", "CRUSH", "CRUSH_SESSION_ID", "OPENCODE", "OPENCODE_SESSION_ID", "PI_CODING_AGENT", "PI_SESSION_ID", "CI", "OFFLOAD_MODEL"]) delete e[k];
  return e;
}

describe("offload install with no agent named: asks, or is told", () => {
  test("no terminal and no --yes → asks for nothing, changes nothing, says what to run (exit 2)", () => {
    const s = withStubs();
    const r = cli(["install"], { env: plain(s.env) });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("can't ask questions here (no terminal to ask in)");
    expect(r.stderr).toMatch(/install --yes\n\s+every agent found on this computer \(Claude Code, /);
    expect(existsSync(join(s.dir, "calls.log"))).toBe(false);
  });
  test("inside an agent it never prompts either, and names the agent", () => {
    const s = withStubs();
    const r = cli(["install"], { env: { ...plain(s.env), CLAUDECODE: "1" } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("running inside Claude Code");
  });
  test("--yes: the agents found, all projects, the plan, then one receipt line each with its own reader", () => {
    const s = withStubs();
    const r = cli(["install", "--yes"], { env: plain(s.env) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("This will change:");
    expect(r.stdout).toContain("runs claude plugin install harness-offload --scope user");
    expect(r.stdout).toMatch(/✓ Claude Code\s+installed\s+reads with Haiku on your Claude plan/);
    expect(r.stdout).toMatch(/✓ OpenAI Codex CLI\s+installed\s+reads with gpt-6-luna on your ChatGPT plan/);
    expect(r.stdout).toContain("to do: in Codex, open /hooks and trust");
    expect(r.stdout).not.toContain("to do: restart Claude Code"); // the closing line says it
    expect(r.stdout).toContain("Done. Restart your agents to load it.");
    expect(r.stdout).toMatch(/Undo:\s+(offload|npx harness-offload) uninstall/);
    const log = readFileSync(join(s.dir, "calls.log"), "utf8");
    // run from this checkout, the agents point at it (edits apply live)
    expect(log).toMatch(/claude plugin marketplace add \/.+ --scope user\nclaude plugin install harness-offload@harness-offload --scope user/);
    expect(log).not.toContain("levgiorg/harness-offload");
  });
  test("each agent reads with its own model, never another agent's", () => {
    const s = withStubs();
    const r = cli(["install", "--yes", "--agents", "codex,gemini"], { env: plain(s.env) });
    expect(r.stdout).toContain("reads with gpt-6-luna on your ChatGPT plan");
    expect(r.stdout).toContain("reads with Gemini Flash-Lite on your Google account");
    expect(r.stdout).not.toContain("Haiku");
  });
  test("--agents picks; an agent that isn't here is an error, not a silent skip", () => {
    const s = withStubs();
    const r = cli(["install", "--yes", "--agents", "codex"], { env: plain(s.env) });
    expect(r.code).toBe(0);
    const log = readFileSync(join(s.dir, "calls.log"), "utf8");
    expect(log).toContain("codex plugin add");
    expect(log).not.toContain("claude plugin");
    // only the stubs and node on PATH: a real Cursor on the test machine must not count
    const nodeOnly = join(s.dir, "node-bin");
    mkdirSync(nodeOnly);
    symlinkSync(Bun.which("node")!, join(nodeOnly, "node"));
    const isolated = { ...s.env, OFFLOAD_HOME: join(s.dir, "empty-home"), PATH: `${join(s.dir, "bin")}:${nodeOnly}:/usr/bin:/bin` };
    const miss = cli(["install", "--yes", "--agents", "cursor"], { env: plain(isolated) });
    expect(miss.code).toBe(1);
    expect(miss.stderr).toContain("not found on this computer: Cursor");
  });
  test("--scope project: Claude Code goes into this folder's settings, recorded for uninstall", () => {
    const s = withStubs();
    const proj = join(s.dir, "proj");
    mkdirSync(proj);
    const r = cli(["install", "--yes", "--agents", "claude", "--scope", "project"], { env: plain(s.env), cwd: proj });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--scope project");
    expect(r.stdout).toContain("proj/.claude/settings.json (commit it to share it with your team)");
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).toContain("claude plugin install harness-offload@harness-offload --scope project");
    const rec = JSON.parse(readFileSync(join(s.dir, "state", "installs.json"), "utf8")).claude;
    expect(rec.scope).toBe("project");
    // macOS: /var is a link to /private/var, so compare resolved paths
    expect(realpathSync(rec.project)).toBe(realpathSync(proj));
    expect(rec.version).toBeTruthy();
    cli(["uninstall", "--yes"], { env: plain(s.env) });
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).toContain("claude plugin uninstall harness-offload@harness-offload --scope project");
  });
  test("--dry-run shows the plan with paths and changes nothing", () => {
    const s = withStubs();
    const r = cli(["install", "--dry-run"], { env: plain(s.env) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("dry run, nothing will be written");
    expect(r.stdout).toContain("+ ~/.gemini/extensions/harness-offload/");
    expect(r.stdout).toContain("~ ~/.config/crush/crush.json");
    expect(r.stdout).toContain("Run without --dry-run to apply.");
    expect(existsSync(join(s.dir, "calls.log"))).toBe(false);
    expect(existsSync(join(s.dir, "home", ".gemini"))).toBe(false);
  });
  test("running it again says reinstalled / updated", () => {
    const s = withStubs();
    cli(["install", "--yes", "--agents", "gemini"], { env: plain(s.env) });
    const f = join(s.dir, "state", "installs.json");
    const all = JSON.parse(readFileSync(f, "utf8"));
    expect(cli(["install", "--yes", "--agents", "gemini"], { env: plain(s.env) }).stdout).toMatch(/Gemini CLI\s+reinstalled/);
    all.gemini.version = "0.1.0";
    writeFileSync(f, JSON.stringify(all));
    expect(cli(["install", "--yes", "--agents", "gemini"], { env: plain(s.env) }).stdout).toMatch(/Gemini CLI\s+updated 0\.1\.0 → /);
  });
  test("bad flags and unknown agents are usage errors", () => {
    const s = withStubs();
    expect(cli(["install", "--scope", "everywhere"], { env: plain(s.env) }).code).toBe(2);
    expect(cli(["install", "--frobnicate"], { env: plain(s.env) }).code).toBe(2);
    expect(cli(["install", "--yes", "--agents", "notepad"], { env: plain(s.env) }).code).toBe(2);
    expect(cli(["install", "--help"], { env: plain(s.env) }).stdout).toContain("--scope project");
  });
  test("OFFLOAD_PLUGIN_SOURCE picks where Claude Code fetches the plugin", () => {
    const s = withStubs();
    cli(["install", "claude"], { env: { ...s.env, OFFLOAD_PLUGIN_SOURCE: "levgiorg/harness-offload" } });
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).toContain("claude plugin marketplace add levgiorg/harness-offload");
  });
  test("no agent on this computer → says so, exit 1 (never 'install into everything')", () => {
    const s = sandbox();
    // a PATH with node and nothing else (node may share a folder with real agents)
    const only = join(s.dir, "only-node");
    mkdirSync(only);
    require("node:fs").symlinkSync(Bun.which("node")!, join(only, "node"));
    const env: NodeJS.ProcessEnv = { ...plain(s.env), OFFLOAD_HOME: join(s.dir, "home"), PATH: `${only}:/usr/bin:/bin` };
    delete env.OFFLOAD_OPENCODE_BIN; // the sandbox's stub would count as OpenCode
    const r = cli(["install", "--yes"], { env });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("No supported agent found on this computer");
  });
  test("uninstall: no terminal → told what to run; --yes removes it everywhere and keeps settings; --all deletes them", () => {
    const s = withStubs();
    expect(cli(["install", "--yes"], { env: plain(s.env) }).code).toBe(0);
    const ext = join(s.dir, "home", ".gemini", "extensions", "harness-offload");
    expect(existsSync(ext)).toBe(true);
    const asked = cli(["uninstall"], { env: plain(s.env) });
    expect(asked.code).toBe(2);
    expect(asked.stderr).toContain("uninstall --yes --all");
    const r = cli(["uninstall", "--yes"], { env: plain(s.env) });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/✓ Gemini CLI\s+removed/);
    expect(existsSync(ext)).toBe(false);
    const log = readFileSync(join(s.dir, "calls.log"), "utf8");
    expect(log).toContain("claude plugin uninstall harness-offload@harness-offload --scope user");
    expect(log).toContain("claude plugin marketplace remove harness-offload");
    expect(r.stdout).toContain("Kept your settings, keys and stats");
    expect(existsSync(join(s.dir, "state"))).toBe(true);
    expect(cli(["uninstall", "--yes", "--all"], { env: plain(s.env) }).code).toBe(0);
    expect(existsSync(join(s.dir, "state"))).toBe(false);
  });
});

/** Runs the CLI in a real terminal (python3's pty), answering prompts like a person. */
function tty(steps: [string, string][], args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  const r = require("node:child_process").spawnSync("python3", [join(import.meta.dir, "pty-run.py"), JSON.stringify(steps), "--", "node", join(import.meta.dir, "..", "dist", "cli.js"), ...args], { env: { ...env, TERM: "xterm-256color" }, cwd, encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const canPty = process.platform !== "win32" && Boolean(Bun.which("python3"));
const ENTER = "\r", SPACE = " ", DOWN = "\u001b[B", CTRL_C = "\u0003";

describe.skipIf(!canPty)("offload install in a real terminal", () => {
  test("asks agents → where → shows the plan → installs on yes → receipt", () => {
    const s = withStubs();
    const r = tty([["Install into which agents", ENTER], ["For which projects", ENTER], ["Install\\?", ENTER]], ["install"], plain(s.env));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Found on this computer: Claude Code, OpenAI Codex CLI");
    expect(r.out).toContain("This will change");
    expect(r.out).toContain("Nothing else is touched. Undo any time:");
    expect(r.out).toMatch(/✓ Claude Code\s+installed\s+reads with Haiku on your Claude plan/);
    expect(r.out).toContain("Done. Restart your agents to load it.");
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).toContain("claude plugin install harness-offload@harness-offload --scope user");
  });
  test("unticking Claude Code: it is left alone, and 'which projects' isn't asked", () => {
    const s = withStubs();
    const r = tty([["Install into which agents", SPACE + ENTER], ["Install\\?", ENTER]], ["install"], plain(s.env));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("For which projects");
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).not.toContain("claude plugin");
  });
  test("'This project only' installs Claude Code into the project", () => {
    const s = withStubs();
    const proj = join(s.dir, "proj");
    mkdirSync(proj);
    const r = tty([["Install into which agents", ENTER], ["For which projects", DOWN + ENTER], ["Install\\?", ENTER]], ["install", "--agents", "claude"], plain(s.env), proj);
    expect(r.code).toBe(0);
    expect(r.out).toContain("proj/.claude/settings.json");
    expect(readFileSync(join(s.dir, "calls.log"), "utf8")).toContain("--scope project");
  });
  test("Ctrl-C at the confirmation changes nothing", () => {
    const s = withStubs();
    const r = tty([["Install into which agents", ENTER], ["For which projects", ENTER], ["Install\\?", CTRL_C]], ["install"], plain(s.env));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Nothing was changed.");
    expect(existsSync(join(s.dir, "calls.log"))).toBe(false);
    expect(existsSync(join(s.dir, "home", ".gemini"))).toBe(false);
  });
  test("uninstall asks which agents and keeps settings unless you say yes", () => {
    const s = withStubs();
    cli(["install", "--yes"], { env: plain(s.env) });
    const r = tty([["Remove it from which agents", ENTER], ["Also delete your settings", ENTER], ["Remove\\?", ENTER]], ["uninstall"], plain(s.env));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ Gemini CLI\s+removed/);
    expect(r.out).toContain("Kept your settings, keys and stats");
    expect(existsSync(join(s.dir, "state"))).toBe(true);
  });
});
