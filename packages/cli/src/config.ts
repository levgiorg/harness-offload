import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULTS } from "./assets.ts";
import { projectConfigPath, userConfigPath } from "./paths.ts";

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

export function loadConfig(): Obj {
  if (cache) return cache;
  let merged: Json = structuredClone(DEFAULTS) as Json;
  for (const p of [userConfigPath(), projectConfigPath()]) {
    const v = readJsonFile(p);
    if (v) merged = deepMerge(merged, v);
  }
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

export function writeConfigFile(file: string, value: Obj, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", mode ? { mode } : undefined);
  resetConfig();
}

export function readConfigFile(file: string): Obj {
  return readJsonFile(file) ?? {};
}
