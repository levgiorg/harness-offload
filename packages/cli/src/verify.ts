import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LINE = 4000; // answer lines longer than this are not scanned for citations

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
/** A quote shortened with "..." or "…": every piece occurs in the window, in order, and
 *  one piece is long enough to mean something. Twin: elided() in verify.awk. */
function elided(hay: string, q: string): boolean {
  const t = q.replace(/…/g, "...");
  if (!t.includes("...")) return false;
  let pos = 0;
  let longest = 0;
  for (const piece of t.split(/\.{3,}/)) {
    const f = norm(piece);
    if (!f) continue;
    const at = hay.indexOf(f, pos);
    if (at < 0) return false;
    pos = at + f.length;
    longest = Math.max(longest, f.length);
  }
  return longest >= 6;
}

/** True when citation c occurs again in s as a whole citation (not inside a longer path,
 *  not as the start of a longer line number). Twin: again() in verify.awk. */
function again(s: string, c: string): boolean {
  for (let i = s.indexOf(c); i >= 0; i = s.indexOf(c, i + c.length)) {
    const x = i > 0 ? s[i - 1] : "";
    const y = s[i + c.length] ?? "";
    if (!/[A-Za-z0-9_.@\/+-]/.test(x) && !/[0-9-]/.test(y)) return true;
  }
  return false;
}

export function verifyCitations(answer: string, root: string, slack = 3, sent: string[] = [], known: string[] = []): { text: string; ok: number; bad: number } {
  const cache = new Map<string, string[] | null>();
  // files offload itself sent to the worker, as written in the prompt: checked
  // even outside root (a log in /tmp, another repo) — the worker has seen them
  const sentPaths = new Set(sent.map((s) => s.replace(/^\.\//, "")));
  const load = (p: string): string[] | null => {
    if (cache.has(p)) return cache.get(p)!;
    let lines: string[] | null = null;
    try {
      // only regular, reasonably sized files inside the project: a model can
      // cite /dev/zero or a FIFO, which must not hang or exhaust memory
      const real = realpathSync(isAbsolute(p) ? p : join(root, p.replace(/^\.\//, "")));
      const rel = relative(realpathSync(root), real);
      if (!sentPaths.has(p.replace(/^\.\//, "")) && (rel.startsWith("..") || isAbsolute(rel))) throw new Error("outside");
      const st = statSync(real);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) throw new Error("not a regular file");
      const t = readFileSync(real, "utf8");
      lines = t.split("\n");
      if (t.endsWith("\n")) lines.pop();
      if (lines.length === 0) lines = null;
    } catch {
      lines = null;
    }
    cache.set(p, lines);
    return lines;
  };
  // A cited path that doesn't exist as written ("src/fx/ledger.ts" for "fx/ledger.ts", a
  // bare "pre-read") is matched against the sent/known files: exactly one that ends with
  // it (or that it ends with), else exactly one with its file name. Twin: locate() in verify.awk.
  const knownList: string[] = [];
  const isKnown = new Set<string>();
  const byBase = new Map<string, string[]>();
  const remember = (k0: string) => {
    const k = k0.replace(/^\.\//, "");
    if (!k || isKnown.has(k) || knownList.length >= 50000) return;
    isKnown.add(k);
    knownList.push(k);
    const base = k.slice(k.lastIndexOf("/") + 1);
    byBase.set(base, [...(byBase.get(base) ?? []), k]);
  };
  for (const s of sent) remember(s);
  for (const k of known) remember(k);
  const locate = (p: string): string | undefined => {
    if (load(p)) return p;
    const q = p.replace(/^\.\//, "");
    if (!q || !knownList.length) return undefined;
    const hits = knownList.filter((k) => (k.length > q.length && k.endsWith("/" + q)) || (q.length > k.length && q.endsWith("/" + k)));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return undefined;
    const byName = byBase.get(q.slice(q.lastIndexOf("/") + 1)) ?? [];
    return byName.length === 1 ? byName[0] : undefined;
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
    const hay = norm(lines.slice(lo - 1, hi).join(" "));
    return hay.includes(nq) || elided(hay, nq);
  };
  let ok = 0;
  let bad = 0;
  // anchored so the scan stays linear on long runs of path characters
  // `path:L12` — or `path:12` when path is a file offload sent or knows (so `host:8080`
  // and `10:30` stay plain text)
  const cite = /(?<![A-Za-z0-9_.@\/+-])[A-Za-z0-9_.@\/+-]+:L?[0-9]+(?:-L?[0-9]+)?/;
  const out = answer.split("\n").map((line) => {
    if (line.length > MAX_LINE) return line;
    let rest = line;
    let marked = false;
    let outl = ""; // the line as printed: citations repaired to the file they mean
    let m: RegExpExecArray | null;
    while ((m = cite.exec(rest))) {
      const c = m[0];
      const before = rest.slice(0, m.index);
      const after = rest.slice(m.index + c.length);
      // a backticked citation keeps its closing backtick, so that backtick never opens
      // the next citation's quote (twin: bt in verify.awk)
      const bt = before.endsWith("`") && after.startsWith("`");
      rest = bt ? after.slice(1) : after;
      outl += before + c;
      const at = c.indexOf(":");
      const path = c.slice(0, at);
      const range = c.slice(at + 1).replace(/^L/, "");
      if (c[at + 1] !== "L" && !isKnown.has(path.replace(/^\.\//, ""))) {
        if (bt) outl += "`";
        continue;
      }
      const [as, bs] = range.split("-");
      const a = Number(as);
      const b = bs ? Number(bs.replace(/^L/, "")) : a;
      let qa = "";
      const t = after.replace(/^`/, "");
      const s = t.indexOf("`");
      let qa2 = "";
      if (s >= 0) {
        const e = t.indexOf("`", s + 1);
        if (e >= 0) {
          qa = t.slice(s + 1, e);
          // "path:L4 in `fn()`: `code`" — the second span, if it comes before the next citation
          const s2 = t.indexOf("`", e + 1);
          if (s2 >= 0 && !/[A-Za-z0-9_.@\/+-]+:L?[0-9]/.test(t.slice(e + 1, s2 + 1))) {
            const e2 = t.indexOf("`", s2 + 1);
            if (e2 >= 0) qa2 = t.slice(s2 + 1, e2);
          }
        }
      }
      let qb = lastSpan(before);
      if (norm(qa).length < 3) qa = "";
      if (norm(qa2).length < 3) qa2 = "";
      if (norm(qb).length < 6) qb = "";
      // the same citation again later on the line ("`f.py:L4` in `fn()`: `f.py:L4` `code`")
      // is checked there, where its quote is
      if (again(after, c)) qa = qa2 = qb = "";
      if (qa || qa2 || qb) {
        const real = locate(path);
        if (real && ((qa && check(real, a, b, qa)) || (qa2 && check(real, a, b, qa2)) || (qb && check(real, a, b, qb)))) {
          ok++;
          if (real !== path) outl = outl.slice(0, outl.length - c.length) + real + c.slice(at);
        } else {
          bad++;
          marked = true;
        }
      }
      if (bt) outl += "`";
    }
    outl += rest;
    return marked ? outl + " ⚠unverified" : outl;
  });
  return { text: out.join("\n"), ok, bad };
}
