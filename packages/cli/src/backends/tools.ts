// Read-only tools the HTTP backends give a model for `explore`. Everything is
// confined to the working directory and never touches secret files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { globToRegExp, matchesAny } from "../secrets.ts";
import { isText, numberLines } from "../text.ts";

const SKIP = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "target", "vendor", ".next", "__pycache__", ".cache"]);
const MAX_SLICE = 600;

export interface ToolCtx {
  root: string;
  secretGlobs: string[];
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

function inside(ctx: ToolCtx, p: string): string {
  const abs = resolve(ctx.root, p || ".");
  const rel = relative(ctx.root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path outside the project: ${p}`);
  const parts = normalize(rel).split(sep);
  if (parts.some((x) => matchesAny(x, ctx.secretGlobs))) throw new Error(`refused: ${p} matches the secret-file rules`);
  return abs;
}

function* walk(dir: string, ctx: ToolCtx): Generator<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries.sort()) {
    if (SKIP.has(e) || matchesAny(e, ctx.secretGlobs)) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p, ctx);
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

export function runTool(name: string, args: Record<string, any>, ctx: ToolCtx): string {
  try {
    switch (name) {
      case "read_file": {
        const p = inside(ctx, String(args.path ?? ""));
        if (!isText(p)) return `error: ${args.path} is not a text file`;
        const text = readFileSync(p, "utf8");
        const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        const from = Math.max(1, Number(args.offset) || 1);
        const lim = Math.min(MAX_SLICE, Math.max(1, Number(args.limit) || MAX_SLICE));
        const to = Math.min(total, from + lim - 1);
        const body = numberLines(text, from, to);
        return `${args.path} (lines ${from}-${to} of ${total})\n${body}${to < total ? `… ${total - to} more lines (use offset=${to + 1})\n` : ""}`;
      }
      case "grep": {
        const base = inside(ctx, String(args.path ?? "."));
        const re = new RegExp(String(args.pattern), args.ignore_case ? "i" : "");
        const inc = args.include ? globToRegExp(String(args.include)) : undefined;
        const files = statSync(base).isFile() ? [base] : [...walk(base, ctx)];
        const out: string[] = [];
        for (const f of files) {
          if (inc && !inc.test(f.split(sep).pop()!)) continue;
          if (!isText(f)) continue;
          const lines = readFileSync(f, "utf8").split("\n");
          for (let i = 0; i < lines.length && out.length < 200; i++) {
            if (re.test(lines[i])) out.push(`${relative(ctx.root, f).split(sep).join("/")}:${i + 1}: ${lines[i].slice(0, 240)}`);
          }
          if (out.length >= 200) break;
        }
        return out.length ? out.join("\n") : "no matches";
      }
      case "glob": {
        const re = pathGlob(String(args.pattern ?? "**/*"));
        const out: string[] = [];
        for (const f of walk(ctx.root, ctx)) {
          const rel = relative(ctx.root, f).split(sep).join("/");
          if (re.test(rel)) out.push(rel);
          if (out.length >= 300) break;
        }
        return out.length ? out.join("\n") : "no files";
      }
      case "list_dir": {
        const p = inside(ctx, String(args.path ?? "."));
        return readdirSync(p)
          .filter((e) => !SKIP.has(e) && !matchesAny(e, ctx.secretGlobs))
          .sort()
          .map((e) => (statSync(join(p, e)).isDirectory() ? e + "/" : e))
          .join("\n");
      }
    }
    return `error: unknown tool ${name}`;
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
