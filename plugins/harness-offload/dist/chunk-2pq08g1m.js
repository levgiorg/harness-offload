import {
  OUTLINE
} from "./chunk-yrbt2j5y.js";
import {
  cfgInt2,
  cfgBool2,
  redact,
  fence
} from "./chunk-gh6zr0fa.js";
import {
  countLines,
  digitRuns,
  tokensOf,
  estTokensText,
  fmtInt,
  shquote,
  stripAnsi,
  truncate
} from "./chunk-gwdfekfb.js";
import {
  workDir2,
  appendStats2,
  pruneLogs2
} from "./chunk-xtyp4a5g.js";
import {
  invoke2
} from "./chunk-efswghxn.js";

// src/digest.ts
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
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
function* eachLine(text) {
  for (let start = 0;start < text.length; ) {
    let end = text.indexOf(`
`, start);
    if (end < 0)
      end = text.length;
    yield text.slice(start, end);
    start = end + 1;
  }
}
var BIG = 8 * 1024 * 1024;
var textSrc = (t) => ({ bytes: Buffer.byteLength(t), lines: () => eachLine(t), count: () => countLines(t), last: (n) => lastLines(t, n), whole: () => t });
function* fileLines(path) {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(1 << 20);
  const dec = new StringDecoder("utf8");
  let rest = "";
  try {
    for (;; ) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0)
        break;
      rest += dec.write(buf.subarray(0, n));
      let start = 0;
      for (let i = rest.indexOf(`
`);i >= 0; i = rest.indexOf(`
`, start)) {
        yield rest.slice(start, i);
        start = i + 1;
      }
      rest = rest.slice(start);
    }
    rest += dec.end();
    if (rest !== "")
      yield rest;
  } finally {
    closeSync(fd);
  }
}
function fileTail(path, size, max) {
  const len = Math.min(size, max);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  const t = buf.toString("utf8");
  return len < size ? t.slice(t.indexOf(`
`) + 1) : t;
}
function logSrc(path, given) {
  if (given !== undefined)
    return textSrc(given);
  const size = statSync(path).size;
  if (size <= BIG)
    return textSrc(readFileSync(path, "utf8"));
  return {
    bytes: size,
    lines: () => fileLines(path),
    count: () => {
      let n = 0;
      for (const _ of fileLines(path))
        n++;
      return n;
    },
    last: (n) => lastLines(fileTail(path, size, 1 << 20), n),
    whole: () => readFileSync(path, "utf8")
  };
}
var asSrc = (s) => typeof s === "string" ? textSrc(s) : s;
function lastLines(text, n) {
  if (!text || n <= 0)
    return [];
  const out = [];
  let end = text.endsWith(`
`) ? text.length - 1 : text.length;
  while (out.length < n) {
    const s = end > 0 ? text.lastIndexOf(`
`, end - 1) : -1;
    out.push(text.slice(s + 1, end));
    if (s < 0)
      break;
    end = s;
  }
  return out.reverse();
}
var FRAME_RE = /^[ \t]*(at |File "|\/)/;
var LIBFRAME_RE = /node_modules\/|site-packages\/|dist-packages\/|\/lib\/python[0-9.]*\/|<frozen |node:internal|\(node:|java\.base\/|jdk\.internal|at (java|javax|sun|jdk|kotlin|scala)\.|at org\.(junit|apache|gradle|springframework)\.|at junit\.|\/go\/src\/(runtime|testing)\/|\/rustc\//;
var STRONG_RE = /●|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|undefined reference|abort|killed|out of memory/;
function keyLines(src, max) {
  const kinds = new Map;
  const order = [];
  const seen = new Map;
  let libFrames = 0;
  let i = -1;
  for (const raw of asSrc(src).lines()) {
    i++;
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l))
      continue;
    if (FRAME_RE.test(raw) && LIBFRAME_RE.test(raw)) {
      libFrames++;
      continue;
    }
    const t = stripAnsi(raw).replace(/[ \t\r]+$/, "");
    if (!t)
      continue;
    const k = t.replace(/[0-9]+/g, "#");
    let kind = kinds.get(k);
    if (!kind) {
      kind = { count: 0, strong: STRONG_RE.test(l), lines: [], distinct: 0, take: 0 };
      kinds.set(k, kind);
      order.push(k);
    }
    kind.count++;
    if (seen.has(t))
      continue;
    seen.set(t, i + 1);
    kind.distinct++;
    if (kind.distinct <= 3)
      kind.lines.push(t);
  }
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
function keyTexts(src) {
  const seen = new Set;
  for (const raw of asSrc(src).lines()) {
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
function keyChanges(shown, cur0, prev0, at) {
  const cur = new Set(keyTexts(cur0));
  const prev = keyTexts(prev0);
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
function logExcerpt(src) {
  const S = asSrc(src);
  const hit = new Set;
  let total = 0;
  for (const l of S.lines()) {
    total++;
    const s = l.toLowerCase();
    if (KEY_RE.test(s) && !ZERO_RE.test(s))
      hit.add(total);
  }
  const out = [];
  let gap = 0;
  let kept = 0;
  let i = 0;
  for (const line of S.lines()) {
    i++;
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
      out.push(line);
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
function failBlocks(S, log, maxb, maxl, w) {
  const ind = (s) => /^[ \t]*/.exec(s)[0].length;
  const startKind = (s) => /^[ \t]*● /.test(s) ? "j" : /^[ \t]*FAIL[ \t]+[^ \t][^]* > /.test(s) ? "v" : /^___+ [^]* ___+[ \t]*$/.test(s) ? "p" : /^[ \t]*--- FAIL: /.test(s) ? "g" : /^---- [^]* stdout ----[ \t]*$/.test(s) ? "c" : "";
  const blank = (s) => /^[ \t]*$/.test(s);
  let kind = "", base = 0, first = 0, n = 0, last = 0, nb = 0, nr = 0;
  let b = [];
  const seen = new Set;
  const out = [];
  const cont = (s) => kind === "j" ? blank(s) || /^[ \t]/.test(s) : kind === "v" ? !blank(s) && !/^[ \t]*(Test Files|Tests|Duration|Start at|Snapshots) /.test(s) : kind === "p" ? !/^(___+ |===+)/.test(s) : kind === "g" ? !blank(s) && ind(s) > base : !blank(s);
  const flush = () => {
    if (!kind)
      return;
    n = last;
    if (!seen.has(b[0])) {
      seen.add(b[0]);
      nb++;
      if (nb <= maxb) {
        out.push(`L${first}: ${b[0].slice(0, w)}`);
        for (let k = 2;k <= n && k <= maxl; k++)
          out.push(b[k - 1].slice(0, w));
        if (n > maxl)
          out.push(`  … ${n - maxl} more lines: sed -n "${first + maxl},${first + n - 1}p" ${shquote(log)}`);
      }
    }
    kind = "";
    n = last = 0;
  };
  for (const raw of S.lines()) {
    nr++;
    const s = stripAnsi(raw).replace(/\r$/, "");
    const k = startKind(s);
    if (k === "g" && kind === "g" && last === 1 && ind(s) > base)
      kind = "";
    if (k) {
      flush();
      kind = k;
      base = ind(s);
      first = nr;
      n = last = 1;
      b = [s];
      continue;
    }
    if (!kind)
      continue;
    if (!cont(s)) {
      flush();
      continue;
    }
    n++;
    if (!blank(s))
      last = n;
    if (n <= maxl)
      b[n - 1] = s;
  }
  flush();
  if (!nb)
    return [];
  const res = [`── failures, verbatim (${nb}) ──`, ...out];
  if (nb > maxb)
    res.push(`… ${nb - maxb} more failures in the full log`);
  return res;
}
var STOP = new Set("the and for why what does how with from this that are was not did which where when there into its were have has had you your can could should would will just only also than then them they our out about after before over under".split(" "));
var asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
function intentWindows(S, question, w) {
  const terms = [];
  const seen = new Set;
  for (const r of asciiLower(question).split(/[^a-z0-9_]+/)) {
    if (!r || STOP.has(r) || seen.has(r))
      continue;
    if (/^[0-9]+$/.test(r))
      terms.push({ t: r, num: true });
    else if (r.length >= 3)
      terms.push({ t: r, num: false });
    else
      continue;
    seen.add(r);
  }
  let total = 0;
  const df = new Array(terms.length).fill(0);
  const cand = [];
  for (const line of S.lines()) {
    total++;
    if (!terms.length)
      continue;
    const tk = asciiLower(line).split(/[^a-z0-9_]+/);
    const hits = [];
    terms.forEach((term, k) => {
      if (tk.some((x) => term.num ? x === term.t : x.slice(0, term.t.length) === term.t)) {
        df[k]++;
        hits.push(k);
      }
    });
    if (hits.length)
      cand.push({ n: total, hits });
  }
  const sc = new Map;
  for (const c of cand)
    sc.set(c.n, c.hits.reduce((v, k) => v + Math.floor(total / df[k]), 0));
  const used = new Set;
  const win = [];
  for (let j = 0;j < 3; j++) {
    let best = 0;
    for (const c of cand)
      if (!used.has(c.n) && (!best || sc.get(c.n) > sc.get(best)))
        best = c.n;
    if (!best)
      break;
    const lo = Math.max(1, best - 2);
    const hi = Math.min(total, best + 4);
    win.push([lo, hi]);
    for (let n = lo - 2;n <= hi + 2; n++)
      used.add(n);
  }
  if (!win.length)
    return [];
  win.sort((a, b) => a[0] - b[0]);
  const out = [`── lines about the question (best ${win.length}, no model) ──`];
  let n = 0;
  for (const raw of S.lines()) {
    n++;
    for (const [lo, hi] of win) {
      if (n < lo || n > hi)
        continue;
      if (n === lo)
        out.push(`L${lo}-${hi}:`);
      out.push(stripAnsi(raw).replace(/\r$/, "").slice(0, w));
    }
  }
  return out;
}
function estTokensSrc(S) {
  let runs = 0;
  for (const l of S.lines())
    runs += digitRuns(l);
  return tokensOf(S.bytes, runs);
}
async function digest(log, rawLabel, code, focus, source, modelOverride, opts = {}) {
  const label = redact(rawLabel);
  const S = logSrc(log, opts.text);
  const lines = S.count();
  const bytes = S.bytes;
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
  const key = keyLines(S, keyMax);
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
      fence(redact(bytes <= maxIn ? S.whole() : logExcerpt(S))).replace(/\n$/, ""),
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
  const keySection = opts.prev && existsSync(opts.prev.log) ? keyChanges(key.lines, S, logSrc(opts.prev.log), opts.prev.at).map((l) => l.slice(0, width)) : key.distinct > 0 ? [`── key lines, verbatim (${key.distinct} distinct) ──`, ...key.lines.map((l) => l.slice(0, width))] : ["── no error-like lines found ──"];
  const failSection = compact ? failBlocks(S, log, 3, 6, width) : failBlocks(S, log, 5, 12, width);
  const intentSection = focus && source !== "hook" ? intentWindows(S, focus, width) : [];
  if (compact)
    out.push(...failSection, ...keySection, ...sumSection);
  else
    out.push(...sumSection, ...intentSection, ...failSection, ...keySection);
  if (!summary && !compact)
    tailN += 10;
  out.push(`── last ${tailN} lines ──`);
  out.push(...S.last(tailN).map((l) => stripAnsi(l).slice(0, width)));
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
    saved_tokens: Math.max(0, estTokensSrc(S) - estTokensText(result)),
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
function searchView(log, rawLabel, given) {
  const t0 = Date.now();
  const label = redact(rawLabel);
  const S = logSrc(log, given);
  const bytes = S.bytes;
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
  const first = [];
  const tail = [];
  let n = 0;
  let nm = 0;
  let np = 0;
  for (const raw of S.lines()) {
    const t = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r$/, "");
    if (t === "")
      continue;
    n++;
    if (first.length < 40)
      first.push(t);
    tail.push(t);
    if (tail.length > 10)
      tail.shift();
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
  const mode = nm * 10 >= n * 6 ? "m" : np * 10 >= n * 6 ? "d" : "l";
  const out = [];
  let head = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(S.count())} lines / ${kb} KB`;
  if (mode === "m")
    head += ` · ${fmtInt(nm)} matches in ${fmtInt(m.order.length)} files`;
  if (mode === "d")
    head += ` · ${fmtInt(np)} paths in ${fmtInt(d.order.length)} folders`;
  out.push(`${head} · full log: ${log}`);
  let topKeys = [];
  const list = (g, unit, what) => {
    const shown = Math.min(g.order.length, 20);
    const top = topKeys = g.order.map((k, i) => ({ k, i, c: g.cnt.get(k) })).sort((a, b) => b.c - a.c || a.i - b.i).slice(0, shown).map((x) => x.k);
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
    out.push(`── first ${Math.min(n, 40)} lines ──`, ...first.map(cut));
    if (n > 40)
      out.push(`── last ${Math.min(n - 40, 10)} lines ──`, ...tail.slice(-Math.min(n - 40, 10)).map(cut));
  }
  const asks = (mode !== "l" ? topKeys.slice(0, 3).map(shquote).join(" ") : "") || "FILE";
  out.push(`── narrow it: a path or a sharper pattern; counts: grep -c / rg -c; the rest: sed -n "START,ENDp" ${shquote(log)}; or ask: offload read -q "QUESTION" ${asks} ──`);
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
    saved_tokens: Math.max(0, estTokensSrc(logSrc(log, given)) - estTokensText(result)),
    seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: false,
    model_tried: false,
    worker_tokens_in: 0,
    worker_tokens_out: 0
  });
  pruneLogs2();
  return result;
}
function diffView(log, rawLabel, given) {
  const t0 = Date.now();
  const label = redact(rawLabel);
  const S = logSrc(log, given);
  const cut = (s) => s.length > 200 ? s.slice(0, 197) + "..." : s;
  const order = [];
  const add = new Map;
  const del = new Map;
  const hunks = new Map;
  let cur = "";
  let ta = 0;
  let td = 0;
  for (const l of S.lines()) {
    if (l.startsWith("diff --git ")) {
      cur = l.replace(/^diff --git a\/.* b\//, "");
      order.push(cur);
      add.set(cur, 0);
      del.set(cur, 0);
      hunks.set(cur, []);
      continue;
    }
    if (!cur || /^(\+\+\+|---) /.test(l))
      continue;
    if (l.startsWith("@@")) {
      const h = hunks.get(cur);
      if (h.length < 2)
        h.push(l);
    } else if (l.startsWith("+")) {
      add.set(cur, add.get(cur) + 1);
      ta++;
    } else if (l.startsWith("-")) {
      del.set(cur, del.get(cur) + 1);
      td++;
    }
  }
  const out = [];
  out.push(`[offload] \`${label.slice(0, 120)}\` · ${fmtInt(S.count())} lines / ${Math.ceil(S.bytes / 1024)} KB · ${fmtInt(order.length)} files, +${fmtInt(ta)} −${fmtInt(td)} · full log: ${log}`);
  const size = (f) => add.get(f) + del.get(f);
  const top = order.map((f, i) => ({ f, i })).sort((a, b) => size(b.f) - size(a.f) || a.i - b.i).slice(0, 20).map((x) => x.f);
  out.push("── files changed (busiest first) ──");
  for (const f of top)
    out.push(`${`+${add.get(f)}`.padStart(7)} ${`-${del.get(f)}`.padStart(7)}  ${cut(f)}`);
  if (order.length > top.length)
    out.push(`      … ${fmtInt(order.length - top.length)} more files`);
  out.push("── first changes in the busiest files ──");
  for (const f of top.slice(0, 8))
    for (const h of hunks.get(f))
      out.push(cut(`${f}: ${h}`));
  out.push(`── one file: git diff -- PATH (or sed -n "START,ENDp" ${shquote(log)}); totals: git diff --stat ──`);
  const result = out.join(`
`) + `
`;
  const bout = Buffer.byteLength(result);
  appendStats2({
    kind: "digest",
    source: "diff",
    label,
    log,
    model: "",
    bytes_in: S.bytes,
    bytes_out: bout,
    saved_tokens: Math.max(0, estTokensSrc(S) - estTokensText(result)),
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
    if (line.length > 90)
      line = line.slice(0, 87) + "...";
    rows.push({ n: idx + 1, txt: line, dep });
  });
  if (rows.length === 0)
    return "";
  const n = rows.length;
  const total = lines.length - (text.endsWith(`
`) ? 1 : 0);
  const to = rows.map((r, i) => {
    for (let j = i + 1;j < n; j++)
      if (rows[j].dep <= r.dep)
        return rows[j].n - 1;
    return total;
  });
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
  for (const [i, r] of rows.entries()) {
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
    out.push(to[i] > r.n ? `  L${r.n}-${to[i]}: ${r.txt}` : `  L${r.n}: ${r.txt}`);
  }
  if (out.length < n)
    out.push(`  ... ${n - out.length} more symbols not shown (grep -n to find them)`);
  return out.join(`
`) + `
`;
}
function symbolRange2(path, name) {
  if (!/^[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*$/.test(name))
    return;
  const part = name.split(".");
  let k = 0;
  let lo = 0;
  let hi = Infinity;
  for (const line of outline2(path, 1e5).split(`
`)) {
    const m = /^ {2}L(\d+)(?:-(\d+))?: /.exec(line);
    if (!m)
      continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < lo || a > hi)
      continue;
    const w = part[k].replace(/\$/g, "[$]");
    if (new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(line.slice(m[0].length))) {
      if (k === part.length - 1)
        return [a, b];
      k++;
      lo = a + 1;
      hi = b;
    }
  }
  return;
}

export { BIG, textSrc, logSrc, digest, isSmall, searchView, diffView, posixToJs2, outline2, symbolRange2 };
