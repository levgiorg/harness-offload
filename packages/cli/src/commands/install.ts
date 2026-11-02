import { CONNECTORS } from "../assets.ts";
import { detectHosts, HOST_LABELS, HOSTS, HostName, install, installedHosts, isHost, uninstall } from "../hosts/install.ts";
import { color, sym } from "../ui.ts";

export async function cmdInstall(cmd: string, argv: string[]): Promise<number> {
  const dry = argv.includes("--dry-run");
  const hosts = argv.filter((a) => !a.startsWith("-"));
  if (!hosts.length || hosts.some((h) => !isHost(h))) {
    process.stderr.write(`usage: offload ${cmd} <host...> [--dry-run]   hosts: ${HOSTS.join(" · ")}\n`);
    return 2;
  }
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

/** `offload sync`: refresh every integration installed earlier (after an upgrade), and show what else could be wired up. */
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
