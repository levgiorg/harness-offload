import { openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";

export function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Counts lines like awk (a final line without newline still counts). */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n : n + 1;
}

export function fileLines(path: string): number {
  try {
    return countLines(readFileSync(path, "latin1"));
  } catch {
    return 0;
  }
}

/** Token estimates. Bytes ÷ 4 undercounts real tokenizers by up to 59% (dense logs, CSV,
 *  pretty JSON); 0.277 per byte + 1.127 per run of digits was fit on 25 files against two real
 *  tokenizers (docs/autopilot/EXPERIMENTS.md, A8). estTokens(bytes) is the bytes-only fallback.
 *  Twins: co_tokens, co_est_tokens. */
export const estTokens = (bytes: number): number => Math.floor((bytes * 3 + 9) / 10);
export const digitRuns = (s: string): number => (s.match(/[0-9]+/g) ?? []).length;
export const tokensOf = (bytes: number, runs: number): number => Math.floor((bytes * 277 + runs * 1127 + 999) / 1000);
export const estTokensText = (s: string): number => tokensOf(Buffer.byteLength(s), digitRuns(s));
/** The most a text of BYTES can count (every other byte a digit run). Twin: co_tokens_max. */
export const tokensMax = (bytes: number): number => Math.floor((bytes * 840 + 999) / 1000);
export function estTokensFile(path: string, bytes = fileBytes(path)): number {
  try {
    return tokensOf(bytes, digitRuns(readFileSync(path, "latin1")));
  } catch {
    return estTokens(bytes);
  }
}

/** Text = no NUL byte in the first 8 KB. */
export function isText(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    closeSync(fd);
    return !buf.subarray(0, n).includes(0);
  } catch {
    return false;
  }
}

export function fmtInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function shquote(s: string): string {
  if (s !== "" && /^[A-Za-z0-9_./:=@%+,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Lines [from, to] (1-based, inclusive) prefixed like `cat -n`. */
export function numberLines(text: string, from: number, to: number): string {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const out: string[] = [];
  for (let i = from; i <= Math.min(to, lines.length); i++) out.push(`${String(i).padStart(6)}\t${lines[i - 1]}`);
  return out.join("\n") + (out.length ? "\n" : "");
}

/** Removes one wrapping ``` fence; inner fences survive. */
export function stripWrappingFence(text: string): string {
  const lines = text.split("\n");
  let s = 0;
  let e = lines.length - 1;
  while (s <= e && /^\s*$/.test(lines[s])) s++;
  while (e >= s && /^\s*$/.test(lines[e])) e--;
  if (s < e && /^\s*```/.test(lines[s]) && /^\s*```\s*$/.test(lines[e])) {
    s++;
    e--;
  }
  return lines.slice(s, e + 1).join("\n") + "\n";
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export function truncate(s: string, width: number): string {
  return s.length > width ? s.slice(0, width - 3) + "..." : s;
}
