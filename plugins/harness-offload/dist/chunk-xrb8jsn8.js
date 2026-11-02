import {
  cfgInt,
  cfgStr,
  redact
} from "./chunk-z20wwhvz.js";
import {
  stateHome
} from "./chunk-mbd2qv2n.js";

// src/state.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function stateDir() {
  const d = cfgStr("state_dir") || join(stateHome(), "harness-offload");
  for (const sub of ["logs", "cooldowns", "work"])
    mkdirSync(join(d, sub), { recursive: true });
  return d;
}
var workDir = () => join(stateDir(), "work");
function appendStats(row) {
  try {
    appendFileSync(join(stateDir(), "stats.jsonl"), JSON.stringify({ ts: Math.floor(Date.now() / 1000), ...row }) + `
`);
  } catch {}
}
function readStats() {
  const f = join(stateDir(), "stats.jsonl");
  if (!existsSync(f))
    return [];
  return readFileSync(f, "utf8").split(`
`).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
function slug(s) {
  return s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").slice(0, 40).replace(/-+$/, "");
}
function newLogPath(label) {
  const d = new Date;
  const p = (n) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return join(stateDir(), "logs", `${ts}-${slug(redact(label))}.log`);
}
function pruneLogs() {
  const days = cfgInt("log_retention_days", 7);
  const dir = join(stateDir(), "logs");
  const cutoff = Date.now() - days * 86400000;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.endsWith(".log") && statSync(p).mtimeMs < cutoff)
        rmSync(p, { force: true });
    }
  } catch {}
}
var cooldownFile = (model) => join(stateDir(), "cooldowns", model.replace(/[^A-Za-z0-9._-]/g, "_"));
function cooling(model) {
  const f = cooldownFile(model);
  if (!existsSync(f))
    return;
  const [until, ...reason] = readFileSync(f, "utf8").trim().split(" ");
  const u = Number(until);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(u) || u <= now) {
    rmSync(f, { force: true });
    return;
  }
  return `${reason.join(" ") || "error"}, ${u - now}s left`;
}
function coolDown(model, seconds, reason) {
  try {
    writeFileSync(cooldownFile(model), `${Math.floor(Date.now() / 1000) + seconds} ${reason}
`);
  } catch {}
}
function listCooldowns() {
  const dir = join(stateDir(), "cooldowns");
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const f of readdirSync(dir)) {
    try {
      const [until, ...reason] = readFileSync(join(dir, f), "utf8").trim().split(" ");
      const u = Number(until);
      if (Number.isFinite(u) && u > now)
        out.push({ model: f, until: u, reason: reason.join(" ") || "error" });
    } catch {}
  }
  return out.sort((a, b) => a.until - b.until);
}
function clearCooldowns() {
  const dir = join(stateDir(), "cooldowns");
  for (const f of readdirSync(dir))
    rmSync(join(dir, f), { force: true });
}

export { stateDir, workDir, appendStats, readStats, slug, newLogPath, pruneLogs, cooling, coolDown, listCooldowns, clearCooldowns };
