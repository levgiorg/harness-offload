import { HOST_LABELS, HOSTS, HostName, install, uninstall } from "../hosts/install.ts";
import { color, sym } from "../ui.ts";

export async function cmdInstall(cmd: string, argv: string[]): Promise<number> {
  const dry = argv.includes("--dry-run");
  const hosts = argv.filter((a) => !a.startsWith("-"));
  if (!hosts.length || hosts.some((h) => !HOSTS.includes(h as HostName))) {
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
  }
  process.stdout.write("\n");
  return failed ? 1 : 0;
}
