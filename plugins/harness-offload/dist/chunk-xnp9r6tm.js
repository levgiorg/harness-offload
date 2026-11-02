import {
  OUTLINE
} from "./chunk-25ca7170.js";
import {
  cfgInt,
  cfgBool,
  redact
} from "./chunk-djerf2vs.js";
import {
  countLines,
  fmtInt,
  shquote,
  stripAnsi,
  truncate
} from "./chunk-5at3kbd8.js";
import {
  workDir2,
  appendStats2,
  pruneLogs2
} from "./chunk-d1jn8t5x.js";
import {
  invoke2
} from "./chunk-vvzeww8q.js";

// src/digest.ts
import { readFileSync, writeFileSync } from "node:fs";
var KEY_RE = /[a-z0-9_)\/-][.][a-z][a-z]*:[0-9][0-9]*|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|cannot |can.t |undefined reference|no such file|permission denied|timed out|timeout|unresolved|not found|denied|refused|abort|killed|out of memory|oom/;
var ZERO_RE = /(^|[^0-9])0 (errors?|failures?|failed|problems?)|(errors?|failures?|failed)\s*[:=]\s*0([^0-9]|$)|no errors|without errors|0 vulnerabilities/;
var splitLines = (text) => {
  const l = text.split(`
`);
  if (text.endsWith(`
`))
    l.pop();
  return l;
};
function keyLines(text, max) {
  const seen = new Map;
  const order = [];
  splitLines(text).forEach((raw, i) => {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l))
      return;
    const t = stripAnsi(raw).replace(/[ \t\r]+$/, "");
    if (!t)
      return;
    const s = seen.get(t);
    if (s)
      s.rep++;
    else {
      seen.set(t, { n: i + 1, rep: 1 });
      order.push(t);
    }
  });
  const out = order.slice(0, max).map((t) => {
    const s = seen.get(t);
    return `L${s.n}: ${truncate(t, 240)}${s.rep > 1 ? `  (x${s.rep})` : ""}`;
  });
  if (order.length > max)
    out.push(`... ${order.length - max} more distinct matching lines`);
  return { lines: out, distinct: order.length };
}
function logExcerpt(text) {
  const lines = splitLines(text);
  const total = lines.length;
  const hit = new Set;
  lines.forEach((l, i) => {
    const s = l.toLowerCase();
    if (KEY_RE.test(s) && !ZERO_RE.test(s))
      hit.add(i + 1);
  });
  const out = [];
  let gap = 0;
  let kept = 0;
  for (let i = 1;i <= total; i++) {
    let keep = i <= 150 || i > total - 300;
    if (!keep) {
      for (let j = i - 2;j <= i + 2; j++)
        if (hit.has(j))
          keep = true;
    }
    if (keep && kept < 1500) {
      if (gap)
        out.push(`[... ${gap} lines omitted ...]`);
      gap = 0;
      out.push(lines[i - 1]);
      kept++;
    } else
      gap++;
  }
  if (gap)
    out.push(`[... ${gap} lines omitted ...]`);
  return out.join(`
`) + `
`;
}
async function digest(log, rawLabel, code, focus, source, modelOverride, opts = {}) {
  const label = redact(rawLabel);
  const text = readFileSync(log, "utf8");
  const lines = countLines(text);
  const bytes = Buffer.byteLength(text);
  const kb = Math.ceil(bytes / 1024);
  const compact = opts.compact ?? process.env.OFFLOAD_DIGEST_COMPACT === "1";
  let keyMax = cfgInt("digest.key_lines", 30);
  let tailN = cfgInt("digest.tail_lines", 15);
  let sumMax = 40;
  let width = 300;
  if (compact) {
    keyMax = 10;
    tailN = 4;
    sumMax = 10;
    width = 150;
  }
  const maxIn = cfgInt("digest.max_model_input_bytes", 400000);
  const t0 = Date.now();
  const key = keyLines(text, keyMax);
  let summary = "";
  let note = "";
  let model = "";
  let tin = 0;
  let tout = 0;
  if (cfgBool("digest.use_model", true) && !opts.noModel && process.env.OFFLOAD_NO_MODEL !== "1") {
    const prompt = [
      `<command>${label}</command>`,
      code ? `<exit_code>${code}</exit_code>` : "",
      focus ? `<focus>${focus}</focus>` : "",
      `<output lines="${lines}" bytes="${bytes}">`,
      redact(bytes <= maxIn ? text : logExcerpt(text)).replace(/\n$/, ""),
      "</output>"
    ].filter((s) => s !== "").join(`
`);
    try {
      const r = await invoke2("summarize", prompt + `
`, workDir2(), modelOverride, { budgetSec: opts.budgetSec });
      summary = splitLines(r.text).slice(0, sumMax).map((l) => truncate(l, width)).join(`
`);
      note = model = r.model;
      tin = r.tokensIn;
      tout = r.tokensOut;
    } catch (e) {
      note = `unavailable: ${String(e.message).split(`
`).slice(0, 2).join(" ").slice(0, 200)}`;
    }
  }
  const out = [];
  out.push(`[offload] \`${label.slice(0, 120)}\`${code ? ` → exit ${code}` : ""} · ${fmtInt(lines)} lines / ${kb} KB · full log: ${log}`);
  const sumSection = summary ? [`── summary by ${note} (cheap model; trust the verbatim lines over it) ──`, summary] : note ? [`── model summary ${note} ──`] : [];
  const keySection = key.distinct > 0 ? [`── key lines, verbatim (${key.distinct} distinct) ──`, ...key.lines.map((l) => l.slice(0, width))] : ["── no error-like lines found ──"];
  if (compact)
    out.push(...keySection, ...sumSection);
  else
    out.push(...sumSection, ...keySection);
  if (!summary && !compact)
    tailN += 10;
  out.push(`── last ${tailN} lines ──`);
  out.push(...splitLines(text).slice(-tailN).map((l) => stripAnsi(l).slice(0, width)));
  out.push(`── more: grep -n -iE "error|fail" ${shquote(log)} | head -50   ·   sed -n "START,ENDp" ${shquote(log)}`);
  const result = out.join(`
`) + `
`;
  const bout = Buffer.byteLength(result);
  appendStats2({
    kind: "digest",
    source,
    label,
    model,
    bytes_in: bytes,
    bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)),
    seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: Boolean(summary),
    worker_tokens_in: tin,
    worker_tokens_out: tout
  });
  pruneLogs2();
  return result;
}
function isSmall(text) {
  return countLines(text) <= cfgInt("digest.threshold_lines", 150) && Buffer.byteLength(text) <= cfgInt("digest.threshold_bytes", 12000);
}

// src/outline.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { basename } from "node:path";
var CLASSES = {
  space: "\\s",
  alpha: "A-Za-z",
  digit: "0-9",
  alnum: "A-Za-z0-9",
  upper: "A-Z",
  lower: "a-z",
  xdigit: "0-9A-Fa-f",
  punct: "!-\\/:-@\\[-`{-~",
  blank: " \\t"
};
function posixToJs2(ere) {
  let out = "";
  for (let i = 0;i < ere.length; i++) {
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
    let j = i + 1;
    let neg = false;
    if (ere[j] === "^") {
      neg = true;
      j++;
    }
    let body = "";
    let first = true;
    for (;j < ere.length; j++) {
      const d = ere[j];
      if (d === "]" && !first)
        break;
      if (d === "[" && ere[j + 1] === ":") {
        const end = ere.indexOf(":]", j + 2);
        if (end > 0) {
          body += CLASSES[ere.slice(j + 2, end)] ?? "";
          j = end + 1;
          first = false;
          continue;
        }
      }
      if (d === "]" || d === "[" || d === "\\")
        body += "\\" + d;
      else
        body += d;
      first = false;
    }
    out += "[" + (neg ? "^" : "") + body + "]";
    i = j;
  }
  return out;
}
var SPEC = OUTLINE;
function outlineRegex(path, firstLine = "") {
  const base = basename(path).toLowerCase();
  let ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  if (!ext && firstLine.startsWith("#!")) {
    if (/python/.test(firstLine))
      ext = "py";
    else if (/node|deno|bun/.test(firstLine))
      ext = "js";
    else if (/ruby/.test(firstLine))
      ext = "rb";
    else if (/sh/.test(firstLine))
      ext = "sh";
  }
  const lang = SPEC.languages.find((l) => l.exts.includes(ext));
  return new RegExp(posixToJs2(lang ? lang.regex : SPEC.default));
}
var CONTROL = /^(if|for|while|switch|catch|return|else|do|try|with|elif|except|match|when|case|new|await|throw|yield)[^A-Za-z0-9_]/;
function outline2(path, max = 50) {
  let text;
  try {
    text = readFileSync2(path, "utf8");
  } catch {
    return "";
  }
  const lines = text.split(`
`);
  const re = outlineRegex(path, lines[0] ?? "");
  const rows = [];
  lines.forEach((raw, idx) => {
    if (!re.test(raw))
      return;
    let line = raw.replace(/\t/g, "    ");
    const m = line.match(/[^ ]/);
    const dep = m && m.index !== undefined ? m.index : 0;
    line = line.replace(/^ +/, "");
    if (CONTROL.test(line))
      return;
    line = line.replace(/[ \t]*\{?[ \t\r]*$/, "");
    if (line.length > 110)
      line = line.slice(0, 107) + "...";
    rows.push({ n: idx + 1, txt: line, dep });
  });
  if (rows.length === 0)
    return "";
  const n = rows.length;
  let lim = Math.max(...rows.map((r) => r.dep));
  while (lim > 0) {
    const lower = rows.filter((r) => r.dep < lim).map((r) => r.dep);
    if (lower.length === 0)
      break;
    const nl = Math.max(...lower);
    if (rows.filter((r) => r.dep <= lim).length <= max)
      break;
    if (rows.filter((r) => r.dep <= nl).length < max / 2)
      break;
    lim = nl;
  }
  const fixed = rows.filter((r) => r.dep < lim).length;
  const deep = rows.filter((r) => r.dep === lim).length;
  const room = Math.max(1, max - fixed);
  const stride = deep > room ? deep / room : 1;
  const out = [];
  let k = 0;
  let nextPick = 0;
  for (const r of rows) {
    if (r.dep > lim)
      continue;
    if (r.dep === lim) {
      k++;
      if (k - 1 < nextPick)
        continue;
      nextPick += stride;
    }
    if (out.length >= max)
      break;
    out.push(`  L${r.n}: ${r.txt}`);
  }
  if (out.length < n)
    out.push(`  ... ${n - out.length} more symbols not shown (grep -n to find them)`);
  return out.join(`
`) + `
`;
}

export { digest, isSmall, posixToJs2, outline2 };
