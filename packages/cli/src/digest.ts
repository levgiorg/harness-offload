import { readFileSync, writeFileSync } from "node:fs";
import { cfgBool, cfgInt } from "./config.ts";
import { invoke } from "./engine.ts";
import { WorkerError } from "./backends/types.ts";
import { redact } from "./secrets.ts";
import { appendStats, pruneLogs, workDir } from "./state.ts";
import { countLines, fmtInt, shquote, stripAnsi, truncate } from "./text.ts";

const KEY_RE = /[a-z0-9_)\/-][.][a-z][a-z]*:[0-9][0-9]*|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|cannot |can.t |undefined reference|no such file|permission denied|timed out|timeout|unresolved|not found|denied|refused|abort|killed|out of memory|oom/;
const ZERO_RE = /(^|[^0-9])0 (errors?|failures?|failed|problems?)|(errors?|failures?|failed)\s*[:=]\s*0([^0-9]|$)|no errors|without errors|0 vulnerabilities/;

const splitLines = (text: string): string[] => {
  const l = text.split("\n");
  if (text.endsWith("\n")) l.pop();
  return l;
};

export function keyLines(text: string, max: number): { lines: string[]; distinct: number } {
  const seen = new Map<string, { n: number; rep: number }>();
  const order: string[] = [];
  splitLines(text).forEach((raw, i) => {
    const l = raw.toLowerCase();
    if (!KEY_RE.test(l) || ZERO_RE.test(l)) return;
    const t = stripAnsi(raw).replace(/[ \t\r]+$/, "");
    if (!t) return;
    const s = seen.get(t);
    if (s) s.rep++;
    else {
      seen.set(t, { n: i + 1, rep: 1 });
      order.push(t);
    }
  });
  const out = order.slice(0, max).map((t) => {
    const s = seen.get(t)!;
    return `L${s.n}: ${truncate(t, 240)}${s.rep > 1 ? `  (x${s.rep})` : ""}`;
  });
  if (order.length > max) out.push(`... ${order.length - max} more distinct matching lines`);
  return { lines: out, distinct: order.length };
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
}

export async function digest(log: string, label: string, code: string, focus: string, source: string, modelOverride?: string, opts: DigestOptions = {}): Promise<string> {
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
  const keySection = key.distinct > 0 ? [`── key lines, verbatim (${key.distinct} distinct) ──`, ...key.lines.map((l) => l.slice(0, width))] : ["── no error-like lines found ──"];
  if (compact) out.push(...keySection, ...sumSection);
  else out.push(...sumSection, ...keySection);
  if (!summary && !compact) tailN += 10;
  out.push(`── last ${tailN} lines ──`);
  out.push(...splitLines(text).slice(-tailN).map((l) => stripAnsi(l).slice(0, width)));
  out.push(`── more: grep -n -iE "error|fail" ${shquote(log)} | head -50   ·   sed -n "START,ENDp" ${shquote(log)}`);
  const result = out.join("\n") + "\n";
  const bout = Buffer.byteLength(result);
  appendStats({
    kind: "digest", source, label, model, bytes_in: bytes, bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: Boolean(summary), worker_tokens_in: tin, worker_tokens_out: tout,
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
