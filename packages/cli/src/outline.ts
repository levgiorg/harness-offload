import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { OUTLINE } from "./assets.ts";

const CLASSES: Record<string, string> = {
  space: "\\s", alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z",
  xdigit: "0-9A-Fa-f", punct: "!-\\/:-@\\[-`{-~", blank: " \\t",
};

/** Converts a POSIX ERE (as used with grep -E) into a JS RegExp source. */
export function posixToJs(ere: string): string {
  let out = "";
  for (let i = 0; i < ere.length; i++) {
    const c = ere[i];
    if (c === "\\") {
      out += c + (ere[i + 1] ?? "");
      i++;
      continue;
    }
    if (c !== "[") {
      out += c;
      continue;
    }
    // bracket expression
    let j = i + 1;
    let neg = false;
    if (ere[j] === "^") {
      neg = true;
      j++;
    }
    let body = "";
    let first = true;
    for (; j < ere.length; j++) {
      const d = ere[j];
      if (d === "]" && !first) break;
      if (d === "[" && ere[j + 1] === ":") {
        const end = ere.indexOf(":]", j + 2);
        if (end > 0) {
          body += CLASSES[ere.slice(j + 2, end)] ?? "";
          j = end + 1;
          first = false;
          continue;
        }
      }
      if (d === "]" || d === "[" || d === "\\") body += "\\" + d;
      else body += d;
      first = false;
    }
    out += "[" + (neg ? "^" : "") + body + "]";
    i = j;
  }
  return out;
}

const SPEC = OUTLINE;

export function outlineRegex(path: string, firstLine = ""): RegExp {
  const base = basename(path).toLowerCase();
  let ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  if (!ext && firstLine.startsWith("#!")) {
    if (/python/.test(firstLine)) ext = "py";
    else if (/node|deno|bun/.test(firstLine)) ext = "js";
    else if (/ruby/.test(firstLine)) ext = "rb";
    else if (/sh/.test(firstLine)) ext = "sh";
  }
  const lang = SPEC.languages.find((l) => l.exts.includes(ext));
  return new RegExp(posixToJs(lang ? lang.regex : SPEC.default));
}

const CONTROL = /^(if|for|while|switch|catch|return|else|do|try|with|elif|except|match|when|case|new|await|throw|yield)[^A-Za-z0-9_]/;

/** Same output and depth-sampling rules as the bash engine. */
export function outline(path: string, max = 50): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const re = outlineRegex(path, lines[0] ?? "");
  const rows: { n: number; txt: string; dep: number }[] = [];
  lines.forEach((raw, idx) => {
    if (!re.test(raw)) return;
    let line = raw.replace(/\t/g, "    ");
    const m = line.match(/[^ ]/);
    const dep = m && m.index !== undefined ? m.index : 0;
    line = line.replace(/^ +/, "");
    if (CONTROL.test(line)) return;
    line = line.replace(/[ \t]*\{?[ \t\r]*$/, "");
    if (line.length > 110) line = line.slice(0, 107) + "...";
    rows.push({ n: idx + 1, txt: line, dep });
  });
  if (rows.length === 0) return "";
  const n = rows.length;
  let lim = Math.max(...rows.map((r) => r.dep));
  while (lim > 0) {
    const lower = rows.filter((r) => r.dep < lim).map((r) => r.dep);
    if (lower.length === 0) break;
    const nl = Math.max(...lower);
    if (rows.filter((r) => r.dep <= lim).length <= max) break;
    if (rows.filter((r) => r.dep <= nl).length < max / 2) break;
    lim = nl;
  }
  const fixed = rows.filter((r) => r.dep < lim).length;
  const deep = rows.filter((r) => r.dep === lim).length;
  const room = Math.max(1, max - fixed);
  const stride = deep > room ? deep / room : 1;
  const out: string[] = [];
  let k = 0;
  let nextPick = 0;
  for (const r of rows) {
    if (r.dep > lim) continue;
    if (r.dep === lim) {
      k++;
      if (k - 1 < nextPick) continue;
      nextPick += stride;
    }
    if (out.length >= max) break;
    out.push(`  L${r.n}: ${r.txt}`);
  }
  if (out.length < n) out.push(`  ... ${n - out.length} more symbols not shown (grep -n to find them)`);
  return out.join("\n") + "\n";
}
