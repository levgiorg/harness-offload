import { redact } from "./secrets.ts";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfgInt, cfgStr } from "./config.ts";
import { stateHome } from "./paths.ts";

export function stateDir(): string {
  const d = cfgStr("state_dir") || join(stateHome(), "harness-offload");
  for (const sub of ["logs", "cooldowns", "work"]) mkdirSync(join(d, sub), { recursive: true });
  // logs hold raw command output (which can print secrets): the folder is private,
  // existing installs included; the marker keeps this to one chmod per state dir
  if (!existsSync(join(d, ".private"))) {
    try {
      chmodSync(d, 0o700);
      writeFileSync(join(d, ".private"), "");
    } catch {
      /* not ours to change (or no POSIX modes): leave it */
    }
  }
  return d;
}

export const workDir = (): string => join(stateDir(), "work");

export function appendStats(row: Record<string, unknown>): void {
  try {
    appendFileSync(join(stateDir(), "stats.jsonl"), JSON.stringify({ ts: Math.floor(Date.now() / 1000), ...row }) + "\n");
  } catch {
    /* stats are best-effort */
  }
}

export function readStats(): Record<string, any>[] {
  const f = join(stateDir(), "stats.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").slice(0, 40).replace(/-+$/, "");
}

export function newLogPath(label: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  // the process id keeps two runs of the same command in the same second (parallel
  // agents) from writing over each other's log
  return join(stateDir(), "logs", `${ts}-${slug(redact(label))}-${process.pid}.log`);
}

export function pruneLogs(): void {
  const days = cfgInt("log_retention_days", 7);
  const dir = join(stateDir(), "logs");
  const cutoff = Date.now() - days * 86400_000;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.endsWith(".log") && statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
    }
  } catch {
    /* best-effort */
  }
  try {
    const seen = join(stateDir(), "seen");
    for (const f of readdirSync(seen)) {
      const p = join(seen, f);
      if (statSync(p).mtimeMs < Date.now() - 120 * 60_000) rmSync(p, { force: true });
    }
  } catch {
    /* best-effort */
  }
}

// ---- outputs a session already saw: same names and contents as co_seen_file in common.sh
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();
/** POSIX `cksum` of a buffer: "<crc>-<length>". */
export function cksum(buf: Buffer): string {
  let crc = 0;
  const step = (b: number) => (crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0);
  for (const b of buf) step(b);
  for (let n = buf.length; n > 0; n = Math.floor(n / 256)) step(n & 0xff);
  return `${(~crc) >>> 0}-${buf.length}`;
}
const seenSession = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
export const seenFile = (session: string, text: string): string => join(stateDir(), "seen", `${seenSession(session)}-${cksum(Buffer.from(text))}`);
/** Forget what a session saw (after a compaction or /clear the agent no longer has it). */
export function seenForget(session: string | undefined): void {
  if (!session) return;
  const prefix = `${seenSession(session)}-`;
  try {
    for (const f of readdirSync(join(stateDir(), "seen"))) if (f.startsWith(prefix)) rmSync(join(stateDir(), "seen", f), { force: true });
  } catch {
    /* nothing seen yet */
  }
}

// ---- cooldowns: same on-disk format as the bash engine ("<until-epoch> <reason>")
const cooldownFile = (model: string) => join(stateDir(), "cooldowns", model.replace(/[^A-Za-z0-9._-]/g, "_"));

export function cooling(model: string): string | undefined {
  const f = cooldownFile(model);
  if (!existsSync(f)) return undefined;
  const [until, ...reason] = readFileSync(f, "utf8").trim().split(" ");
  const u = Number(until);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(u) || u <= now) {
    rmSync(f, { force: true });
    return undefined;
  }
  return `${reason.join(" ") || "error"}, ${u - now}s left`;
}

export function coolDown(model: string, seconds: number, reason: string): void {
  try {
    writeFileSync(cooldownFile(model), `${Math.floor(Date.now() / 1000) + seconds} ${reason}\n`);
  } catch {
    /* best-effort */
  }
}

/** Active cooldowns (file names are the sanitised model refs). */
export function listCooldowns(): { model: string; until: number; reason: string }[] {
  const dir = join(stateDir(), "cooldowns");
  const now = Math.floor(Date.now() / 1000);
  const out: { model: string; until: number; reason: string }[] = [];
  for (const f of readdirSync(dir)) {
    try {
      const [until, ...reason] = readFileSync(join(dir, f), "utf8").trim().split(" ");
      const u = Number(until);
      if (Number.isFinite(u) && u > now) out.push({ model: f, until: u, reason: reason.join(" ") || "error" });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.until - b.until);
}

export function clearCooldowns(): void {
  const dir = join(stateDir(), "cooldowns");
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
}
