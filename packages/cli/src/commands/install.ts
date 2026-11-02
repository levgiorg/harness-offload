import { CONNECTORS } from "../assets.ts";
import { detectHosts, HOST_LABELS, HOSTS, HostName, install, installedHosts, isHost, uninstall } from "../hosts/install.ts";
import { color, sym } from "../ui.ts";

/** Agents `offload install` (no host named) sets up when it finds them. */
const AUTO: HostName[] = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin"];

export async function cmdInstall(cmd: string, argv: string[]): Promise<number> {
  const dry = argv.includes("--dry-run");
  const hosts = argv.filter((a) => !a.startsWith("-"));
  if (hosts.some((h) => !isHost(h))) {
    process.stderr.write(`usage: offload ${cmd} [host...] [--dry-run]${cmd === "uninstall" ? " [--all]" : " [--pick]"}   hosts: ${HOSTS.join(" · ")}\n`);
    return 2;
  }
  if (!hosts.length) return cmd === "uninstall" ? uninstallEverywhere(argv.includes("--all"), dry) : installEverywhere(dry, argv.includes("--pick"));
  let failed = 0;
  for (const h of hosts as HostName[]) {
    process.stdout.write(`\n  ${color.bold(HOST_LABELS[h])}\n`);
    const steps = cmd === "uninstall" ? await uninstall(h) : await install(h, { dryRun: dry });
    for (const s of steps) {
      process.stdout.write(`  ${s.ok ? sym.ok : sym.bad} ${s.text}\n`);
      if (!s.ok) failed++;
    }
    // if the harness's own route ever stops working, an API key can take over
    const backup = cmd === "install" ? CONNECTORS.host_api_models?.[h] : undefined;
    if (backup) {
      const name = backup.slice(0, backup.indexOf(":"));
      process.stdout.write(`  ${color.dim(`backup if ${HOST_LABELS[h]}'s own route stops working: offload key ${name} && offload model fallback @host-api @default  (→ ${backup})`)}\n`);
    }
  }
  process.stdout.write("\n");
  return failed ? 1 : 0;
}

/** Who will do the reading for this agent, in words ("Haiku on your Claude plan"). */
async function workerFor(h: HostName): Promise<string> {
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

const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - s.length));

/** `offload install`: every agent found on this computer, no questions. */
async function installEverywhere(dry: boolean, pick: boolean): Promise<number> {
  const out = (s = "") => process.stdout.write(s + "\n");
  const found = await detectHosts();
  let targets = AUTO.filter((h) => found[h]);
  out();
  if (!targets.length) {
    out(`  No supported agent found on this computer.`);
    out(color.dim(`  Supported: ${AUTO.map((h) => HOST_LABELS[h]).join(", ")}.`));
    out(color.dim(`  Install one and run this again, or set up any MCP client: offload install mcp`));
    out();
    return 1;
  }
  if (pick && process.stdin.isTTY && process.stdout.isTTY) {
    const p = await import("@clack/prompts");
    const chosen = await p.multiselect({ message: "Install Harness Offload into…", options: targets.map((h) => ({ value: h, label: HOST_LABELS[h] })), initialValues: targets, required: false });
    if (p.isCancel(chosen)) return 1;
    targets = chosen as HostName[];
  }
  out(`  ${color.bold("Harness Offload")} ${color.dim(dry ? "— would install into:" : "— installing into the agents on this computer")}`);
  out();
  const width = Math.max(...targets.map((h) => HOST_LABELS[h].length)) + 3;
  let failed = 0;
  for (const h of targets) {
    const steps = await install(h, { dryRun: dry });
    const bad = steps.filter((s) => !s.ok);
    if (bad.length) {
      failed++;
      out(`  ${sym.bad} ${pad(HOST_LABELS[h], width)}${color.dim("not installed: " + bad.map((s) => s.text).join("; "))}`);
      continue;
    }
    out(`  ${sym.ok} ${pad(HOST_LABELS[h], width)}${dry ? color.dim(steps.map((s) => s.text).join("; ")) : `reading goes to ${await workerFor(h)}`}`);
    for (const n of steps.filter((s) => s.note)) out(`    ${" ".repeat(width)}${color.dim(n.text)}`);
  }
  const skipped = AUTO.filter((h) => !found[h]);
  out();
  if (!dry) {
    out(failed ? `  ${sym.warn} ${failed} of ${targets.length} not installed (see above).` : `  Done — nothing else to set up. Start your agent as usual.`);
    out();
    // run through npx, there is no `offload` command on PATH
    const { which } = await import("../proc.ts");
    const me = (await which("offload")) ? "offload" : "npx harness-offload";
    out(`  ${pad("What it saved you:", 22)}${color.cyan(`${me} stats`)}`);
    out(`  ${pad("Change who reads:", 22)}${color.cyan(`${me} model`)} ${color.dim(`(e.g. ${me} model gemini:flash-lite)`)}`);
    out(`  ${pad("Remove everything:", 22)}${color.cyan(`${me} uninstall`)}`);
  }
  if (skipped.length) out(color.dim(`\n  Not found here (skipped): ${skipped.map((h) => HOST_LABELS[h]).join(", ")}.`));
  out();
  return failed ? 1 : 0;
}

/** `offload uninstall`: remove it from every agent, plus settings with --all. */
async function uninstallEverywhere(all: boolean, dry: boolean): Promise<number> {
  const out = (s = "") => process.stdout.write(s + "\n");
  const { existsSync, rmSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { runProcess, which } = await import("../proc.ts");
  const recorded = installedHosts();
  // installed by hand (`/plugin install`) counts too
  const targets = [...recorded];
  for (const h of ["claude", "copilot"] as HostName[]) {
    if (targets.includes(h) || !(await which(h))) continue;
    const r = await runProcess(h, ["plugin", "list"], { timeoutMs: 60_000 });
    if (/harness-offload/.test(r.stdout + r.stderr)) targets.push(h);
  }
  out();
  if (!targets.length) out(`  Harness Offload is not installed in any agent.`);
  let failed = 0;
  for (const h of targets) {
    if (dry) {
      out(`  ${sym.dot} ${HOST_LABELS[h]}`);
      continue;
    }
    const bad = (await uninstall(h)).filter((s) => !s.ok);
    if (bad.length) failed++;
    out(`  ${bad.length ? sym.bad : sym.ok} ${HOST_LABELS[h]}${bad.length ? color.dim("  " + bad.map((s) => s.text).join("; ")) : color.dim("  removed")}`);
  }
  const { userConfigPath } = await import("../paths.ts");
  const { credentialsPath } = await import("../backends/http.ts");
  const { stateDir } = await import("../state.ts");
  const { ownCopyDir } = await import("../hosts/assets.ts");
  const cacheDir = join(process.env.OFFLOAD_STATE_DIR || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"), "harness-offload"), "cache");
  // offload's own copy of its files is only there for the agents: always removed
  if (!dry && targets.length) rmSync(ownCopyDir(), { recursive: true, force: true });
  const kept = [dirname(userConfigPath()), dirname(credentialsPath()), stateDir(), cacheDir].filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
  if (all) {
    for (const d of kept) {
      if (!dry) rmSync(d, { recursive: true, force: true });
      out(`  ${sym.ok} ${dry ? "would remove" : "removed"} ${d}`);
    }
  } else if (kept.length) {
    out(color.dim(`\n  Kept your settings, keys and stats (${kept.join(", ")}); add --all to remove them too.`));
  }
  if (await which("harness-offload")) out(color.dim(`  The offload command itself: npm uninstall -g harness-offload`));
  out();
  return failed ? 1 : 0;
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
