// Installs the real npm tarball the way a user gets it (npx: a package in a
// cache folder, no `offload` on PATH) and runs the installer against stub
// agents in a throwaway home: help, --dry-run, install --yes, uninstall --all.
//   node scripts/pack-smoke.mjs   (after `bun run build` and scripts/release-files.mjs)
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const t = mkdtempSync(join(tmpdir(), "offload-pack-smoke-"));
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `\n      ${detail.split("\n").join("\n      ")}`}`);
  if (!ok) failed++;
};
try {
  const tgz = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", t], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
  const pkg = join(t, "_npx", "node_modules", "harness-offload");
  mkdirSync(pkg, { recursive: true });
  execFileSync("tar", ["-xzf", join(t, tgz), "-C", pkg, "--strip-components=1"]);
  const home = join(t, "home"), bin = join(t, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  for (const name of ["claude", "gemini"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${join(t, "calls.log")}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, OFFLOAD_HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), npm_command: "exec", NO_COLOR: "1" };
  const run = (...args) => spawnSync(process.execPath, [join(pkg, "dist", "cli.js"), ...args], { env, cwd: t, encoding: "utf8", timeout: 120_000 });
  const calls = () => (existsSync(join(t, "calls.log")) ? readFileSync(join(t, "calls.log"), "utf8") : "");

  const v = run("--version");
  check("the packed CLI runs (--version)", v.status === 0 && /offload \d+\.\d+\.\d+/.test(v.stdout), v.stderr);
  const h = run();
  check("bare `npx harness-offload` shows help that starts with how to install", h.status === 0 && h.stdout.indexOf("npx harness-offload install") > -1 && h.stdout.indexOf("npx harness-offload install") < h.stdout.indexOf("Delegate"), h.stdout.slice(0, 400));
  const hook = spawnSync(process.execPath, [join(pkg, "dist", "hook.cjs"), "claude", "pre-read"], { env, input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: join(pkgDir, "package.json") }, cwd: t }), encoding: "utf8" });
  check("the hook bundle answers (small read passes)", hook.status === 0 && hook.stdout.trim() === "", hook.stderr);
  const ask = run("install");
  check("no terminal: install asks nothing, changes nothing, says what to run", ask.status === 2 && ask.stderr.includes("npx harness-offload install --yes") && calls() === "", ask.stderr);
  const dry = run("install", "--dry-run");
  check("--dry-run shows the plan (incl. offload's own copy), writes nothing", dry.status === 0 && dry.stdout.includes("+ ~/.local/share/harness-offload/") && !existsSync(join(home, ".local", "share", "harness-offload")) && calls() === "", dry.stdout);
  const ins = run("install", "--yes");
  check("install --yes succeeds", ins.status === 0, ins.stdout + ins.stderr);
  check("Claude Code is installed from GitHub, never from the npx cache", calls().includes("claude plugin marketplace add levgiorg/harness-offload --scope user") && !calls().includes(t), calls());
  const own = join(home, ".local", "share", "harness-offload");
  check("offload's own copy holds the plugin and the package", existsSync(join(own, "marketplace", "plugins", "harness-offload", "bin", "offload-ts")) && existsSync(join(own, "package", "dist", "cli.js")));
  const hooks = readFileSync(join(home, ".gemini", "extensions", "harness-offload", "hooks", "hooks.json"), "utf8");
  check("Gemini's hooks point at the own copy, not the npx cache", hooks.includes(own) && !hooks.includes(pkg), hooks.slice(0, 300));
  check("each agent reads with its own model", ins.stdout.includes("reads with Haiku on your Claude plan") && ins.stdout.includes("reads with Gemini Flash-Lite on your Google account"), ins.stdout);
  const un = run("uninstall", "--yes", "--all");
  check("uninstall --yes --all removes the agents, the own copy and the state", un.status === 0 && !existsSync(own) && !existsSync(join(home, ".gemini", "extensions", "harness-offload")) && calls().includes("claude plugin uninstall"), un.stdout + un.stderr);
} finally {
  rmSync(t, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : "\npacked package: all checks passed");
process.exit(failed ? 1 : 0);
