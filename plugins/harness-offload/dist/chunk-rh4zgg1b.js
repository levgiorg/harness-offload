import {
  CONNECTORS,
  workerThreads
} from "./chunk-yrbt2j5y.js";
import {
  configHome2,
  cfg2,
  globToRegExp,
  isSecretName,
  redact
} from "./chunk-fprvy154.js";
import {
  E,
  WorkerError,
  classify
} from "./chunk-t783jg2c.js";

// src/backends/http.ts
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/backends/tools.ts
import { closeSync as closeSync2, lstatSync, openSync as openSync2, readdirSync, readSync as readSync2, realpathSync, statSync as statSync2 } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// src/text.ts
import { openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
function fileBytes(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
function countLines(text) {
  if (text.length === 0)
    return 0;
  let n = 0;
  for (let i = 0;i < text.length; i++)
    if (text.charCodeAt(i) === 10)
      n++;
  return text.endsWith(`
`) ? n : n + 1;
}
function fileLines(path) {
  try {
    return countLines(readFileSync(path, "latin1"));
  } catch {
    return 0;
  }
}
var estTokens = (bytes) => Math.floor((bytes * 3 + 9) / 10);
var digitRuns = (s) => (s.match(/[0-9]+/g) ?? []).length;
var tokensOf = (bytes, runs) => Math.floor((bytes * 277 + runs * 1127 + 999) / 1000);
var estTokensText = (s) => tokensOf(Buffer.byteLength(s), digitRuns(s));
var tokensMax = (bytes) => Math.floor((bytes * 840 + 999) / 1000);
function estTokensFile(path, bytes = fileBytes(path)) {
  try {
    return tokensOf(bytes, digitRuns(readFileSync(path, "latin1")));
  } catch {
    return estTokens(bytes);
  }
}
function isText(path) {
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
function fmtInt(n) {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function shquote(s) {
  if (s !== "" && /^[A-Za-z0-9_./:=@%+,-]+$/.test(s))
    return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function numberLines(text, from, to) {
  const lines = text.split(`
`);
  if (text.endsWith(`
`))
    lines.pop();
  const out = [];
  for (let i = from;i <= Math.min(to, lines.length); i++)
    out.push(`${String(i).padStart(6)}	${lines[i - 1]}`);
  return out.join(`
`) + (out.length ? `
` : "");
}
function stripWrappingFence(text) {
  const lines = text.split(`
`);
  let s = 0;
  let e = lines.length - 1;
  while (s <= e && /^\s*$/.test(lines[s]))
    s++;
  while (e >= s && /^\s*$/.test(lines[e]))
    e--;
  if (s < e && /^\s*```/.test(lines[s]) && /^\s*```\s*$/.test(lines[e])) {
    s++;
    e--;
  }
  return lines.slice(s, e + 1).join(`
`) + `
`;
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
function truncate(s, width) {
  return s.length > width ? s.slice(0, width - 3) + "..." : s;
}

// src/backends/tools.ts
var SKIP = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "target", "vendor", ".next", "__pycache__", ".cache"]);
var MAX_SLICE = 600;
var MAX_LINE = 2000;
var MAX_RESULT = 60000;
var MAX_FILE_BYTES = 8 * 1024 * 1024;
var MAX_WALK = 50000;
var MAX_DIR_ENTRIES = 500;
var GREP_TIMEOUT_MS = 1e4;
var TOOL_SPECS = [
  {
    name: "read_file",
    description: "Read a text file (paths relative to the project root). Returns numbered lines. At most 600 lines per call; use offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", description: "1-based first line" },
        limit: { type: "integer", description: "number of lines (max 600)" }
      },
      required: ["path"]
    }
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
        ignore_case: { type: "boolean" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "glob",
    description: "Find files by glob pattern relative to the project root (supports **, *, ?). Max 300 results.",
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }
  },
  {
    name: "list_dir",
    description: "List a directory (default: project root).",
    parameters: { type: "object", properties: { path: { type: "string" } } }
  }
];
var realRoots = new Map;
function realRoot(root) {
  let r = realRoots.get(root);
  if (!r) {
    r = realpathSync(root);
    realRoots.set(root, r);
  }
  return r;
}
var within = (root, p) => {
  const rel = relative(root, p);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
};
function refusedPart(ctx, rel) {
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    if (part.toLowerCase() === ".git")
      return ".git";
    if (isSecretName(part, ctx.secretGlobs, ctx.allowGlobs ?? []))
      return part;
  }
  return;
}
function inside(ctx, p) {
  const abs = resolve(ctx.root, p || ".");
  if (!within(ctx.root, abs))
    throw new Error(`path outside the project: ${p}`);
  let bad = refusedPart(ctx, relative(ctx.root, abs));
  if (bad)
    throw new Error(`refused: ${p} matches the secret-file rules (${bad})`);
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`no such file or directory: ${p}`);
  }
  const root = realRoot(ctx.root);
  if (!within(root, real))
    throw new Error(`path outside the project: ${p} (symlink)`);
  bad = refusedPart(ctx, relative(root, real));
  if (bad)
    throw new Error(`refused: ${p} matches the secret-file rules (${bad})`);
  return real;
}
function* walk(dir, ctx, budget = { left: MAX_WALK }) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries.sort()) {
    if (--budget.left < 0)
      return;
    if (SKIP.has(e) || isSecretName(e, ctx.secretGlobs, ctx.allowGlobs ?? []))
      continue;
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory())
      yield* walk(p, ctx, budget);
    else if (st.isFile())
      yield p;
  }
}
function pathGlob(pattern) {
  const parts = pattern.split("/");
  let re = "";
  parts.forEach((part, i) => {
    if (part === "**")
      re += i === parts.length - 1 ? ".*" : "(?:.*/)?";
    else
      re += globToRegExp(part).source.slice(1, -1) + (i < parts.length - 1 ? "/" : "");
  });
  return new RegExp("^" + re + "$");
}
function readCapped(p) {
  const st = statSync2(p);
  if (st.size > MAX_FILE_BYTES)
    throw new Error(`file is ${Math.round(st.size / 1e6)} MB — too large to read here; grep it instead`);
  const fd = openSync2(p, "r");
  try {
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync2(fd, buf, n, st.size - n, n);
      if (r <= 0)
        break;
      n += r;
    }
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync2(fd);
  }
}
var cut = (s) => s.length > MAX_LINE ? s.slice(0, MAX_LINE) + ` … [${s.length - MAX_LINE} more characters]` : s;
var cap = (s) => s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + `
… [output truncated]` : s;
var rel = (ctx, f) => relative(realRoot(ctx.root), f).split(sep).join("/");
var GREP_WORKER = `
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
function grepInWorker(files, pattern, flags) {
  return new Promise((resolveP, reject) => {
    const w = new (workerThreads()).Worker(GREP_WORKER, { eval: true, workerData: { files, pattern, flags, maxLine: MAX_LINE } });
    const t = setTimeout(() => {
      w.terminate();
      reject(new Error(`grep stopped after ${GREP_TIMEOUT_MS / 1000}s (pattern too slow? use a simpler regex)`));
    }, GREP_TIMEOUT_MS);
    w.once("message", (m) => {
      clearTimeout(t);
      w.terminate();
      resolveP(m);
    });
    w.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
async function run(name, args, ctx) {
  switch (name) {
    case "read_file": {
      const p = inside(ctx, String(args.path ?? ""));
      if (!statSync2(p).isFile())
        return `error: ${args.path} is not a regular file`;
      if (!isText(p))
        return `error: ${args.path} is not a text file`;
      const text = readCapped(p);
      const lines = text.split(`
`);
      if (text.endsWith(`
`))
        lines.pop();
      const total = lines.length;
      const from = Math.max(1, Number(args.offset) || 1);
      const lim = Math.min(MAX_SLICE, Math.max(1, Number(args.limit) || MAX_SLICE));
      const to = Math.min(total, from + lim - 1);
      const w = String(to).length;
      let body = "";
      for (let i = from;i <= to; i++)
        body += `${String(i).padStart(Math.max(6, w))}	${cut(lines[i - 1])}
`;
      return `${args.path} (lines ${from}-${to} of ${total})
${body}${to < total ? `… ${total - to} more lines (use offset=${to + 1})
` : ""}`;
    }
    case "grep": {
      const base = inside(ctx, String(args.path ?? "."));
      const flags = args.ignore_case ? "i" : "";
      new RegExp(String(args.pattern), flags);
      const inc = args.include ? globToRegExp(String(args.include)) : undefined;
      const st = statSync2(base);
      const files = (st.isFile() ? [base] : [...walk(base, ctx)]).filter((f) => (!inc || inc.test(f.split(sep).pop())) && isText(f) && statSync2(f).size <= MAX_FILE_BYTES).map((f) => [f, rel(ctx, f)]);
      const out = await grepInWorker(files, String(args.pattern), flags);
      return out.length ? out.join(`
`) : "no matches";
    }
    case "glob": {
      const re = pathGlob(String(args.pattern ?? "**/*"));
      const out = [];
      for (const f of walk(realRoot(ctx.root), ctx)) {
        const r = rel(ctx, f);
        if (re.test(r))
          out.push(r);
        if (out.length >= 300)
          break;
      }
      return out.length ? out.join(`
`) : "no files";
    }
    case "list_dir": {
      const p = inside(ctx, String(args.path ?? "."));
      const names = readdirSync(p).filter((e) => !SKIP.has(e) && !isSecretName(e, ctx.secretGlobs, ctx.allowGlobs ?? [])).sort();
      const shown = names.slice(0, MAX_DIR_ENTRIES).map((e) => {
        try {
          const st = lstatSync(join(p, e));
          return st.isSymbolicLink() ? e + "@" : st.isDirectory() ? e + "/" : e;
        } catch {
          return e;
        }
      });
      if (names.length > MAX_DIR_ENTRIES)
        shown.push(`… ${names.length - MAX_DIR_ENTRIES} more entries`);
      return shown.join(`
`);
    }
  }
  return `error: unknown tool ${name}`;
}
async function runTool(name, args, ctx) {
  try {
    return cap(redact(await run(name, args, ctx)));
  } catch (e) {
    return `error: ${e.message}`;
  }
}

// src/backends/http.ts
var PRESETS2 = CONNECTORS.endpoints;
function credentialsPath2() {
  return process.env.OFFLOAD_CREDENTIALS || join2(configHome2(), "harness-offload", "credentials.json");
}
function storedKey(name) {
  try {
    const p = credentialsPath2();
    if (!existsSync(p))
      return;
    const v = JSON.parse(readFileSync2(p, "utf8"));
    return typeof v?.[name] === "string" ? v[name] : undefined;
  } catch {
    return;
  }
}
function endpoint2(name) {
  const fromCfg = cfg2(`endpoints.${name}`);
  const preset = PRESETS2[name];
  if (!fromCfg && !preset)
    return;
  const merged = { ...preset ?? {}, ...fromCfg ?? {} };
  if (!merged.type || !merged.base_url)
    return;
  return { ...merged, name };
}
function endpointNames2() {
  const own = Object.keys(cfg2("endpoints") ?? {});
  return [...new Set([...Object.keys(PRESETS2), ...own])];
}
function apiKey2(ep) {
  return ep.api_key || storedKey(ep.name) || (ep.api_key_env ? process.env[ep.api_key_env] : undefined);
}
async function post(url, body, headers, timeoutMs) {
  const ac = new AbortController;
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ac.signal });
    text = await res.text();
  } catch (e) {
    clearTimeout(t);
    if (e.name === "AbortError" || ac.signal.aborted)
      throw new WorkerError(E.TIMEOUT, `timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw new WorkerError(E.WORKER, `cannot reach ${url}: ${e.message}`);
  }
  clearTimeout(t);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? text.slice(0, 300);
    const code = res.status === 401 || res.status === 403 ? E.AUTH : res.status === 429 || res.status === 402 ? E.QUOTA : res.status === 404 && /model/i.test(msg) ? E.MODEL : classify(`${res.status} ${msg}`);
    throw new WorkerError(code, `HTTP ${res.status}: ${msg}`);
  }
  return json;
}

class HttpBackend2 {
  ep;
  kind;
  label;
  constructor(ep) {
    this.ep = ep;
    this.kind = ep.name;
    this.label = ep.label ?? ep.name;
  }
  async available() {
    const local = /127\.0\.0\.1|localhost/.test(this.ep.base_url);
    if (!local && !apiKey2(this.ep))
      return { ok: false, detail: `no API key (${this.ep.api_key_env ?? "credentials"})` };
    return { ok: true, detail: this.ep.base_url };
  }
  async models() {
    const key = apiKey2(this.ep);
    const url = this.ep.type === "anthropic" ? `${this.ep.base_url}/v1/models` : `${this.ep.base_url}/models`;
    const headers = { ...this.ep.headers ?? {} };
    if (this.ep.type === "anthropic") {
      if (key)
        headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (key)
      headers.authorization = `Bearer ${key}`;
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error(`cannot reach ${this.ep.base_url}`);
    }
    let j = {};
    try {
      j = await res.json();
    } catch {}
    if (!res.ok) {
      const msg = j?.error?.message ?? j?.message ?? "";
      throw new Error(`HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 160)}` : ""}`);
    }
    return (j?.data ?? []).map((m) => String(m.id)).sort();
  }
  async run(req) {
    const key = apiKey2(this.ep);
    if (!key && !/127\.0\.0\.1|localhost/.test(this.ep.base_url)) {
      throw new WorkerError(E.AUTH, `no API key for ${this.ep.name}: set ${this.ep.api_key_env ?? "it"} or run \`offload setup\``);
    }
    if (!req.model)
      throw new WorkerError(E.MODEL, `endpoint ${this.ep.name} needs a model id, e.g. ${this.ep.name}:<model>`);
    return this.ep.type === "anthropic" ? this.anthropic(req, key) : this.openai(req, key);
  }
  async openai(req, key) {
    const headers = { ...this.ep.headers ?? {} };
    if (key)
      headers.authorization = `Bearer ${key}`;
    const tools = req.task === "explore" ? TOOL_SPECS.map((t) => ({ type: "function", function: t })) : undefined;
    const messages = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt }
    ];
    let tokensIn = 0;
    let tokensOut = 0;
    let ctxIn = 0;
    const deadline = Date.now() + req.timeoutSec * 1000;
    const steps = req.task === "explore" ? req.maxSteps ?? 40 : 1;
    for (let step = 0;step < steps; step++) {
      const body = { model: req.model, messages };
      if (tools)
        body.tools = tools;
      if (req.variant)
        body.reasoning_effort = req.variant;
      const j = await post(`${this.ep.base_url}/chat/completions`, body, headers, Math.max(1000, deadline - Date.now()));
      tokensIn += j?.usage?.prompt_tokens ?? 0;
      tokensOut += j?.usage?.completion_tokens ?? 0;
      ctxIn = j?.usage?.prompt_tokens ?? ctxIn;
      const msg = j?.choices?.[0]?.message;
      if (!msg)
        throw new WorkerError(E.WORKER, "empty response");
      const calls = msg.tool_calls ?? [];
      if (!calls.length || !tools) {
        const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((p) => p.text ?? "").join("");
        if (!text.trim())
          throw new WorkerError(E.WORKER, "worker returned an empty answer");
        return { text, tokensIn, tokensOut, ctxIn, cost: 0 };
      }
      messages.push(msg);
      for (const c of calls) {
        let args = {};
        try {
          args = JSON.parse(c.function?.arguments || "{}");
        } catch {}
        messages.push({ role: "tool", tool_call_id: c.id, content: await runTool(c.function?.name, args, { root: req.cwd, secretGlobs: req.secretGlobs ?? [], allowGlobs: req.allowGlobs ?? [] }) });
      }
      if (step === steps - 2)
        messages.push({ role: "user", content: "Step budget almost used: answer now with what you found." });
    }
    throw new WorkerError(E.WORKER, `explore used all ${steps} steps without answering`);
  }
  async anthropic(req, key) {
    const headers = { "anthropic-version": "2023-06-01", ...this.ep.headers ?? {} };
    if (key)
      headers["x-api-key"] = key;
    const tools = req.task === "explore" ? TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) : undefined;
    const messages = [{ role: "user", content: req.prompt }];
    let tokensIn = 0;
    let tokensOut = 0;
    let ctxIn = 0;
    const deadline = Date.now() + req.timeoutSec * 1000;
    const steps = req.task === "explore" ? req.maxSteps ?? 40 : 1;
    for (let step = 0;step < steps; step++) {
      const body = { model: req.model, max_tokens: 8192, system: req.system, messages };
      if (tools)
        body.tools = tools;
      const j = await post(`${this.ep.base_url}/v1/messages`, body, headers, Math.max(1000, deadline - Date.now()));
      tokensIn += j?.usage?.input_tokens ?? 0;
      tokensOut += j?.usage?.output_tokens ?? 0;
      ctxIn = (j?.usage?.input_tokens ?? 0) + (j?.usage?.cache_read_input_tokens ?? 0);
      const content = j?.content ?? [];
      const uses = content.filter((b) => b.type === "tool_use");
      if (!uses.length || !tools) {
        const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
        if (!text.trim())
          throw new WorkerError(E.WORKER, "worker returned an empty answer");
        return { text, tokensIn, tokensOut, ctxIn, cost: 0 };
      }
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: await Promise.all(uses.map(async (u) => ({ type: "tool_result", tool_use_id: u.id, content: await runTool(u.name, u.input ?? {}, { root: req.cwd, secretGlobs: req.secretGlobs ?? [], allowGlobs: req.allowGlobs ?? [] }) })))
      });
    }
    throw new WorkerError(E.WORKER, `explore used all ${steps} steps without answering`);
  }
}

export { fileBytes, countLines, fileLines, estTokens, digitRuns, tokensOf, estTokensText, tokensMax, estTokensFile, isText, fmtInt, shquote, numberLines, stripWrappingFence, stripAnsi, truncate, PRESETS2, credentialsPath2, endpoint2, endpointNames2, apiKey2, HttpBackend2 };
