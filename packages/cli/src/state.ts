import { redact } from "./secrets.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfgInt, cfgStr } from "./config.ts";
import { stateHome } from "./paths.ts";

export function stateDir(): string {
  const d = cfgStr("state_dir") || join(stateHome(), "harness-offload");
  for (const sub of ["logs", "cooldowns", "work"]) mkdirSync(join(d, sub), { recursive: true });
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
  return join(stateDir(), "logs", `${ts}-${slug(redact(label))}.log`);
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
