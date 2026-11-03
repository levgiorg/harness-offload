import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cfgBool, cfgInt } from "./config.ts";
import { invoke } from "./engine.ts";
import { WorkerError } from "./backends/types.ts";
import { redact } from "./secrets.ts";
import { appendStats, pruneLogs, workDir } from "./state.ts";
import { countLines, fmtInt, shquote, stripAnsi, truncate } from "./text.ts";

const KEY_RE = /[a-z0-9_)\/-][.][a-z][a-z]*:[0-9][0-9]*|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|cannot |can.t |undefined reference|no such file|permission denied|timed out|timeout|unresolved|not found|denied|refused|abort|killed|out of memory|oom|●|^\s*(expected|received):/;
const ZERO_RE = /(^|[^0-9])0 (errors?|failures?|failed|problems?)|(errors?|failures?|failed)\s*[:=]\s*0([^0-9]|$)|no errors|without errors|0 vulnerabilities/;

const splitLines = (text: string): string[] => {
  const l = text.split("\n");
  if (text.endsWith("\n")) l.pop();
  return l;
};

/** Stack frames in libraries, test runners and the runtime: they fill key lines and say
 *  nothing about the project's code, so they are counted, not shown. Twin: digest.sh. */
const FRAME_RE = /^[ \t]*(at |File "|\/)/;
const LIBFRAME_RE = /node_modules\/|site-packages\/|dist-packages\/|\/lib\/python[0-9.]*\/|<frozen |node:internal|\(node:|java\.base\/|jdk\.internal|at (java|javax|sun|jdk|kotlin|scala)\.|at org\.(junit|apache|gradle|springframework)\.|at junit\.|\/go\/src\/(runtime|testing)\/|\/rustc\//;

/** Of the key lines, the ones that mean something broke. */
const STRONG_RE = /●|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|undefined reference|abort|killed|out of memory/;

/** "L<n>: text" for matching lines. Lines that differ only in numbers are one kind
 *  ("(N similar lines)"; exact repeats "(xN)"), so 600 warnings can't push a real error
 *  out: error-like kinds get the slots first (up to 3 lines each), the rest one line
 *  each; then they print in log order. Twin: co_key_lines in digest.sh. */
export function keyLines(text: string, max: number): { lines: string[]; distinct: number } {
  type Kind = { count: number; strong: boolean; lines: string[]; distinct: number; take: number };
  const kinds = new Map<string, Kind>();
  const order: string[] = [];
  const seen = new Map<string, number>();
  let libFrames = 0;
  splitLines(text).forEach((raw, i) => {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l)) return;
    if (FRAME_RE.test(raw) && LIBFRAME_RE.test(raw)) {
      libFrames++;
      return;
    }
    const t = stripAnsi(raw).replace(/[ \t\r]+$/, "");
    if (!t) return;
    const k = t.replace(/[0-9]+/g, "#");
    let kind = kinds.get(k);
    if (!kind) {
      kind = { count: 0, strong: STRONG_RE.test(l), lines: [], distinct: 0, take: 0 };
      kinds.set(k, kind);
      order.push(k);
    }
    kind.count++;
    if (seen.has(t)) return;
    seen.set(t, i + 1);
    kind.distinct++;
    if (kind.distinct <= 3) kind.lines.push(t);
  });
  let left = max;
  for (const strongPass of [true, false])
    for (const k of order) {
      if (left <= 0) break;
      const kind = kinds.get(k)!;
      if (kind.strong !== strongPass) continue;
      kind.take = Math.min(strongPass ? 3 : 1, kind.distinct, left);
      left -= kind.take;
    }
  const picked: { n: number; s: string }[] = [];
  for (const k of order) {
    const kind = kinds.get(k)!;
    kind.lines.slice(0, kind.take).forEach((t, j) => {
      let s = truncate(t, 240);
      const last = j === kind.take - 1;
      if (last && kind.distinct === 1 && kind.count > 1) s += `  (x${kind.count})`;
      else if (last && kind.distinct > 1 && kind.count > kind.take) s += `  (${kind.count} similar lines)`;
      picked.push({ n: seen.get(t)!, s });
    });
  }
  picked.sort((a, b) => a.n - b.n);
  const out = picked.map((p) => `L${p.n}: ${p.s}`);
  if (seen.size > picked.length) out.push(`... ${seen.size - picked.length} more distinct matching lines`);
  if (libFrames > 0) out.push(`... ${libFrames} stack frames in libraries and the runtime left out`);
  return { lines: out, distinct: seen.size };
}

/** Every distinct key-line text (same filters and truncation as keyLines), in log order:
 *  what a later run is compared with. Twin: co_key_texts. */
export function keyTexts(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of splitLines(text)) {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l)) continue;
    if (FRAME_RE.test(raw) && LIBFRAME_RE.test(raw)) continue;
    const t = truncate(stripAnsi(raw).replace(/[ \t\r]+$/, ""), 240);
    if (t) seen.add(t);
  }
  return [...seen];
}

/** The key-line section of a re-run: only lines new since the previous run, with counts of
 *  unchanged and gone ones (the first gone ones: what was fixed). Twin: co_key_changes. */
export function keyChanges(shown: string[], text: string, prevText: string, at: string): string[] {
  const cur = new Set(keyTexts(text));
  const prev = keyTexts(prevText);
  const P = new Set(prev);
  const fresh: string[] = [];
  let same = 0;
  for (const l of shown) {
    if (!/^L\d+: /.test(l)) continue;
    const t = l.replace(/^L\d+: /, "").replace(/  \(x\d+\)$/, "").replace(/  \(\d+ similar lines\)$/, "");
    if (P.has(t)) same++;
    else fresh.push(l);
  }
  const gone = prev.filter((t) => !cur.has(t));
  const out = [`── key lines since the run at ${at}: ${fresh.length} new, ${same} unchanged, ${gone.length} gone ──`, ...fresh];
  if (!fresh.length) out.push("(no new error-like lines)");
  if (gone.length) {
    out.push("gone since then:", ...gone.slice(0, 5).map((t) => `  - ${t}`));
    if (gone.length > 5) out.push(`  … ${gone.length - 5} more`);
  }
  return out;
}

export function logExcerpt(text: string): string {
  const lines = splitLines(text);
  const total = lines.length;
  const hit = new Set<number>();
  lines.forEach((l, i) => {
    const s = l.toLowerCase();
    if (KEY_RE.test(s) && !ZERO_RE.test(s)) hit.add(i + 1);
  });
  const out: string[] = [];
  let gap = 0;
  let kept = 0;
  for (let i = 1; i <= total; i++) {
    let keep = i <= 150 || i > total - 300;
    if (!keep) for (let j = i - 2; j <= i + 2; j++) if (hit.has(j)) keep = true;
    if (keep && kept < 1500) {
      if (gap) out.push(`[... ${gap} lines omitted ...]`);
      gap = 0;
      out.push(lines[i - 1]);
      kept++;
    } else gap++;
  }
  if (gap) out.push(`[... ${gap} lines omitted ...]`);
  return out.join("\n") + "\n";
}

/** Digest of a log file; same layout as the bash engine. */
export interface DigestOptions {
  /** Deterministic digest only (no worker model). */
  noModel?: boolean;
  /** Smaller sections (the host already showed a preview). */
  compact?: boolean;
  /** Total seconds the model summary may take (fallbacks included). */
  budgetSec?: number;
  /** The same command's previous log in this session (a re-run shows what changed). */
  prev?: { log: string; at: string };
}

export async function digest(log: string, rawLabel: string, code: string, focus: string, source: string, modelOverride?: string, opts: DigestOptions = {}): Promise<string> {
  // a command line can carry credentials (FOO_KEY=… cmd): never send/store them
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
  const tried = cfgBool("digest.use_model", true) && !opts.noModel && process.env.OFFLOAD_NO_MODEL !== "1";
  if (tried) {
    const prompt = [
      `<command>${label}</command>`,
      code ? `<exit_code>${code}</exit_code>` : "",
      focus ? `<focus>${focus}</focus>` : "",
      `<output lines="${lines}" bytes="${bytes}">`,
      redact(bytes <= maxIn ? text : logExcerpt(text)).replace(/\n$/, ""),
      "</output>",
    ]
      .filter((s) => s !== "")
      .join("\n");
    try {
      const r = await invoke("summarize", prompt + "\n", workDir(), modelOverride, { budgetSec: opts.budgetSec });
      summary = splitLines(r.text).slice(0, sumMax).map((l) => truncate(l, width)).join("\n");
      note = model = r.model;
      tin = r.tokensIn;
      tout = r.tokensOut;
    } catch (e) {
      note = `unavailable: ${String((e as WorkerError).message).split("\n").slice(0, 2).join(" ").slice(0, 200)}`;
    }
  }
  const out: string[] = [];
  out.push(`[offload] \`${label.slice(0, 120)}\`${code ? ` → exit ${code}` : ""} · ${fmtInt(lines)} lines / ${kb} KB · full log: ${log}`);
  const sumSection = summary
    ? [`── summary by ${note} (cheap model; trust the verbatim lines over it) ──`, summary]
    : note
      ? [`── model summary ${note} ──`]
      : [];
  // a re-run of the same command in this session: only what changed
  const keySection = opts.prev && existsSync(opts.prev.log)
    ? keyChanges(key.lines, text, readFileSync(opts.prev.log, "utf8"), opts.prev.at).map((l) => l.slice(0, width))
    : key.distinct > 0 ? [`── key lines, verbatim (${key.distinct} distinct) ──`, ...key.lines.map((l) => l.slice(0, width))] : ["── no error-like lines found ──"];
  if (compact) out.push(...keySection, ...sumSection);
  else out.push(...sumSection, ...keySection);
  if (!summary && !compact) tailN += 10;
  out.push(`── last ${tailN} lines ──`);
  out.push(...splitLines(text).slice(-tailN).map((l) => stripAnsi(l).slice(0, width)));
  out.push(`── more: grep -n -iE "error|fail" ${shquote(log)} | head -50   ·   sed -n "START,ENDp" ${shquote(log)}`);
  const result = out.join("\n") + "\n";
  const bout = Buffer.byteLength(result);
  appendStats({
    kind: "digest", source, label, log, model, bytes_in: bytes, bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: Boolean(summary), model_tried: tried, worker_tokens_in: tin, worker_tokens_out: tout,
  });
  pruneLogs();
  return result;
}

export function isSmall(text: string): boolean {
  return countLines(text) <= cfgInt("digest.threshold_lines", 150) && Buffer.byteLength(text) <= cfgInt("digest.threshold_bytes", 12000);
}

export function saveLog(path: string, text: string): void {
  writeFileSync(path, text);
}

/** What the agent sees instead of a huge search result (grep/rg/find…): counts per file
 *  (or per folder for path lists), the first matches of the busiest files, and how to
 *  narrow it. Deterministic and instant (no model). Twin: co_search_view in digest.sh —
 *  the output must stay identical. */
export function searchView(log: string, rawLabel: string): string {
  const t0 = Date.now();
  const label = redact(rawLabel);
  const text = readFileSync(log, "utf8");
  const bytes = Buffer.byteLength(text);
  const kb = Math.ceil(bytes / 1024);
  const cut = (s: string) => (s.length > 200 ? s.slice(0, 197) + "..." : s);
  const pathy = (p: string) => p !== "" && !/[ \t]/.test(p) && (p.includes("/") || /\.[A-Za-z0-9]+$/.test(p));
  type Groups = { order: string[]; cnt: Map<string, number>; first: Map<string, string[]> };
  const groups = (): Groups => ({ order: [], cnt: new Map(), first: new Map() });
  const add = (g: Groups, key: string, line: string) => {
    const c = g.cnt.get(key) ?? 0;
    if (c === 0) {
      g.order.push(key);
      g.first.set(key, []);
    }
    g.cnt.set(key, c + 1);
    if (c < 2) g.first.get(key)!.push(line);
  };
  const m = groups();
  const d = groups();
  const all: string[] = [];
  let nm = 0;
  let np = 0;
  for (const raw of splitLines(text)) {
    const t = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r$/, "");
    if (t === "") continue;
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
  const out: string[] = [];
  let head = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(countLines(text))} lines / ${kb} KB`;
  if (mode === "m") head += ` · ${fmtInt(nm)} matches in ${fmtInt(m.order.length)} files`;
  if (mode === "d") head += ` · ${fmtInt(np)} paths in ${fmtInt(d.order.length)} folders`;
  out.push(`${head} · full log: ${log}`);
  const list = (g: Groups, unit: string, what: string) => {
    const shown = Math.min(g.order.length, 20);
    // busiest first; ties keep the order they appeared in
    const top = g.order.map((k, i) => ({ k, i, c: g.cnt.get(k)! })).sort((a, b) => b.c - a.c || a.i - b.i).slice(0, shown).map((x) => x.k);
    out.push(`── ${what} per ${unit} (${fmtInt(g.order.length)} ${unit}s) ──`);
    for (const k of top) out.push(`${String(g.cnt.get(k)).padStart(7)}  ${cut(k)}`);
    if (g.order.length > shown) {
      const chosen = new Set(top);
      const rest = g.order.filter((k) => !chosen.has(k)).reduce((s, k) => s + g.cnt.get(k)!, 0);
      out.push(`      … ${fmtInt(g.order.length - shown)} more ${unit}s, ${fmtInt(rest)} ${what}`);
    }
    out.push(`── first ${what} in the top ${Math.min(shown, 10)} ${unit}s ──`);
    for (const k of top.slice(0, 10)) for (const l of g.first.get(k)!) out.push(cut(l));
  };
  if (mode === "m") list(m, "file", "matches");
  else if (mode === "d") list(d, "folder", "paths");
  else {
    out.push(`── first ${Math.min(n, 40)} lines ──`, ...all.slice(0, 40).map(cut));
    if (n > 40) out.push(`── last ${Math.min(n - 40, 10)} lines ──`, ...all.slice(Math.max(n - 10, 40)).map(cut));
  }
  out.push(`── narrow it: a path or a sharper pattern; counts: grep -c / rg -c; the rest: sed -n "START,ENDp" ${shquote(log)}; or ask: offload read -q "QUESTION" FILE ──`);
  const result = out.join("\n") + "\n";
  const bout = Buffer.byteLength(result);
  appendStats({
    kind: "digest", source: "search", label, log, model: "", bytes_in: bytes, bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: false, model_tried: false, worker_tokens_in: 0, worker_tokens_out: 0,
  });
  pruneLogs();
  return result;
}
