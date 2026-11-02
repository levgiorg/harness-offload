// Read-only tools the HTTP backends give a model for `explore`. Everything is
// confined to the project's real directory (symlinks are never followed out
// of it), never touches secret files or .git, is bounded in time and size,
// and every result is redacted before it goes back to the model.
import { closeSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { globToRegExp, isSecretName, redact } from "../secrets.ts";
import { isText } from "../text.ts";

const SKIP = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "target", "vendor", ".next", "__pycache__", ".cache"]);
const MAX_SLICE = 600; // lines per read_file call
const MAX_LINE = 2000; // characters kept per line (minified bundles)
const MAX_RESULT = 60_000; // characters per tool result
const MAX_FILE_BYTES = 8 * 1024 * 1024; // larger files are refused
const MAX_WALK = 50_000; // directory entries visited per call
const MAX_DIR_ENTRIES = 500;
const GREP_TIMEOUT_MS = 10_000;

export interface ToolCtx {
  root: string;
  secretGlobs: string[];
  allowGlobs?: string[];
}

export const TOOL_SPECS = [
  {
    name: "read_file",
    description: "Read a text file (paths relative to the project root). Returns numbered lines. At most 600 lines per call; use offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", description: "1-based first line" },
        limit: { type: "integer", description: "number of lines (max 600)" },
      },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Search file contents with a JavaScript regular expression. Returns path:line: text matches (max 200).",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "directory or file to search (default: project root)" },
        include: { type: "string", description: "only files whose name matches this glob, e.g. *.ts" },
        ignore_case: { type: "boolean" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: "Find files by glob pattern relative to the project root (supports **, *, ?). Max 300 results.",
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "list_dir",
    description: "List a directory (default: project root).",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
] as const;

const realRoots = new Map<string, string>();
function realRoot(root: string): string {
  let r = realRoots.get(root);
  if (!r) {
    r = realpathSync(root);
    realRoots.set(root, r);
  }
  return r;
}

const within = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function refusedPart(ctx: ToolCtx, rel: string): string | undefined {
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    if (part.toLowerCase() === ".git") return ".git";
    if (isSecretName(part, ctx.secretGlobs, ctx.allowGlobs ?? [])) return part;
  }
  return undefined;
}

/** Resolves a model-supplied path; throws unless it really lies inside the project. */
function inside(ctx: ToolCtx, p: string): string {
  const abs = resolve(ctx.root, p || ".");
  if (!within(ctx.root, abs)) throw new Error(`path outside the project: ${p}`);
  let bad = refusedPart(ctx, relative(ctx.root, abs));
  if (bad) throw new Error(`refused: ${p} matches the secret-file rules (${bad})`);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`no such file or directory: ${p}`);
  }
  const root = realRoot(ctx.root);
  if (!within(root, real)) throw new Error(`path outside the project: ${p} (symlink)`);
  bad = refusedPart(ctx, relative(root, real));
  if (bad) throw new Error(`refused: ${p} matches the secret-file rules (${bad})`);
  return real;
}

/** Regular files under dir; symlinks are skipped (no escapes, no loops). */
function* walk(dir: string, ctx: ToolCtx, budget = { left: MAX_WALK }): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries.sort()) {
    if (--budget.left < 0) return;
    if (SKIP.has(e) || isSecretName(e, ctx.secretGlobs, ctx.allowGlobs ?? [])) continue;
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p, ctx, budget);
    else if (st.isFile()) yield p;
  }
}

function pathGlob(pattern: string): RegExp {
  const parts = pattern.split("/");
  let re = "";
  parts.forEach((part, i) => {
    if (part === "**") re += i === parts.length - 1 ? ".*" : "(?:.*/)?";
    else re += globToRegExp(part).source.slice(1, -1) + (i < parts.length - 1 ? "/" : "");
  });
  return new RegExp("^" + re + "$");
}

function readCapped(p: string): string {
  const st = statSync(p);
  if (st.size > MAX_FILE_BYTES) throw new Error(`file is ${Math.round(st.size / 1e6)} MB — too large to read here; grep it instead`);
  const fd = openSync(p, "r");
  try {
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync(fd, buf, n, st.size - n, n);
      if (r <= 0) break;
      n += r;
    }
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const cut = (s: string): string => (s.length > MAX_LINE ? s.slice(0, MAX_LINE) + ` … [${s.length - MAX_LINE} more characters]` : s);
const cap = (s: string): string => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + "\n… [output truncated]" : s);
const rel = (ctx: ToolCtx, f: string): string => relative(realRoot(ctx.root), f).split(sep).join("/");

// The regex runs in a worker thread with a hard deadline: a model-supplied
// pattern with catastrophic backtracking must not hang the CLI.
const GREP_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const { files, pattern, flags, maxLine } = workerData;
const re = new RegExp(pattern, flags);
const out = [];
for (const [f, name] of files) {
  let lines;
  try { lines = readFileSync(f, "utf8").split("\\n"); } catch { continue; }
  for (let i = 0; i < lines.length && out.length < 200; i++) {
    const l = lines[i].length > maxLine ? lines[i].slice(0, maxLine) : lines[i];
    if (re.test(l)) out.push(name + ":" + (i + 1) + ": " + l.slice(0, 240));
  }
  if (out.length >= 200) break;
}
parentPort.postMessage(out);
`;

function grepInWorker(files: [string, string][], pattern: string, flags: string): Promise<string[]> {
  return new Promise((resolveP, reject) => {
    const w = new Worker(GREP_WORKER, { eval: true, workerData: { files, pattern, flags, maxLine: MAX_LINE } });
    const t = setTimeout(() => {
      void w.terminate();
      reject(new Error(`grep stopped after ${GREP_TIMEOUT_MS / 1000}s (pattern too slow? use a simpler regex)`));
    }, GREP_TIMEOUT_MS);
    w.once("message", (m: string[]) => {
      clearTimeout(t);
      void w.terminate();
      resolveP(m);
    });
    w.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function run(name: string, args: Record<string, any>, ctx: ToolCtx): Promise<string> {
  switch (name) {
    case "read_file": {
      const p = inside(ctx, String(args.path ?? ""));
      if (!statSync(p).isFile()) return `error: ${args.path} is not a regular file`;
      if (!isText(p)) return `error: ${args.path} is not a text file`;
      const text = readCapped(p);
      const lines = text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      const total = lines.length;
      const from = Math.max(1, Number(args.offset) || 1);
      const lim = Math.min(MAX_SLICE, Math.max(1, Number(args.limit) || MAX_SLICE));
      const to = Math.min(total, from + lim - 1);
      const w = String(to).length;
      let body = "";
      for (let i = from; i <= to; i++) body += `${String(i).padStart(Math.max(6, w))}\t${cut(lines[i - 1])}\n`;
      return `${args.path} (lines ${from}-${to} of ${total})\n${body}${to < total ? `… ${total - to} more lines (use offset=${to + 1})\n` : ""}`;
    }
    case "grep": {
      const base = inside(ctx, String(args.path ?? "."));
      const flags = args.ignore_case ? "i" : "";
      new RegExp(String(args.pattern), flags); // syntax errors surface here, in-thread
      const inc = args.include ? globToRegExp(String(args.include)) : undefined;
      const st = statSync(base);
      const files = (st.isFile() ? [base] : [...walk(base, ctx)])
        .filter((f) => (!inc || inc.test(f.split(sep).pop()!)) && isText(f) && statSync(f).size <= MAX_FILE_BYTES)
        .map((f) => [f, rel(ctx, f)] as [string, string]);
      const out = await grepInWorker(files, String(args.pattern), flags);
      return out.length ? out.join("\n") : "no matches";
    }
    case "glob": {
      const re = pathGlob(String(args.pattern ?? "**/*"));
      const out: string[] = [];
      for (const f of walk(realRoot(ctx.root), ctx)) {
        const r = rel(ctx, f);
        if (re.test(r)) out.push(r);
        if (out.length >= 300) break;
      }
      return out.length ? out.join("\n") : "no files";
    }
    case "list_dir": {
      const p = inside(ctx, String(args.path ?? "."));
      const names = readdirSync(p)
        .filter((e) => !SKIP.has(e) && !isSecretName(e, ctx.secretGlobs, ctx.allowGlobs ?? []))
        .sort();
      const shown = names.slice(0, MAX_DIR_ENTRIES).map((e) => {
        try {
          const st = lstatSync(join(p, e));
          return st.isSymbolicLink() ? e + "@" : st.isDirectory() ? e + "/" : e;
        } catch {
          return e;
        }
      });
      if (names.length > MAX_DIR_ENTRIES) shown.push(`… ${names.length - MAX_DIR_ENTRIES} more entries`);
      return shown.join("\n");
    }
  }
  return `error: unknown tool ${name}`;
}

export async function runTool(name: string, args: Record<string, any>, ctx: ToolCtx): Promise<string> {
  try {
    return cap(redact(await run(name, args, ctx)));
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
