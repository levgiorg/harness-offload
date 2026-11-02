import {
  CONNECTORS,
  workerThreads,
  runProcess,
  which
} from "./chunk-yj9cq959.js";
import {
  configHome,
  cfg,
  cfgStr,
  globToRegExp,
  isSecretName,
  redact
} from "./chunk-e63v2s9a.js";
import {
  E,
  WorkerError,
  classify,
  workDir2,
  OpencodeBackend
} from "./chunk-qwa0fbdf.js";

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
var estTokens = (bytes) => Math.floor((bytes + 3) / 4);
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
var PRESETS = CONNECTORS.endpoints;
function credentialsPath() {
  return process.env.OFFLOAD_CREDENTIALS || join2(configHome(), "harness-offload", "credentials.json");
}
function storedKey(name) {
  try {
    const p = credentialsPath();
    if (!existsSync(p))
      return;
    const v = JSON.parse(readFileSync2(p, "utf8"));
    return typeof v?.[name] === "string" ? v[name] : undefined;
  } catch {
    return;
  }
}
function endpoint(name) {
  const fromCfg = cfg(`endpoints.${name}`);
  const preset = PRESETS[name];
  if (!fromCfg && !preset)
    return;
  const merged = { ...preset ?? {}, ...fromCfg ?? {} };
  if (!merged.type || !merged.base_url)
    return;
  return { ...merged, name };
}
function endpointNames() {
  const own = Object.keys(cfg("endpoints") ?? {});
  return [...new Set([...Object.keys(PRESETS), ...own])];
}
function apiKey(ep) {
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

class HttpBackend {
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
    if (!local && !apiKey(this.ep))
      return { ok: false, detail: `no API key (${this.ep.api_key_env ?? "credentials"})` };
    return { ok: true, detail: this.ep.base_url };
  }
  async models() {
    const key = apiKey(this.ep);
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
    const key = apiKey(this.ep);
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

// src/backends/agents.ts
import { readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
var jsonLines = (s) => s.split(`
`).flatMap((l) => {
  const t = l.trim();
  if (!t.startsWith("{"))
    return [];
  try {
    return [JSON.parse(t)];
  } catch {
    return [];
  }
});
function errSummary(text) {
  const lines = text.split(`
`).map((l) => l.trim()).filter(Boolean);
  if (!lines.length)
    return "";
  const first = lines[0];
  const last = lines[lines.length - 1];
  return (last !== first ? `${first} … ${last}` : first).slice(0, 400);
}
var lastJson = (s) => {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = jsonLines(t);
    if (lines.length)
      return lines[lines.length - 1];
    const ls = t.split(`
`);
    for (let i = ls.length - 1;i >= 0; i--) {
      if (!ls[i].startsWith("{"))
        continue;
      try {
        return JSON.parse(ls.slice(i).join(`
`));
      } catch {}
    }
    return;
  }
};
var empty = (text, extra = {}) => ({ text, tokensIn: 0, tokensOut: 0, ctxIn: 0, cost: 0, ...extra });
var CRUSH_TOOLS = ["agent", "bash", "crush_info", "crush_logs", "job_output", "job_kill", "download", "edit", "multiedit", "lsp_diagnostics", "lsp_references", "lsp_restart", "lsp_symbols", "lsp_definition", "lsp_call_hierarchy", "lsp_rename", "lsp_replace_symbol", "fetch", "agentic_fetch", "glob", "grep", "ls", "question", "sourcegraph", "todos", "view", "write", "list_mcp_resources", "read_mcp_resource"];
function crushLockdown() {
  const dir = process.env.CRUSH_GLOBAL_CONFIG || join3(process.env.XDG_CONFIG_HOME || join3(homedir(), ".config"), "crush");
  const mcp = {};
  try {
    for (const name of Object.keys(JSON.parse(readFileSync3(join3(dir, "crush.json"), "utf8")).mcp ?? {}))
      mcp[name] = { disabled: true };
  } catch {}
  return { options: { disabled_tools: CRUSH_TOOLS }, ...Object.keys(mcp).length ? { mcp } : {} };
}
var merged = (req) => `<instructions>
${req.system}
</instructions>

${req.prompt}`;
var CLI_AGENTS = {
  claude: {
    label: "Claude Code (claude -p) — your Claude plan (Haiku)",
    models: async () => ["haiku", "sonnet"],
    bin: "claude",
    install: "https://claude.com/claude-code",
    args: (req) => {
      const a = ["-p", "--output-format", "json", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", req.system];
      if (req.model)
        a.push("--model", req.model);
      if (req.task === "explore") {
        a.push("--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob");
        const deny = (req.secretGlobs ?? []).map((g) => `Read(**/${g})`).join(",");
        if (deny)
          a.push("--disallowedTools", deny);
      } else
        a.push("--tools", "");
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j)
        throw new WorkerError(E.WORKER, "claude: no JSON output");
      if (j.is_error)
        throw new WorkerError(classify(String(j.result ?? j.error ?? "error")), `claude: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      return empty(String(j.result ?? ""), {
        tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        tokensOut: u.output_tokens ?? 0,
        cost: j.total_cost_usd ?? 0
      });
    }
  },
  codex: {
    label: "OpenAI Codex CLI (codex exec) — ChatGPT plan",
    models: async () => ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"],
    bin: "codex",
    install: "npm i -g @openai/codex  (then: codex login)",
    args: (req) => {
      const a = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--disable", "hooks", "--ignore-rules", "-C", req.cwd];
      if (req.model)
        a.push("-m", req.model);
      if (req.variant)
        a.push("-c", `model_reasoning_effort="${req.variant}"`);
      a.push("-");
      return { args: a, input: merged(req) };
    },
    parse: (out) => {
      let text = "";
      let tin = 0;
      let tout = 0;
      let failure = "";
      for (const e of jsonLines(out)) {
        const item = e.item ?? {};
        if (e.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string")
          text = item.text;
        if (e.type === "turn.completed" && e.usage) {
          tin += (e.usage.input_tokens ?? 0) + (e.usage.cached_input_tokens ?? 0);
          tout += e.usage.output_tokens ?? 0;
        }
        if (e.type === "turn.failed")
          failure = e.error?.message ?? JSON.stringify(e.error ?? e);
        if (e.type === "error" && typeof e.message === "string" && !failure)
          failure = e.message;
      }
      if (!text.trim() && failure)
        throw new WorkerError(classify(failure), `codex: ${failure}`);
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    }
  },
  gemini: {
    label: "Gemini CLI (gemini -p) — Google account",
    models: async () => ["flash-lite", "flash", "pro"],
    bin: "gemini",
    install: "npm i -g @google/gemini-cli",
    args: (req) => {
      const a = ["-o", "json", "--approval-mode", "plan", "--skip-trust", "-e", "none"];
      if (req.model)
        a.push("-m", req.model);
      a.push("-p", "Answer as instructed above.");
      return { args: a, input: req.prompt };
    },
    env: (req, dir) => {
      const file = join3(dir, `gemini-system-${req.task}.md`);
      writeFileSync(file, req.system);
      return { GEMINI_SYSTEM_MD: file, GEMINI_CLI_TRUST_WORKSPACE: "true" };
    },
    parse: (out, err) => {
      const j = lastJson(out) ?? lastJson(err);
      if (!j)
        throw new WorkerError(E.WORKER, "gemini: no JSON output");
      if (j.error) {
        const code = j.error.code === 41 ? E.AUTH : classify(String(j.error.message ?? j.error.type ?? ""));
        throw new WorkerError(code, `gemini: ${j.error.message ?? JSON.stringify(j.error)}`);
      }
      let tin = 0;
      let tout = 0;
      for (const m of Object.values(j.stats?.models ?? {})) {
        tin += m?.tokens?.prompt ?? m?.tokens?.input ?? 0;
        tout += m?.tokens?.candidates ?? m?.tokens?.output ?? 0;
      }
      return empty(String(j.response ?? ""), { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    },
    exitCode: (code) => code === 41 ? E.AUTH : code === 53 ? E.WORKER : undefined
  },
  pi: {
    label: "Pi coding agent (pi -p) — its logins and API keys",
    models: async () => {
      const r = await runProcess(cfgStr("agents.pi.bin", "pi"), ["--list-models"], { timeoutMs: 30000 });
      return r.stdout.split(`
`).slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && c[0] && c[1]).map((c) => `${c[0]}/${c[1]}`);
    },
    bin: "pi",
    install: "npm i -g @earendil-works/pi-coding-agent",
    args: (req) => {
      const a = ["-p", "--mode", "json", "--no-session", "-na", "-ne", "-ns", "-nc", "--no-mcp", "--system-prompt", req.system];
      if (req.task === "explore")
        a.push("--tools", "read,grep,find,ls");
      else
        a.push("--no-tools");
      if (req.model)
        a.push("--model", req.variant ? `${req.model}:${req.variant}` : req.model);
      a.push(`

Answer as instructed above.`);
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      let text = "";
      let tin = 0;
      let tout = 0;
      let cost = 0;
      for (const e of jsonLines(out)) {
        const m = e.message ?? {};
        if (e.type !== "message_end" || m.role !== "assistant")
          continue;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          const msg = String(m.errorMessage ?? m.stopReason);
          throw new WorkerError(classify(msg), `pi: ${msg}`);
        }
        const t = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (t.trim())
          text = t;
        const u = m.usage ?? {};
        tin = Math.max(tin, (u.input ?? 0) + (u.cacheRead ?? 0));
        tout += u.output ?? 0;
        cost += u.cost?.total ?? 0;
      }
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin, cost });
    }
  },
  copilot: {
    label: "GitHub Copilot CLI (copilot) — your Copilot plan",
    bin: "copilot",
    install: "npm i -g @github/copilot  (then run copilot once and /login)",
    args: (req) => {
      const a = ["--output-format", "json", "-s", "--no-custom-instructions", "--no-ask-user", "--disable-builtin-mcps", "--no-auto-update"];
      if (req.model)
        a.push("--model", req.model);
      if (req.variant)
        a.push("--reasoning-effort", req.variant);
      if (req.task === "explore")
        a.push("--allow-all-tools", "--available-tools", "view", "grep", "glob");
      else
        a.push("--available-tools", "none");
      return { args: a, input: merged(req) };
    },
    parse: (out) => {
      let text = "";
      let failure = "";
      for (const e of jsonLines(out)) {
        if (e.type === "assistant.message" && typeof e.data?.content === "string" && e.data.content.trim())
          text = e.data.content;
        if (e.type === "session.error")
          failure = `${e.data?.errorType ?? ""} ${e.data?.message ?? ""}`.trim();
      }
      if (!text.trim() && failure)
        throw new WorkerError(classify(failure), `copilot: ${failure}`);
      return empty(text);
    }
  },
  qwen: {
    label: "Qwen Code (qwen) — your Qwen account or keys",
    bin: "qwen",
    install: "npm i -g @qwen-code/qwen-code  (then run qwen once and /auth)",
    args: (req) => {
      const a = ["--output-format", "json", "--system-prompt", req.system, "--approval-mode", "plan", "--chat-recording", "false", "-e", "none"];
      if (req.model)
        a.push("-m", req.model);
      a.push("--core-tools", ...req.task === "explore" ? ["read_file", "grep_search", "glob"] : ["none"]);
      a.push("--", "Answer as instructed above.");
      return { args: a, input: req.prompt };
    },
    env: (req, dir) => {
      const file = join3(dir, "qwen-worker-settings.json");
      writeFileSync(file, JSON.stringify({ memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false } }));
      return { QWEN_CODE_SYSTEM_SETTINGS_PATH: file };
    },
    parse: (out) => {
      let events = [];
      try {
        const j = JSON.parse(out.trim());
        events = Array.isArray(j) ? j : [j];
      } catch {
        events = jsonLines(out);
      }
      const r = [...events].reverse().find((e) => e?.type === "result");
      if (!r)
        throw new WorkerError(E.WORKER, "qwen: no result in its output");
      if (r.is_error) {
        const msg = String(r.result ?? r.error?.message ?? r.error ?? "error");
        throw new WorkerError(classify(msg), `qwen: ${msg}`);
      }
      const u = r.usage ?? {};
      const tin = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      return empty(String(r.result ?? ""), { tokensIn: tin, tokensOut: u.output_tokens ?? 0, ctxIn: tin });
    }
  },
  crush: {
    label: "Crush (crush run) — your Crush providers",
    bin: "crush",
    install: "brew install charmbracelet/tap/crush  or  npm i -g @charmland/crush",
    args: (req) => {
      if (req.task === "explore")
        throw new WorkerError(E.USAGE, "crush: `crush run` approves every tool call, so it is not used as a read-only explorer; the next model in the chain takes over");
      const a = ["run", "-q"];
      if (req.model)
        a.push("-m", req.model);
      if (req.variant)
        a.push("--reasoning-effort", req.variant);
      a.push("Answer as instructed above.");
      return { args: a, input: merged(req) };
    },
    env: (req) => {
      writeFileSync(join3(req.cwd, ".crush.json"), JSON.stringify(crushLockdown()));
      return {};
    },
    parse: (out) => empty(out.trim())
  },
  cursor: {
    label: "Cursor CLI (cursor-agent -p) — Cursor plan",
    bin: "cursor-agent",
    install: "curl https://cursor.com/install -fsS | bash  (then: cursor-agent login)",
    args: (req) => {
      const a = ["-p", "--output-format", "json", "--mode", "ask", "--trust", "--workspace", req.cwd];
      if (req.model)
        a.push("--model", req.model);
      a.push(merged(req));
      return { args: a, input: "" };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j)
        throw new WorkerError(E.WORKER, "cursor-agent: no JSON output");
      if (j.is_error)
        throw new WorkerError(classify(String(j.result ?? "error")), `cursor-agent: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      return empty(String(j.result ?? ""), { tokensIn: (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0), tokensOut: u.outputTokens ?? 0, ctxIn: u.inputTokens ?? 0 });
    }
  }
};
function cliAgentBackend(name) {
  const spec = CLI_AGENTS[name];
  const bin = () => cfgStr(`agents.${name}.bin`, spec.bin);
  return {
    kind: name,
    label: spec.label,
    models: spec.models,
    async available() {
      const p = await which(bin());
      return p ? { ok: true, detail: p } : { ok: false, detail: `${bin()} not found — ${spec.install}` };
    },
    async run(req) {
      if (!await which(bin()))
        throw new WorkerError(E.MISSING, `${bin()} not found — install: ${spec.install}`);
      const { args, input } = spec.args(req);
      const env = { ...process.env, OFFLOAD_DISABLE: "1", ...spec.env ? spec.env(req, workDir2()) : {} };
      const r = await runProcess(bin(), args, { input, cwd: req.cwd, env, timeoutMs: req.timeoutSec * 1000 });
      if (r.timedOut)
        throw new WorkerError(E.TIMEOUT, `timed out after ${req.timeoutSec}s`);
      const mapped = spec.exitCode?.(r.code);
      let res;
      try {
        res = spec.parse(r.stdout, r.stderr);
      } catch (e) {
        if (e instanceof WorkerError && e.code === E.WORKER && r.code !== 0 && /no (json|result)/i.test(e.message)) {
          const tail = errSummary(r.stderr);
          if (tail)
            throw new WorkerError(mapped ?? classify(tail), `${name}: ${tail}`);
        }
        if (e instanceof WorkerError)
          throw mapped !== undefined && e.code === E.WORKER ? new WorkerError(mapped, e.message) : e;
        throw new WorkerError(mapped ?? E.WORKER, `${name}: ${e.message}`);
      }
      if (!res.text.trim()) {
        const msg = errSummary(r.stderr || r.stdout);
        throw new WorkerError(mapped ?? (r.code !== 0 ? classify(msg) : E.WORKER), `${name}: ${msg || "empty answer"}`);
      }
      return res;
    }
  };
}

// src/backends/registry.ts
var LOCAL = new Set(["opencode", ...Object.keys(CLI_AGENTS)]);
function detectHost() {
  const e = process.env;
  if (e.OFFLOAD_HOST)
    return e.OFFLOAD_HOST;
  if (e.COPILOT_CLI === "1")
    return "copilot";
  if (e.QWEN_CODE_SESSION_ID || e.QWEN_PROJECT_DIR)
    return "qwen";
  if (e.CRUSH === "1" || e.CRUSH_SESSION_ID)
    return "crush";
  if (e.CLAUDECODE === "1" || e.CLAUDE_CODE_ENTRYPOINT)
    return "claude";
  if (e.CODEX_THREAD_ID || e.CODEX_SANDBOX || e.CODEX_CI)
    return "codex";
  if (e.CURSOR_AGENT || e.CURSOR_CONVERSATION_ID)
    return "cursor";
  if (e.GEMINI_CLI === "1" || e.GEMINI_SESSION_ID)
    return "gemini";
  if (e.OPENCODE === "1" || e.OPENCODE_SESSION_ID)
    return "opencode";
  if (e.PI_CODING_AGENT === "1" || e.PI_SESSION_ID)
    return "pi";
  return;
}
function hostModel(host = detectHost()) {
  if (!host)
    return;
  const own = cfg(`host_models.${host}`);
  if (typeof own === "string")
    return own;
  return CONNECTORS.host_models[host];
}
function hostApiModel(host = detectHost()) {
  if (!host)
    return;
  const own = cfg(`host_api_models.${host}`);
  if (typeof own === "string")
    return own || undefined;
  return CONNECTORS.host_api_models?.[host];
}
function parseRef(ref) {
  const def = cfgStr("backend", "opencode");
  if (ref === "@host" || ref === "@self") {
    const m = hostModel();
    if (m === undefined)
      throw new Error("@host: cannot tell which agent harness is calling (set OFFLOAD_HOST=claude|codex|gemini|cursor|pi|opencode)");
    if (m === "@host" || m === "@self")
      return { backend: def, model: "", ref: "@default" };
    return parseRef(m);
  }
  if (ref === "@host-api") {
    const h = detectHost();
    if (!h)
      throw new Error("@host-api: cannot tell which agent harness is calling (set OFFLOAD_HOST)");
    const m = hostApiModel(h);
    if (!m || m.startsWith("@"))
      throw new Error(`@host-api: ${h} has no API-key backup (set host_api_models.${h} to a BACKEND:MODEL)`);
    const name = m.slice(0, m.indexOf(":"));
    const ep = endpoint(name);
    if (ep && !/127\.0\.0\.1|localhost/.test(ep.base_url) && !apiKey(ep)) {
      throw new Error(`@host-api: no API key for ${name} yet (offload key ${name}, or export ${ep.api_key_env ?? "its key"})`);
    }
    return parseRef(m);
  }
  if (!ref || ref === "@default")
    return { backend: def, model: "", ref: "@default" };
  const i = ref.indexOf(":");
  if (i > 0) {
    const prefix = ref.slice(0, i);
    if (LOCAL.has(prefix) || endpointNames().includes(prefix))
      return { backend: prefix, model: ref.slice(i + 1), ref };
  }
  return { backend: def, model: ref, ref };
}
var cache = new Map;
function backendFor(name) {
  if (cache.has(name))
    return cache.get(name);
  let b;
  if (name === "opencode")
    b = new OpencodeBackend;
  else if (name in CLI_AGENTS)
    b = cliAgentBackend(name);
  else {
    const ep = endpoint(name);
    if (ep)
      b = new HttpBackend(ep);
  }
  if (b)
    cache.set(name, b);
  return b;
}
function allBackendNames() {
  return ["opencode", ...Object.keys(CLI_AGENTS), ...endpointNames()];
}

export { fileBytes, countLines, fileLines, estTokens, isText, fmtInt, shquote, numberLines, stripWrappingFence, stripAnsi, truncate, PRESETS, credentialsPath, endpoint, apiKey, CLI_AGENTS, detectHost, hostModel, hostApiModel, parseRef, backendFor, allBackendNames };
