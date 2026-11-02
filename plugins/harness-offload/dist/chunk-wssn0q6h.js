import {
  CONNECTORS,
  color,
  sym
} from "./chunk-yj9cq959.js";
import"./chunk-e63v2s9a.js";
import"./chunk-qwa0fbdf.js";
import {
  HOSTS,
  isHost,
  HOST_LABELS,
  detectHosts,
  install,
  uninstall,
  installedHosts
} from "./chunk-nh1er2v9.js";

// src/commands/install.ts
async function cmdInstall(cmd, argv) {
  const dry = argv.includes("--dry-run");
  const hosts = argv.filter((a) => !a.startsWith("-"));
  if (!hosts.length || hosts.some((h) => !isHost(h))) {
    process.stderr.write(`usage: offload ${cmd} <host...> [--dry-run]   hosts: ${HOSTS.join(" · ")}
`);
    return 2;
  }
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
