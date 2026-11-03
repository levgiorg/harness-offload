import {
  OUTLINE
} from "./chunk-tned9mwv.js";
import {
  cfgInt2,
  cfgBool2,
  redact
} from "./chunk-ef4mr3b8.js";
import {
  countLines,
  fmtInt,
  shquote,
  stripAnsi,
  truncate
} from "./chunk-cmz9w18w.js";
import {
  workDir2,
  appendStats2,
  pruneLogs2
} from "./chunk-6m0yhkpr.js";
import {
  invoke2
} from "./chunk-vds884vc.js";

// src/digest.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
var KEY_RE = /[a-z0-9_)\/-][.][a-z][a-z]*:[0-9][0-9]*|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|cannot |can.t |undefined reference|no such file|permission denied|timed out|timeout|unresolved|not found|denied|refused|abort|killed|out of memory|oom|●|^\s*(expected|received):/;
var ZERO_RE = /(^|[^0-9])0 (errors?|failures?|failed|problems?)|(errors?|failures?|failed)\s*[:=]\s*0([^0-9]|$)|no errors|without errors|0 vulnerabilities/;
var splitLines = (text) => {
  const l = text.split(`
`);
  if (text.endsWith(`
`))
    l.pop();
  return l;
};
var FRAME_RE = /^[ \t]*(at |File "|\/)/;
var LIBFRAME_RE = /node_modules\/|site-packages\/|dist-packages\/|\/lib\/python[0-9.]*\/|<frozen |node:internal|\(node:|java\.base\/|jdk\.internal|at (java|javax|sun|jdk|kotlin|scala)\.|at org\.(junit|apache|gradle|springframework)\.|at junit\.|\/go\/src\/(runtime|testing)\/|\/rustc\//;
var STRONG_RE = /●|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|undefined reference|abort|killed|out of memory/;
function keyLines(text, max) {
  const kinds = new Map;
  const order = [];
  const seen = new Map;
  let libFrames = 0;
  splitLines(text).forEach((raw, i) => {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l))
      return;
    if (FRAME_RE.test(raw) && LIBFRAME_RE.test(raw)) {
      libFrames++;
      return;
    }
    const t = stripAnsi(raw).replace(/[ \t\r]+$/, "");
    if (!t)
      return;
    const k = t.replace(/[0-9]+/g, "#");
    let kind = kinds.get(k);
    if (!kind) {
      kind = { count: 0, strong: STRONG_RE.test(l), lines: [], distinct: 0, take: 0 };
      kinds.set(k, kind);
      order.push(k);
    }
    kind.count++;
    if (seen.has(t))
      return;
    seen.set(t, i + 1);
    kind.distinct++;
    if (kind.distinct <= 3)
      kind.lines.push(t);
  });
  let left = max;
  for (const strongPass of [true, false])
    for (const k of order) {
      if (left <= 0)
        break;
      const kind = kinds.get(k);
      if (kind.strong !== strongPass)
        continue;
      kind.take = Math.min(strongPass ? 3 : 1, kind.distinct, left);
      left -= kind.take;
    }
  const picked = [];
  for (const k of order) {
    const kind = kinds.get(k);
    kind.lines.slice(0, kind.take).forEach((t, j) => {
      let s = truncate(t, 240);
      const last = j === kind.take - 1;
      if (last && kind.distinct === 1 && kind.count > 1)
        s += `  (x${kind.count})`;
      else if (last && kind.distinct > 1 && kind.count > kind.take)
        s += `  (${kind.count} similar lines)`;
      picked.push({ n: seen.get(t), s });
    });
  }
  picked.sort((a, b) => a.n - b.n);
  const out = picked.map((p) => `L${p.n}: ${p.s}`);
  if (seen.size > picked.length)
    out.push(`... ${seen.size - picked.length} more distinct matching lines`);
  if (libFrames > 0)
    out.push(`... ${libFrames} stack frames in libraries and the runtime left out`);
  return { lines: out, distinct: seen.size };
}
function keyTexts(text) {
  const seen = new Set;
  for (const raw of splitLines(text)) {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l))
      continue;
    if (FRAME_RE.test(raw) && LIBFRAME_RE.test(raw))
      continue;
    const t = truncate(stripAnsi(raw).replace(/[ \t\r]+$/, ""), 240);
    if (t)
      seen.add(t);
  }
  return [...seen];
}
function keyChanges(shown, text, prevText, at) {
  const cur = new Set(keyTexts(text));
  const prev = keyTexts(prevText);
  const P = new Set(prev);
  const fresh = [];
  let same = 0;
  for (const l of shown) {
    if (!/^L\d+: /.test(l))
      continue;
    const t = l.replace(/^L\d+: /, "").replace(/  \(x\d+\)$/, "").replace(/  \(\d+ similar lines\)$/, "");
    if (P.has(t))
      same++;
    else
      fresh.push(l);
  }
  const gone = prev.filter((t) => !cur.has(t));
  const out = [`── key lines since the run at ${at}: ${fresh.length} new, ${same} unchanged, ${gone.length} gone ──`, ...fresh];
  if (!fresh.length)
    out.push("(no new error-like lines)");
  if (gone.length) {
    out.push("gone since then:", ...gone.slice(0, 5).map((t) => `  - ${t}`));
    if (gone.length > 5)
      out.push(`  … ${gone.length - 5} more`);
  }
  return out;
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
  let keyMax = cfgInt2("digest.key_lines", 30);
  let tailN = cfgInt2("digest.tail_lines", 15);
  let sumMax = 40;
  let width = 300;
  if (compact) {
    keyMax = 10;
    tailN = 4;
    sumMax = 10;
    width = 150;
  }
  const maxIn = cfgInt2("digest.max_model_input_bytes", 400000);
  const t0 = Date.now();
  const key = keyLines(text, keyMax);
  let summary = "";
  let note = "";
  let model = "";
  let tin = 0;
  let tout = 0;
  const tried = cfgBool2("digest.use_model", true) && !opts.noModel && process.env.OFFLOAD_NO_MODEL !== "1";
  if (tried) {
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
  const keySection = opts.prev && existsSync(opts.prev.log) ? keyChanges(key.lines, text, readFileSync(opts.prev.log, "utf8"), opts.prev.at).map((l) => l.slice(0, width)) : key.distinct > 0 ? [`── key lines, verbatim (${key.distinct} distinct) ──`, ...key.lines.map((l) => l.slice(0, width))] : ["── no error-like lines found ──"];
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
    log,
    model,
    bytes_in: bytes,
    bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)),
    seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: Boolean(summary),
    model_tried: tried,
    worker_tokens_in: tin,
    worker_tokens_out: tout
  });
  pruneLogs2();
  return result;
}
function isSmall(text) {
  return countLines(text) <= cfgInt2("digest.threshold_lines", 150) && Buffer.byteLength(text) <= cfgInt2("digest.threshold_bytes", 12000);
}
function searchView(log, rawLabel) {
  const t0 = Date.now();
  const label = redact(rawLabel);
  const text = readFileSync(log, "utf8");
  const bytes = Buffer.byteLength(text);
  const kb = Math.ceil(bytes / 1024);
  const cut = (s) => s.length > 200 ? s.slice(0, 197) + "..." : s;
  const pathy = (p) => p !== "" && !/[ \t]/.test(p) && (p.includes("/") || /\.[A-Za-z0-9]+$/.test(p));
  const groups = () => ({ order: [], cnt: new Map, first: new Map });
  const add = (g, key, line) => {
    const c = g.cnt.get(key) ?? 0;
    if (c === 0) {
      g.order.push(key);
      g.first.set(key, []);
    }
    g.cnt.set(key, c + 1);
    if (c < 2)
      g.first.get(key).push(line);
  };
  const m = groups();
  const d = groups();
  const all = [];
  let nm = 0;
  let np = 0;
  for (const raw of splitLines(text)) {
    const t = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r$/, "");
    if (t === "")
      continue;
    all.push(t);
    const c = t.indexOf(":");
    const p = c > 0 ? t.slice(0, c) : "";
    if (pathy(p)) {
      nm++;
      add(m, p, t);
    } else if (pathy(t)) {
      np++;
      const slash = t.lastIndexOf("/");
      add(d, slash >= 0 ? t.slice(0, slash) : ".", t);
    }
  }
  const n = all.length;
  const mode = nm * 10 >= n * 6 ? "m" : np * 10 >= n * 6 ? "d" : "l";
  const out = [];
  let head = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(countLines(text))} lines / ${kb} KB`;
  if (mode === "m")
    head += ` · ${fmtInt(nm)} matches in ${fmtInt(m.order.length)} files`;
  if (mode === "d")
    head += ` · ${fmtInt(np)} paths in ${fmtInt(d.order.length)} folders`;
  out.push(`${head} · full log: ${log}`);
  const list = (g, unit, what) => {
    const shown = Math.min(g.order.length, 20);
    const top = g.order.map((k, i) => ({ k, i, c: g.cnt.get(k) })).sort((a, b) => b.c - a.c || a.i - b.i).slice(0, shown).map((x) => x.k);
    out.push(`── ${what} per ${unit} (${fmtInt(g.order.length)} ${unit}s) ──`);
    for (const k of top)
      out.push(`${String(g.cnt.get(k)).padStart(7)}  ${cut(k)}`);
    if (g.order.length > shown) {
      const chosen = new Set(top);
      const rest = g.order.filter((k) => !chosen.has(k)).reduce((s, k) => s + g.cnt.get(k), 0);
      out.push(`      … ${fmtInt(g.order.length - shown)} more ${unit}s, ${fmtInt(rest)} ${what}`);
    }
    out.push(`── first ${what} in the top ${Math.min(shown, 10)} ${unit}s ──`);
    for (const k of top.slice(0, 10))
      for (const l of g.first.get(k))
        out.push(cut(l));
  };
  if (mode === "m")
    list(m, "file", "matches");
  else if (mode === "d")
    list(d, "folder", "paths");
  else {
    out.push(`── first ${Math.min(n, 40)} lines ──`, ...all.slice(0, 40).map(cut));
    if (n > 40)
      out.push(`── last ${Math.min(n - 40, 10)} lines ──`, ...all.slice(Math.max(n - 10, 40)).map(cut));
  }
  out.push(`── narrow it: a path or a sharper pattern; counts: grep -c / rg -c; the rest: sed -n "START,ENDp" ${shquote(log)}; or ask: offload read -q "QUESTION" FILE ──`);
  const result = out.join(`
`) + `
`;
  const bout = Buffer.byteLength(result);
  appendStats2({
    kind: "digest",
    source: "search",
    label,
    log,
    model: "",
    bytes_in: bytes,
    bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)),
    seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: false,
    model_tried: false,
    worker_tokens_in: 0,
    worker_tokens_out: 0
  });
  pruneLogs2();
  return result;
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

export { digest, isSmall, searchView, posixToJs2, outline2 };
