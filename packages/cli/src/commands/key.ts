// `offload key [NAME] [--remove]` — store an API key for an HTTP backend in the
// credentials file (mode 600), read hidden from the terminal or from stdin, so
// it never lands in shell history. Without NAME: which backends have a key.
// Keys are never printed. Twin: cmd_key in the bash engine.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONNECTORS } from "../assets.ts";
import { cfg } from "../config.ts";
import { credentialsPath, endpoint } from "../backends/http.ts";
import { E } from "../backends/types.ts";
import { ExitError } from "./core.ts";

const die = (m: string): never => {
  process.stderr.write(`offload: ${m}\n`);
  throw new ExitError(E.USAGE);
};

function readStore(): Record<string, string> {
  const f = credentialsPath();
  if (!existsSync(f)) return {};
  try {
    const v = JSON.parse(readFileSync(f, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return die(`${f} is not valid JSON; fix it first`);
  }
}

function writeStore(all: Record<string, string>): void {
  const f = credentialsPath();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* windows */
  }
}

function names(): string[] {
  const own = Object.keys((cfg("endpoints") as Record<string, unknown>) ?? {});
  return [...new Set([...Object.keys(CONNECTORS.endpoints).sort(), ...own.sort()])];
}

/** Hidden terminal input, or the first line of piped stdin. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").split("\n")[0].trim();
  }
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  let s = "";
  return await new Promise<string>((resolve) => {
    const on = (b: Buffer) => {
      for (const ch of b.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", on);
          process.stderr.write("\n");
          return resolve(s.trim());
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else s += ch;
      }
    };
    stdin.on("data", on);
  });
}

/** Harnesses whose @host-api backup uses this backend ("claude, devin"). */
function usedBy(name: string): string[] {
  const own = (cfg("host_api_models") as Record<string, string>) ?? {};
  const all = { ...CONNECTORS.host_api_models, ...own };
  return Object.entries(all).filter(([, ref]) => typeof ref === "string" && ref.startsWith(`${name}:`)).map(([h]) => h);
}

export async function cmdKey(argv: string[]): Promise<number> {
  const remove = argv.includes("--remove");
  const args = argv.filter((a) => !a.startsWith("-"));
  for (const a of argv) if (a.startsWith("-") && a !== "--remove") die(`key: unknown option ${a}`);
  const out = (s: string) => process.stdout.write(s);
  if (!args.length) {
    const store = readStore();
    out("API keys (add: offload key NAME · remove: offload key NAME --remove · keys are never shown):\n");
    for (const n of names()) {
      const ep = endpoint(n);
      if (!ep) continue;
      const local = /127\.0\.0\.1|localhost/.test(ep.base_url);
      const env = ep.api_key_env;
      const state = store[n] ? "stored" : ep.api_key ? "in config" : env && process.env[env] ? `from $${env}` : local ? "local, no key needed" : "not set";
      out(`  ${n.padEnd(12)} ${state.padEnd(22)} ${env ?? ""}\n`);
    }
    out(`File: ${credentialsPath()}\n`);
    return 0;
  }
  if (args.length > 1) die("key: give the key on the prompt or through stdin, not as an argument (it would stay in your shell history)");
  const name = args[0];
  const ep = endpoint(name);
  if (!ep) die(`key: unknown backend "${name}" (offload key lists them; add your own with endpoints.${name})`);
  const store = readStore();
  if (remove) {
    if (!(name in store)) {
      out(`no stored key for ${name}\n`);
      return 0;
    }
    delete store[name];
    writeStore(store);
    out(`✓ removed the ${name} key from ${credentialsPath()}\n`);
    return 0;
  }
  const key = await readSecret(`API key for ${ep!.label ?? name}: `);
  if (!key) die("key: empty key, nothing saved");
  if (/\s/.test(key)) die("key: the key contains spaces; nothing saved");
  store[name] = key;
  writeStore(store);
  out(`✓ saved the ${name} key in ${credentialsPath()} (only you can read it)\n`);
  const hosts = usedBy(name);
  if (hosts.length) out(`  backup for ${hosts.join(", ")}: add it to your chain with  offload model fallback @host-api @default\n`);
  out(`  use it directly:  offload model ${name}:MODEL   (offload models ${name} lists them)\n`);
  return 0;
}
