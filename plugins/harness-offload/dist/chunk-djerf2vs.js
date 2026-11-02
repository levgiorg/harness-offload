import {
  DEFAULTS,
  childProcess
} from "./chunk-25ca7170.js";

// src/config.ts
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// src/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
var isWin = process.platform === "win32";
function configHome2() {
  if (process.env.XDG_CONFIG_HOME)
    return process.env.XDG_CONFIG_HOME;
  if (isWin && process.env.APPDATA)
    return process.env.APPDATA;
  return join(homedir(), ".config");
}
function stateHome2() {
  if (process.env.XDG_STATE_HOME)
    return process.env.XDG_STATE_HOME;
  if (isWin && process.env.LOCALAPPDATA)
    return process.env.LOCALAPPDATA;
  return join(homedir(), ".local", "state");
}
function userConfigPath2() {
  return process.env.OFFLOAD_CONFIG || join(configHome2(), "harness-offload", "config.json");
}
var projectDirCache;
function projectDir2() {
  if (projectDirCache)
    return projectDirCache;
  const fromEnv = process.env.OFFLOAD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory())
    return projectDirCache = fromEnv;
  try {
    const top = childProcess().execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top)
      return projectDirCache = top;
  } catch {}
  return projectDirCache = process.cwd();
}
function setProjectDir2(dir) {
  projectDirCache = dir;
}
function projectConfigPath2() {
  return join(projectDir2(), ".harness-offload.json");
}

// src/config.ts
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b))
    return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}
var warnings = [];
function readJsonFile(path) {
  if (!existsSync2(path))
    return;
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (isObj(v))
      return v;
  } catch {}
  const w = `ignoring invalid JSON config: ${path}`;
  if (!warnings.includes(w)) {
    warnings.push(w);
    process.stderr.write(`offload: ${w}
`);
  }
  return;
}
var cache;
function resetConfig() {
  cache = undefined;
}
var SAFE_PROJECT_KEYS = ["models", "variants", "read", "explore", "digest", "hooks", "enabled", "log_retention_days", "tasks"];
var SAFE_OPENCODE_KEYS = ["timeout_seconds", "max_stream_errors"];
function isTrustedProject(base) {
  const t = base.trusted_projects;
  return Array.isArray(t) && t.includes(projectDir2());
}
function ignoredProjectKeys() {
  const proj = readJsonFile(projectConfigPath2());
  if (!proj)
    return [];
  let base = structuredClone(DEFAULTS);
  const user = readJsonFile(userConfigPath2());
  if (user)
    base = deepMerge(base, user);
  if (isTrustedProject(base))
    return [];
  const sorted = (o) => Object.keys(o).sort();
  const out = sorted(proj).filter((k) => !SAFE_PROJECT_KEYS.includes(k) && k !== "opencode" && k !== "privacy");
  if (isObj(proj.opencode))
    out.push(...sorted(proj.opencode).filter((k) => !SAFE_OPENCODE_KEYS.includes(k)).map((k) => `opencode.${k}`));
  if (isObj(proj.privacy))
    out.push(...sorted(proj.privacy).filter((k) => k !== "secret_globs").map((k) => `privacy.${k}`));
  return out;
}
function mergeProject(base, proj) {
  if (isTrustedProject(base))
    return deepMerge(base, proj);
  const safe = {};
  for (const k of SAFE_PROJECT_KEYS)
    if (k in proj)
      safe[k] = proj[k];
  const oc = {};
  if (isObj(proj.opencode)) {
    for (const k of SAFE_OPENCODE_KEYS)
      if (k in proj.opencode)
        oc[k] = proj.opencode[k];
  }
  const out = deepMerge(deepMerge(base, safe), { opencode: oc });
  const extra = isObj(proj.privacy) && Array.isArray(proj.privacy.secret_globs) ? proj.privacy.secret_globs.filter((g) => typeof g === "string") : [];
  if (extra.length) {
    const priv = isObj(out.privacy) ? out.privacy : {};
    out.privacy = { ...priv, secret_globs: [...Array.isArray(priv.secret_globs) ? priv.secret_globs : [], ...extra] };
  }
  return out;
}
function loadConfig() {
  if (cache)
    return cache;
  let merged = structuredClone(DEFAULTS);
  const user = readJsonFile(userConfigPath2());
  if (user)
    merged = deepMerge(merged, user);
  const proj = readJsonFile(projectConfigPath2());
  if (proj)
    merged = mergeProject(merged, proj);
  const c = merged;
  const env = process.env;
  const set = (path, value) => setPath(c, path, value);
  if (env.OFFLOAD_MODEL)
    set("models.default", env.OFFLOAD_MODEL);
  if (env.OFFLOAD_READ_GUARD)
    set("hooks.read_guard", env.OFFLOAD_READ_GUARD);
  if (env.OFFLOAD_TIMEOUT && /^\d+$/.test(env.OFFLOAD_TIMEOUT))
    set("opencode.timeout_seconds", Number(env.OFFLOAD_TIMEOUT));
  if (env.OFFLOAD_OPENCODE_BIN)
    set("opencode.bin", env.OFFLOAD_OPENCODE_BIN);
  if (env.OFFLOAD_DISABLE === "1" || env.OFFLOAD_DISABLE === "true")
    set("enabled", false);
  if (env.OFFLOAD_STATE_DIR)
    set("state_dir", env.OFFLOAD_STATE_DIR);
  if (env.OFFLOAD_MIN_LINES && /^\d+$/.test(env.OFFLOAD_MIN_LINES))
    set("hooks.read_threshold_lines", Number(env.OFFLOAD_MIN_LINES));
  cache = c;
  return c;
}
function getPath(obj, path) {
  let cur = obj;
  for (const part of path.split(".").filter(Boolean)) {
    if (!isObj(cur))
      return;
    cur = cur[part];
  }
  return cur;
}
function setPath(obj, path, value) {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(cur[p]))
      cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
function cfg(path) {
  const v = getPath(loadConfig(), path);
  return v === null ? undefined : v;
}
function cfgStr(path, def = "") {
  const v = cfg(path);
  if (v === undefined || v === "")
    return def;
  return typeof v === "string" ? v : JSON.stringify(v);
}
function cfgInt(path, def) {
  const v = cfg(path);
  if (typeof v === "number" && Number.isFinite(v))
    return Math.trunc(v);
  if (typeof v === "string" && /^\d+$/.test(v))
    return Number(v);
  return def;
}
function cfgBool(path, def) {
  const v = cfg(path);
  if (v === undefined)
    return def;
  if (typeof v === "boolean")
    return v;
  return ["true", "1", "yes", "on"].includes(String(v));
}
function cfgList(path) {
  const v = cfg(path);
  return Array.isArray(v) ? v.map(String) : [];
}
function writeConfigKey(key, value, project = false) {
  const file = project ? projectConfigPath2() : userConfigPath2();
  let current = {};
  if (existsSync2(file)) {
    const parsed = readJsonFile(file);
    if (!parsed)
      throw new Error(`${file} is not valid JSON; fix it first`);
    current = parsed;
  } else if (value === undefined)
    return file;
  if (value === undefined) {
    const parts = key.split(".").filter(Boolean);
    const parent = getPath(current, parts.slice(0, -1).join("."));
    if (isObj(parent))
      delete parent[parts[parts.length - 1]];
  } else
    setPath(current, key, value);
  writeConfigFile(file, current);
  return file;
}
function setConfigValue(key, raw, project = false) {
  const file = project ? projectConfigPath2() : userConfigPath2();
  let current = {};
  if (existsSync2(file)) {
    const parsed = readJsonFile(file);
    if (!parsed)
      throw new Error(`${file} is not valid JSON; fix it first`);
    current = parsed;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  setPath(current, key, value);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(current, null, 2) + `
`);
  resetConfig();
  return file;
}
function writeConfigFile(file, value, mode = 384) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + `
`, { mode });
  try {
    chmodSync(file, mode);
  } catch {}
  resetConfig();
}
function readConfigFile(file) {
  return readJsonFile(file) ?? {};
}

// src/secrets.ts
import { lstatSync, realpathSync } from "node:fs";
import { basename } from "node:path";
function globToRegExp(glob, flags = "") {
  let re = "";
  for (let i = 0;i < glob.length; i++) {
    const c = glob[i];
    if (c === "*")
      re += "[^/]*";
    else if (c === "?")
      re += "[^/]";
    else if (c === "[") {
      const j = glob.indexOf("]", i + 1);
      if (j > i) {
        re += "[" + glob.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
        i = j;
      } else
        re += "\\[";
    } else
      re += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  try {
    return new RegExp("^" + re + "$", flags);
  } catch {
    return /$^/;
  }
}
function matchesAny(name, globs, caseInsensitive = false) {
  return globs.some((g) => g && globToRegExp(g, caseInsensitive ? "i" : "").test(name));
}
function canonicalName(name) {
  return name.replace(/::\$DATA$/i, "").replace(/[ .]+$/, "") || name;
}
function isSecretName(name, secret, allow) {
  const n = canonicalName(name);
  if (matchesAny(n, allow, true))
    return false;
  return matchesAny(n, secret, true);
}
function isSecretPath(path) {
  return isSecretName(basename(path), cfgList("privacy.secret_globs"), cfgList("privacy.secret_allow_globs"));
}
function isSecretTarget(path) {
  if (isSecretPath(path))
    return true;
  try {
    return lstatSync(path).isSymbolicLink() && isSecretPath(realpathSync(path));
  } catch {
    return false;
  }
}
var KEY_NAME = /((?:password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)[^"'\s,;]{8,}/gi;
var QUOTED_DQ = /((?:token|password|passphrase|secret)"?\s*[:=]\s*")[^"]{6,}"/gi;
var QUOTED_SQ = /((?:token|password|passphrase|secret)'?\s*[:=]\s*')[^']{6,}'/gi;
function redact(text) {
  if (!cfgBool("privacy.redact", true))
    return text;
  return text.replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, "[REDACTED-AWS-KEY]").replace(/(gh[pousr]_)[A-Za-z0-9]{30,}/g, "$1[REDACTED]").replace(/github_pat_[A-Za-z0-9_]{30,}/g, "github_pat_[REDACTED]").replace(/glpat-[A-Za-z0-9_-]{20,}/g, "glpat-[REDACTED]").replace(/npm_[A-Za-z0-9]{36}/g, "npm_[REDACTED]").replace(/hf_[A-Za-z0-9]{30,}/g, "hf_[REDACTED]").replace(/((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{10,}/g, "$1[REDACTED]").replace(/(sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/g, "$1[REDACTED]").replace(/xox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[REDACTED]").replace(/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED-GOOGLE-KEY]").replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED-JWT]").replace(/(bearer[ \t]+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED]").replace(/(basic[ \t]+)[A-Za-z0-9+/=]{16,}/gi, "$1[REDACTED]").replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/g, "$1[REDACTED]@").replace(QUOTED_DQ, '$1[REDACTED]"').replace(QUOTED_SQ, "$1[REDACTED]'").replace(KEY_NAME, "$1[REDACTED]").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----\n?|$)/g, `[REDACTED PRIVATE KEY]
`);
}

export { configHome2, stateHome2, userConfigPath2, projectDir2, setProjectDir2, projectConfigPath2, warnings, resetConfig, ignoredProjectKeys, loadConfig, getPath, cfg, cfgStr, cfgInt, cfgBool, cfgList, writeConfigKey, setConfigValue, writeConfigFile, readConfigFile, globToRegExp, matchesAny, isSecretName, isSecretPath, isSecretTarget, redact };
