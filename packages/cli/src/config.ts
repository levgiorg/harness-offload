import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULTS } from "./assets.ts";
import { projectConfigPath, projectDir, userConfigPath } from "./paths.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** jq's `*`: objects merge recursively, everything else is replaced. */
export function deepMerge(a: Json, b: Json): Json {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}

export const warnings: string[] = [];

function readJsonFile(path: string): Obj | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (isObj(v)) return v;
  } catch {
    /* fall through */
  }
  const w = `ignoring invalid JSON config: ${path}`;
  if (!warnings.includes(w)) {
    warnings.push(w);
    process.stderr.write(`offload: ${w}\n`);
  }
  return undefined;
}

let cache: Obj | undefined;

export function resetConfig(): void {
  cache = undefined;
}

/** Top-level keys a repository's own .harness-offload.json may set. A cloned
 * repo must not choose binaries to run, endpoints that receive API keys, or
 * switch privacy guards off; it can only tighten secret_globs. Listing the
 * project in the user config's trusted_projects lifts this. (Twin:
 * CO_PROJECT_FILTER in lib/common.sh.) */
export const SAFE_PROJECT_KEYS = ["models", "variants", "read", "explore", "digest", "hooks", "enabled", "log_retention_days", "tasks", "timeouts"];
const SAFE_OPENCODE_KEYS = ["timeout_seconds", "max_stream_errors"];

function isTrustedProject(base: Obj): boolean {
  const t = base.trusted_projects;
  return Array.isArray(t) && t.includes(projectDir());
}

/** Project-config keys ignored because the project is not trusted. */
export function ignoredProjectKeys(): string[] {
  const proj = readJsonFile(projectConfigPath());
  if (!proj) return [];
  let base: Json = structuredClone(DEFAULTS) as Json;
  const user = readJsonFile(userConfigPath());
  if (user) base = deepMerge(base, user);
  if (isTrustedProject(base as Obj)) return [];
  const sorted = (o: Obj) => Object.keys(o).sort();
  const out = sorted(proj).filter((k) => !SAFE_PROJECT_KEYS.includes(k) && k !== "opencode" && k !== "privacy");
  if (isObj(proj.opencode)) out.push(...sorted(proj.opencode).filter((k) => !SAFE_OPENCODE_KEYS.includes(k)).map((k) => `opencode.${k}`));
  if (isObj(proj.privacy)) out.push(...sorted(proj.privacy).filter((k) => k !== "secret_globs").map((k) => `privacy.${k}`));
  return out;
}

function mergeProject(base: Obj, proj: Obj): Obj {
  if (isTrustedProject(base)) return deepMerge(base, proj) as Obj;
  const safe: Obj = {};
  for (const k of SAFE_PROJECT_KEYS) if (k in proj) safe[k] = proj[k];
  const oc: Obj = {};
  if (isObj(proj.opencode)) for (const k of SAFE_OPENCODE_KEYS) if (k in proj.opencode) oc[k] = proj.opencode[k];
  const out = deepMerge(deepMerge(base, safe), { opencode: oc }) as Obj;
  const extra = isObj(proj.privacy) && Array.isArray(proj.privacy.secret_globs) ? proj.privacy.secret_globs.filter((g): g is string => typeof g === "string") : [];
  if (extra.length) {
    const priv = (isObj(out.privacy) ? out.privacy : {}) as Obj;
    out.privacy = { ...priv, secret_globs: [...(Array.isArray(priv.secret_globs) ? priv.secret_globs : []), ...extra] };
  }
  return out;
}

export function loadConfig(): Obj {
  if (cache) return cache;
  let merged: Json = structuredClone(DEFAULTS) as Json;
  const user = readJsonFile(userConfigPath());
  if (user) merged = deepMerge(merged, user);
  const proj = readJsonFile(projectConfigPath());
  if (proj) merged = mergeProject(merged as Obj, proj);
  const c = merged as Obj;
  const env = process.env;
  const set = (path: string, value: Json) => setPath(c, path, value);
  if (env.OFFLOAD_MODEL) set("models.default", env.OFFLOAD_MODEL);
  if (env.OFFLOAD_READ_GUARD) set("hooks.read_guard", env.OFFLOAD_READ_GUARD);
  if (env.OFFLOAD_TIMEOUT && /^\d+$/.test(env.OFFLOAD_TIMEOUT)) set("opencode.timeout_seconds", Number(env.OFFLOAD_TIMEOUT));
  if (env.OFFLOAD_OPENCODE_BIN) set("opencode.bin", env.OFFLOAD_OPENCODE_BIN);
  if (env.OFFLOAD_DISABLE === "1" || env.OFFLOAD_DISABLE === "true") set("enabled", false);
  if (env.OFFLOAD_STATE_DIR) set("state_dir", env.OFFLOAD_STATE_DIR);
  if (env.OFFLOAD_MIN_LINES && /^\d+$/.test(env.OFFLOAD_MIN_LINES)) set("hooks.read_threshold_lines", Number(env.OFFLOAD_MIN_LINES));
  cache = c;
  return c;
}

export function getPath(obj: Json, path: string): Json | undefined {
  let cur: Json | undefined = obj;
  for (const part of path.split(".").filter(Boolean)) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setPath(obj: Obj, path: string, value: Json): void {
  const parts = path.split(".").filter(Boolean);
  let cur: Obj = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p] as Obj;
  }
  cur[parts[parts.length - 1]] = value;
}

export function cfg(path: string): Json | undefined {
  const v = getPath(loadConfig(), path);
  return v === null ? undefined : v;
}
export function cfgStr(path: string, def = ""): string {
  const v = cfg(path);
  if (v === undefined || v === "") return def;
  return typeof v === "string" ? v : JSON.stringify(v);
}
export function cfgInt(path: string, def: number): number {
  const v = cfg(path);
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return def;
}
export function cfgBool(path: string, def: boolean): boolean {
  const v = cfg(path);
  if (v === undefined) return def;
  if (typeof v === "boolean") return v;
  return ["true", "1", "yes", "on"].includes(String(v));
}
export function cfgList(path: string): string[] {
  const v = cfg(path);
  return Array.isArray(v) ? v.map(String) : [];
}

/** Writes (value) or removes (undefined) a key in the user or project config file. */
export function writeConfigKey(key: string, value: Json | undefined, project = false): string {
  const file = project ? projectConfigPath() : userConfigPath();
  let current: Obj = {};
  if (existsSync(file)) {
    const parsed = readJsonFile(file);
    if (!parsed) throw new Error(`${file} is not valid JSON; fix it first`);
    current = parsed;
  } else if (value === undefined) return file;
  if (value === undefined) {
    const parts = key.split(".").filter(Boolean);
    const parent = getPath(current, parts.slice(0, -1).join("."));
    if (isObj(parent)) delete parent[parts[parts.length - 1]];
  } else setPath(current, key, value);
  writeConfigFile(file, current);
  return file;
}

/** Writes key=value into the user (or project) config file, creating it. */
export function setConfigValue(key: string, raw: string, project = false): string {
  const file = project ? projectConfigPath() : userConfigPath();
  let current: Obj = {};
  if (existsSync(file)) {
    const parsed = readJsonFile(file);
    if (!parsed) throw new Error(`${file} is not valid JSON; fix it first`);
    current = parsed;
  }
  let value: Json;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  setPath(current, key, value);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  resetConfig();
  return file;
}

/** Config files may hold API keys: owner-only by default. */
export function writeConfigFile(file: string, value: Obj, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode });
  try {
    chmodSync(file, mode);
  } catch {
    /* not ours to change (e.g. Windows ACLs) */
  }
  resetConfig();
}

export function readConfigFile(file: string): Obj {
  return readJsonFile(file) ?? {};
}

// ---- config check: keys offload doesn't know (typos are otherwise silently ignored)
const OPEN_MAPS = ["tasks", "endpoints", "agents", "hosts", "host_models", "host_api_models", "trusted_projects"];
function leaves(v: unknown, p: string[] = [], out: string[] = []): string[] {
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) leaves(x, [...p, k], out);
  else out.push(p.join("."));
  return out;
}
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Keys in a config object offload doesn't know, each with the closest known key (or "").
 *  Twin: co_config_unknown in common.sh. */
export function unknownConfigKeys(obj: unknown): { key: string; suggest: string }[] {
  const known = leaves(DEFAULTS);
  const set = new Set(known);
  const out: { key: string; suggest: string }[] = [];
  for (const k of leaves(obj)) {
    const top = k.split(".")[0];
    if (set.has(k) || OPEN_MAPS.includes(top) || top.startsWith("_")) continue;
    let best = "";
    let bd = 4;
    for (const c of known) {
      const e = lev(k, c);
      if (e < bd) {
        bd = e;
        best = c;
      }
    }
    out.push({ key: k, suggest: best });
  }
  return out;
}
