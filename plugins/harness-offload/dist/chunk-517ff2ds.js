import {
  CONNECTORS,
  color,
  sym
} from "./chunk-25ca7170.js";
import"./chunk-djerf2vs.js";
import"./chunk-d1jn8t5x.js";
import {
  HOSTS,
  isHost,
  HOST_LABELS,
  detectHosts,
  install,
  uninstall,
  installedHosts
} from "./chunk-3vj6ejb8.js";

// src/commands/install.ts
var AUTO = ["claude", "codex", "cursor", "gemini", "copilot", "qwen", "crush", "pi", "opencode", "kilo", "devin"];
async function cmdInstall(cmd, argv) {
  const dry = argv.includes("--dry-run");
  const hosts = argv.filter((a) => !a.startsWith("-"));
  if (hosts.some((h) => !isHost(h))) {
    process.stderr.write(`usage: offload ${cmd} [host...] [--dry-run]${cmd === "uninstall" ? " [--all]" : " [--pick]"}   hosts: ${HOSTS.join(" · ")}
`);
    return 2;
  }
  if (!hosts.length)
    return cmd === "uninstall" ? uninstallEverywhere(argv.includes("--all"), dry) : installEverywhere(dry, argv.includes("--pick"));
  let failed = 0;
  for (const h of hosts) {
    process.stdout.write(`
  ${color.bold(HOST_LABELS[h])}
`);
    const steps = cmd === "uninstall" ? await uninstall(h) : await install(h, { dryRun: dry });
    for (const s of steps) {
      process.stdout.write(`  ${s.ok ? sym.ok : sym.bad} ${s.text}
`);
      if (!s.ok)
        failed++;
    }
    const backup = cmd === "install" ? CONNECTORS.host_api_models?.[h] : undefined;
    if (backup) {
      const name = backup.slice(0, backup.indexOf(":"));
      process.stdout.write(`  ${color.dim(`backup if ${HOST_LABELS[h]}'s own route stops working: offload key ${name} && offload model fallback @host-api @default  (→ ${backup})`)}
`);
    }
  }
  process.stdout.write(`
`);
  return failed ? 1 : 0;
}
async function workerFor(h) {
  const { workerWords } = await import("./chunk-c5evmd8r.js");
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
var pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
async function installEverywhere(dry, pick) {
  const out = (s = "") => process.stdout.write(s + `
`);
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
    const p = await import("./chunk-j8x20cxa.js");
    const chosen = await p.multiselect({ message: "Install Harness Offload into…", options: targets.map((h) => ({ value: h, label: HOST_LABELS[h] })), initialValues: targets, required: false });
    if (p.isCancel(chosen))
      return 1;
    targets = chosen;
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
    for (const n of steps.filter((s) => s.note))
      out(`    ${" ".repeat(width)}${color.dim(n.text)}`);
  }
  const skipped = AUTO.filter((h) => !found[h]);
  out();
  if (!dry) {
    out(failed ? `  ${sym.warn} ${failed} of ${targets.length} not installed (see above).` : `  Done — nothing else to set up. Start your agent as usual.`);
    out();
    const { which } = await import("./chunk-8z9g0eky.js");
    const me = await which("offload") ? "offload" : "npx harness-offload";
    out(`  ${pad("What it saved you:", 22)}${color.cyan(`${me} stats`)}`);
    out(`  ${pad("Change who reads:", 22)}${color.cyan(`${me} model`)} ${color.dim(`(e.g. ${me} model gemini:flash-lite)`)}`);
    out(`  ${pad("Remove everything:", 22)}${color.cyan(`${me} uninstall`)}`);
  }
  if (skipped.length)
    out(color.dim(`
  Not found here (skipped): ${skipped.map((h) => HOST_LABELS[h]).join(", ")}.`));
  out();
  return failed ? 1 : 0;
}
async function uninstallEverywhere(all, dry) {
  const out = (s = "") => process.stdout.write(s + `
`);
  const { existsSync, rmSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { runProcess, which } = await import("./chunk-8z9g0eky.js");
  const recorded = installedHosts();
  const targets = [...recorded];
  for (const h of ["claude", "copilot"]) {
    if (targets.includes(h) || !await which(h))
      continue;
    const r = await runProcess(h, ["plugin", "list"], { timeoutMs: 60000 });
    if (/harness-offload/.test(r.stdout + r.stderr))
      targets.push(h);
  }
  out();
  if (!targets.length)
    out(`  Harness Offload is not installed in any agent.`);
  let failed = 0;
  for (const h of targets) {
    if (dry) {
      out(`  ${sym.dot} ${HOST_LABELS[h]}`);
      continue;
    }
    const bad = (await uninstall(h)).filter((s) => !s.ok);
    if (bad.length)
      failed++;
    out(`  ${bad.length ? sym.bad : sym.ok} ${HOST_LABELS[h]}${bad.length ? color.dim("  " + bad.map((s) => s.text).join("; ")) : color.dim("  removed")}`);
  }
  const { userConfigPath } = await import("./chunk-0tqy95q1.js");
  const { credentialsPath } = await import("./chunk-jyqhj7g2.js");
  const { stateDir } = await import("./chunk-jkzywya7.js");
  const { ownCopyDir } = await import("./chunk-vaybyte5.js");
  const cacheDir = join(process.env.OFFLOAD_STATE_DIR || join(process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"), "harness-offload"), "cache");
  if (!dry && targets.length)
    rmSync(ownCopyDir(), { recursive: true, force: true });
  const kept = [dirname(userConfigPath()), dirname(credentialsPath()), stateDir(), cacheDir].filter((d, i, a) => existsSync(d) && a.indexOf(d) === i);
  if (all) {
    for (const d of kept) {
      if (!dry)
        rmSync(d, { recursive: true, force: true });
      out(`  ${sym.ok} ${dry ? "would remove" : "removed"} ${d}`);
    }
  } else if (kept.length) {
    out(color.dim(`
  Kept your settings, keys and stats (${kept.join(", ")}); add --all to remove them too.`));
  }
  if (await which("harness-offload"))
    out(color.dim(`  The offload command itself: npm uninstall -g harness-offload`));
  out();
  return failed ? 1 : 0;
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
