import {
  CONNECTORS,
  ExitError2
} from "./chunk-yrbt2j5y.js";
import {
  cfg2
} from "./chunk-gh6zr0fa.js";
import {
  credentialsPath2,
  endpoint2
} from "./chunk-gwdfekfb.js";
import {
  E
} from "./chunk-xtyp4a5g.js";
import"./chunk-spdrtbj8.js";
import"./chunk-efswghxn.js";
import"./chunk-2pq08g1m.js";
import"./chunk-h96w7b73.js";
import"./chunk-27r145em.js";

// src/commands/key.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var die = (m) => {
  process.stderr.write(`offload: ${m}
`);
  throw new ExitError2(E.USAGE);
};
function readStore() {
  const f = credentialsPath2();
  if (!existsSync(f))
    return {};
  try {
    const v = JSON.parse(readFileSync(f, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return die(`${f} is not valid JSON; fix it first`);
  }
}
function writeStore(all) {
  const f = credentialsPath2();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2) + `
`, { mode: 384 });
  try {
    chmodSync(f, 384);
  } catch {}
}
function names() {
  const own = Object.keys(cfg2("endpoints") ?? {});
  return [...new Set([...Object.keys(CONNECTORS.endpoints).sort(), ...own.sort()])];
}
async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin)
      chunks.push(c);
    return Buffer.concat(chunks).toString("utf8").split(`
`)[0].trim();
  }
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  let s = "";
  return await new Promise((resolve) => {
    const on = (b) => {
      for (const ch of b.toString("utf8")) {
        if (ch === "\r" || ch === `
`) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", on);
          process.stderr.write(`
`);
          return resolve(s.trim());
        }
        if (ch === "\x03") {
          stdin.setRawMode(false);
          process.stderr.write(`
`);
          process.exit(130);
        }
        if (ch === "" || ch === "\b")
          s = s.slice(0, -1);
        else
          s += ch;
      }
    };
    stdin.on("data", on);
  });
}
function usedBy(name) {
  const own = cfg2("host_api_models") ?? {};
  const all = { ...CONNECTORS.host_api_models, ...own };
  return Object.entries(all).filter(([, ref]) => typeof ref === "string" && ref.startsWith(`${name}:`)).map(([h]) => h);
}
async function cmdKey(argv) {
  const remove = argv.includes("--remove");
  const args = argv.filter((a) => !a.startsWith("-"));
  for (const a of argv)
    if (a.startsWith("-") && a !== "--remove")
      die(`key: unknown option ${a}`);
  const out = (s) => process.stdout.write(s);
  if (!args.length) {
    const store = readStore();
    out(`API keys (add: offload key NAME · remove: offload key NAME --remove · keys are never shown):
`);
    for (const n of names()) {
      const ep = endpoint2(n);
      if (!ep)
        continue;
      const local = /127\.0\.0\.1|localhost/.test(ep.base_url);
      const env = ep.api_key_env;
      const state = store[n] ? "stored" : ep.api_key ? "in config" : env && process.env[env] ? `from $${env}` : local ? "local, no key needed" : "not set";
      out(`  ${n.padEnd(12)} ${state.padEnd(22)} ${env ?? ""}
`);
    }
    out(`File: ${credentialsPath2()}
`);
    return 0;
  }
  if (args.length > 1)
    die("key: give the key on the prompt or through stdin, not as an argument (it would stay in your shell history)");
  const name = args[0];
  const ep = endpoint2(name);
  if (!ep)
    die(`key: unknown backend "${name}" (offload key lists them; add your own with endpoints.${name})`);
  const store = readStore();
  if (remove) {
    if (!(name in store)) {
      out(`no stored key for ${name}
`);
      return 0;
    }
    delete store[name];
    writeStore(store);
    out(`✓ removed the ${name} key from ${credentialsPath2()}
`);
    return 0;
  }
  const key = await readSecret(`API key for ${ep.label ?? name}: `);
  if (!key)
    die("key: empty key, nothing saved");
  if (/\s/.test(key))
    die("key: the key contains spaces; nothing saved");
  store[name] = key;
  writeStore(store);
  out(`✓ saved the ${name} key in ${credentialsPath2()} (only you can read it)
`);
  const hosts = usedBy(name);
  if (hosts.length)
    out(`  backup for ${hosts.join(", ")}: add it to your chain with  offload model fallback @host-api @default
`);
  out(`  use it directly:  offload model ${name}:MODEL   (offload models ${name} lists them)
`);
  return 0;
}
export {
  cmdKey
};
