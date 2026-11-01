import { basename } from "node:path";
import { cfgBool, cfgList } from "./config.ts";

/** Shell-style glob (*, ?, [..]) → RegExp, matched against a basename. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const j = glob.indexOf("]", i + 1);
      if (j > i) {
        re += "[" + glob.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
        i = j;
      } else re += "\\[";
    } else re += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export function matchesAny(name: string, globs: string[]): boolean {
  return globs.some((g) => g && globToRegExp(g).test(name));
}

export function isSecretPath(path: string): boolean {
  const base = basename(path);
  if (matchesAny(base, cfgList("privacy.secret_allow_globs"))) return false;
  return matchesAny(base, cfgList("privacy.secret_globs"));
}

const KEY_NAME = /((?:password|passwd|secret|api_?key|access_?token)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)[^"'\s,;]{8,}/gi;

/** Masks common credential shapes in text bound for a third-party model. */
export function redact(text: string): string {
  if (!cfgBool("privacy.redact", true)) return text;
  let out = text
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED-AWS-KEY]")
    .replace(/(gh[pousr]_)[A-Za-z0-9]{30,}/g, "$1[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]{30,}/g, "github_pat_[REDACTED]")
    .replace(/(sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/g, "$1[REDACTED]")
    .replace(/xox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED-GOOGLE-KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED-JWT]")
    .replace(KEY_NAME, "$1[REDACTED]");
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----\n?/g, "[REDACTED PRIVATE KEY]\n");
  return out;
}
