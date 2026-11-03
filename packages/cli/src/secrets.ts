import { lstatSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { cfgBool, cfgList } from "./config.ts";

/** Shell-style glob (*, ?, [..]) → RegExp, matched against a basename. */
export function globToRegExp(glob: string, flags = ""): RegExp {
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
  try {
    return new RegExp("^" + re + "$", flags);
  } catch {
    // a malformed user glob (e.g. "[z-a]") matches nothing instead of throwing
    return /$^/;
  }
}

export function matchesAny(name: string, globs: string[], caseInsensitive = false): boolean {
  return globs.some((g) => g && globToRegExp(g, caseInsensitive ? "i" : "").test(name));
}

/** A file name as the OS will resolve it: Windows ignores trailing dots/spaces
 * and the ::$DATA stream suffix (".env " and ".env::$DATA" open .env). */
function canonicalName(name: string): string {
  return name.replace(/::\$DATA$/i, "").replace(/[ .]+$/, "") || name;
}

/** Secret-file test for one path component (case-insensitive: macOS/Windows
 * file systems treat .ENV and .env as the same file). */
export function isSecretName(name: string, secret: string[], allow: string[]): boolean {
  const n = canonicalName(name);
  if (matchesAny(n, allow, true)) return false;
  return matchesAny(n, secret, true);
}

export function isSecretPath(path: string): boolean {
  return isSecretName(basename(path), cfgList("privacy.secret_globs"), cfgList("privacy.secret_allow_globs"));
}

/** A secret by its own name or by what it points to (notes.md -> .env). */
export function isSecretTarget(path: string): boolean {
  if (isSecretPath(path)) return true;
  try {
    return lstatSync(path).isSymbolicLink() && isSecretPath(realpathSync(path));
  } catch {
    return false;
  }
}

const KEY_NAME = /((?:password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)[^"'\s,;]{8,}/gi;
const QUOTED_DQ = /((?:token|password|passphrase|secret)"?\s*[:=]\s*")[^"]{6,}"/gi;
const QUOTED_SQ = /((?:token|password|passphrase|secret)'?\s*[:=]\s*')[^']{6,}'/gi;

/** Masks common credential shapes in text bound for a third-party model.
 * Same patterns as co_redact in lib/common.sh. */
export function redact(text: string): string {
  if (!cfgBool("privacy.redact", true)) return text;
  return text
    .replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, "[REDACTED-AWS-KEY]")
    .replace(/(gh[pousr]_)[A-Za-z0-9]{30,}/g, "$1[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]{30,}/g, "github_pat_[REDACTED]")
    .replace(/glpat-[A-Za-z0-9_-]{20,}/g, "glpat-[REDACTED]")
    .replace(/npm_[A-Za-z0-9]{36}/g, "npm_[REDACTED]")
    .replace(/hf_[A-Za-z0-9]{30,}/g, "hf_[REDACTED]")
    .replace(/((?:sk|rk)_(?:live|test)_)[A-Za-z0-9]{10,}/g, "$1[REDACTED]")
    .replace(/(sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/g, "$1[REDACTED]")
    .replace(/xox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED-GOOGLE-KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED-JWT]")
    .replace(/(bearer[ \t]+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED]")
    .replace(/(basic[ \t]+)[A-Za-z0-9+/=]{16,}/gi, "$1[REDACTED]")
    // the scheme starts where a run of scheme characters starts (as sed's leftmost match does):
    // without the lookbehind every letter of a long run was a start, quadratic on 100 KB of text
    .replace(/(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/g, "$1[REDACTED]@")
    .replace(QUOTED_DQ, '$1[REDACTED]"')
    .replace(QUOTED_SQ, "$1[REDACTED]'")
    .replace(KEY_NAME, "$1[REDACTED]")
    // a key cut off by a line range or an excerpt has no END line: mask to the end
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----\n?|$)/g, "[REDACTED PRIVATE KEY]\n");
}
