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
export const SAFE_PROJECT_KEYS = ["models", "variants", "read", "explore", "digest", "hooks", "enabled", "log_retention_days"];
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
