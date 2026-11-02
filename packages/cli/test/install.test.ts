import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const env = { ...s.env, OFFLOAD_HOME: join(s.dir, "home"), XDG_CONFIG_HOME: join(s.dir, "home", ".config"), PATH: `${bin}:${process.env.PATH}` };
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
  test("unknown host → usage error", () => {
    expect(cli(["install", "notepad"], { env: s.env }).code).toBe(2);
  });
});
