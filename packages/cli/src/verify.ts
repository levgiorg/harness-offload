import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const norm = (s: string) => s.replace(/[ \t\r]+/g, " ").trim();

function lastSpan(s: string): string {
  let open = false;
  let cur = "";
  let last = "";
  for (const c of s) {
    if (c === "`") {
      if (open) {
        last = cur;
        open = false;
      } else {
        open = true;
        cur = "";
      }
    } else if (open) cur += c;
  }
  return last;
}

/**
 * Checks `path:Lx[-Ly]` citations against the files; a citation passes when its
 * backtick quote (after it, or just before it) occurs within ±slack lines.
 * Same rules as the bash engine's verify.awk.
 */
export function verifyCitations(answer: string, root: string, slack = 3): { text: string; ok: number; bad: number } {
  const cache = new Map<string, string[] | null>();
  const load = (p: string): string[] | null => {
    if (cache.has(p)) return cache.get(p)!;
    let lines: string[] | null = null;
    try {
      const t = readFileSync(isAbsolute(p) ? p : join(root, p.replace(/^\.\//, "")), "utf8");
      lines = t.split("\n");
      if (t.endsWith("\n")) lines.pop();
      if (lines.length === 0) lines = null;
    } catch {
      lines = null;
    }
    cache.set(p, lines);
    return lines;
  };
  const check = (p: string, a: number, b: number, q: string): boolean => {
    const lines = load(p);
    if (!lines) return false;
    if (b < a) b = a;
    const lo = Math.max(1, a - slack);
    const hi = Math.min(lines.length, b + slack);
    const nq = norm(q);
    if (!nq) return false;
    for (let i = lo; i <= hi; i++) if (norm(lines[i - 1]).includes(nq)) return true;
    return norm(lines.slice(lo - 1, hi).join(" ")).includes(nq);
  };
  let ok = 0;
  let bad = 0;
  const cite = /[A-Za-z0-9_.@\/+-]+:L[0-9]+(?:-L?[0-9]+)?/;
  const out = answer.split("\n").map((line) => {
    let rest = line;
    let marked = false;
    let m: RegExpExecArray | null;
    while ((m = cite.exec(rest))) {
      const c = m[0];
      const before = rest.slice(0, m.index);
      const after = rest.slice(m.index + c.length);
      rest = after;
      const at = c.indexOf(":L");
      const path = c.slice(0, at);
      const range = c.slice(at + 2);
      const [as, bs] = range.split("-");
      const a = Number(as);
      const b = bs ? Number(bs.replace(/^L/, "")) : a;
      let qa = "";
      const t = after.replace(/^`/, "");
      const s = t.indexOf("`");
      if (s >= 0) {
        const e = t.indexOf("`", s + 1);
        if (e >= 0) qa = t.slice(s + 1, e);
      }
      let qb = lastSpan(before);
      if (norm(qa).length < 3) qa = "";
      if (norm(qb).length < 6) qb = "";
      if (!qa && !qb) continue;
      if ((qa && check(path, a, b, qa)) || (qb && check(path, a, b, qb))) ok++;
      else {
        bad++;
        marked = true;
      }
    }
    return marked ? line + " ⚠unverified" : line;
  });
  return { text: out.join("\n"), ok, bad };
}
