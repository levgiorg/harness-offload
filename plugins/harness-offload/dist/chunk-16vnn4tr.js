import {
  CONNECTORS
} from "./chunk-31bdmre5.js";
import {
  loadConfig2,
  cfgStr2,
  cfgInt2,
  cfgBool2,
  cfgList2,
  matchesAny,
  isSecretTarget,
  redact
} from "./chunk-t2kssrkb.js";
import {
  fileBytes,
  fileLines,
  estTokens,
  isText,
  fmtInt,
  shquote
} from "./chunk-ay6k04v0.js";
import {
  stateDir2,
  appendStats2,
  newLogPath2,
  sameFile2,
  seenFile2,
  seenCmdFile2,
  cooling2
} from "./chunk-9wbe25j8.js";
import {
  CLI_AGENTS,
  parseRef,
  backendFor
} from "./chunk-fsknd7zt.js";
import {
  modelChain2
} from "./chunk-w1fzxj4r.js";
import {
  BIG,
  textSrc,
  logSrc,
  digest,
  searchView,
  diffView,
  posixToJs2,
  outline2
} from "./chunk-fj9gbw5z.js";
import {
  taskSummary
} from "./chunk-3shk5whq.js";

// src/hooks/logic.ts
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
function workerWords2() {
  let p;
  try {
    p = parseRef(modelChain2("read")[0] ?? "@default");
  } catch {
    return "a cheap model";
  }
  const names = CONNECTORS.worker_names ?? {};
  const label = names.models?.[p.model] ?? p.model;
  if (p.backend === "opencode")
    return p.model ? `${p.model} via OpenCode` : "OpenCode's default model";
  if (p.backend in CLI_AGENTS)
    return `${label || "the default model"} on ${names.plans?.[p.backend] ?? p.backend}`;
  return `${label || "its default model"} via the ${p.backend} API`;
}
var PAUSED_MESSAGE2 = "Harness Offload is paused: it found no model to hand work to, so your tools work as usual. /harness-offload:setup sets one up (or run: offload doctor).";
var welcomeMessage2 = () => `Harness Offload is on: huge file reads and long command output now go to ${workerWords2()} instead of filling this session. Nothing to set up — /harness-offload:setup changes who does the work.`;
function firstSession2() {
  const mark = join(stateDir2(), "welcome-shown");
  if (existsSync(mark))
    return false;
  try {
    writeFileSync(mark, "");
  } catch {
    return false;
  }
  return true;
}
function callStyle(host) {
  if (host === "pi")
    return "mcp";
  if (host === "codex" || host === "cursor")
    return cfgStr2(`hosts.${host}.call`, "mcp") === "shell" ? "shell" : "mcp";
  return "shell";
}
function enabled() {
  loadConfig2();
  return cfgBool2("enabled", true);
}
async function available2() {
  if (!enabled())
    return false;
  const parse = (raw) => {
    try {
      return parseRef(raw);
    } catch {
      return;
    }
  };
  let present = false;
  for (const task of ["read", "summarize"]) {
    const first = modelChain2(task)[0];
    const parsed = first ? parse(first) : undefined;
    const b = parsed && backendFor(parsed.backend);
    if (b && (await b.available()).ok) {
      present = true;
      break;
    }
  }
  if (!present)
    return false;
  for (const task of ["read", "summarize"]) {
    for (const raw of modelChain2(task)) {
      const parsed = parse(raw);
      if (parsed && backendFor(parsed.backend) && !cooling2(parsed.ref))
        return true;
    }
  }
  return false;
}
function ignored(p) {
  const globs = cfgList2("hooks.ignore_globs");
  return matchesAny(p, globs) || matchesAny(basename(p), globs);
}
var BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|ipynb|zip|gz|tgz|tar|jar|wasm|so|dylib|dll|exe|bin|pyc|class|o|a|mp3|mp4|mov|woff2?|ttf|otf)$/i;
function notForOffload(p) {
  return BINARY.test(p) || !isText(p) || isSecretTarget(p);
}
function guard(message) {
  switch (cfgStr2("hooks.read_guard", "block")) {
    case "off":
      return;
    case "ask":
      return { action: "ask", message };
    case "suggest":
      return { action: "note", message: `offload (advice, not enforced): ${message}` };
    default:
      return { action: "deny", message };
  }
}
var cliCache;
function cliCommand() {
  if (cliCache)
    return cliCache;
  if (process.env.OFFLOAD_CLI_COMMAND)
    return cliCache = process.env.OFFLOAD_CLI_COMMAND;
  const onPath = (process.env.PATH ?? "").split(delimiter).some((d) => d && (existsSync(join(d, "offload")) || existsSync(join(d, "offload.cmd"))));
  if (onPath)
    return cliCache = "offload";
  try {
    const js = fileURLToPath(new URL("./cli.js", import.meta.url));
    if (existsSync(js))
      return cliCache = `node ${shquote(js)}`;
  } catch {}
  return cliCache = "offload";
}
function readCmd(host, file) {
  return callStyle(host) === "mcp" ? `the offload_read tool (question + paths: ["${file}"])` : `Bash: ${cliCommand()} read -q "<specific question>" ${shquote(file)}`;
}
function exploreCmd(host) {
  return callStyle(host) === "mcp" ? "the offload_explore tool" : `Bash: ${cliCommand()} explore "<question>"`;
}
var LOCK_TOOLS = {
  "package-lock.json": "npm ls NAME",
  "npm-shrinkwrap.json": "npm ls NAME",
  "yarn.lock": "yarn why NAME",
  "pnpm-lock.yaml": "pnpm why NAME",
  "bun.lock": "bun pm ls",
  "Cargo.lock": "cargo tree -i NAME",
  "poetry.lock": "poetry show NAME",
  "uv.lock": "uv tree --package NAME",
  "Pipfile.lock": "pipenv graph",
  "Gemfile.lock": "bundle info NAME",
  "composer.lock": "composer show NAME",
  "go.sum": "go mod why -m NAME"
};
function lockTool(file) {
  const b = file.slice(file.lastIndexOf("/") + 1);
  return Object.hasOwn(LOCK_TOOLS, b) ? LOCK_TOOLS[b] : undefined;
}
var jsonType = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
function jsonDesc(v) {
  const t = jsonType(v);
  if (t === "object") {
    const n = Object.keys(v).length;
    return { text: `object, ${fmtInt(n)} ${n === 1 ? "key" : "keys"}`, kind: "o", n };
  }
  if (t === "array") {
    const a = v;
    const n = a.length;
    if (n === 0)
      return { text: "array, empty", kind: "a", n };
    const types = new Set(a.map(jsonType));
    const one = types.size === 1 ? [...types][0] : "mixed";
    const text = one === "mixed" ? `array, ${fmtInt(n)} ${n === 1 ? "item" : "items"} (mixed)` : `array, ${fmtInt(n)} ${one}${n === 1 ? "" : "s"}`;
    return { text, kind: "a", n };
  }
  return { text: t, kind: t, n: 0 };
}
function jsonStructure(file, bytes, shown = file) {
  if (bytes > 16777216)
    return;
  let v;
  try {
    v = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const q = shquote(shown);
  const top = jsonDesc(v);
  const lines = [`  ${top.text}`];
  if (top.kind === "a")
    return { lines, hint: `jq 'length' ${q} · jq '.[0]' ${q}` };
  if (top.kind !== "o")
    return { lines };
  const entries = Object.entries(v);
  let key = "", kt = "", best = 0, first = "";
  for (const [k, val] of entries.slice(0, 30)) {
    const kj = JSON.stringify(k);
    const d = jsonDesc(val);
    lines.push(`  ${kj}: ${d.text}`);
    if ((d.kind === "a" || d.kind === "o") && (key === "" || d.n > best))
      [key, kt, best] = [kj, d.kind, d.n];
    if (first === "")
      first = kj;
  }
  if (entries.length > 30)
    lines.push(`  … ${fmtInt(entries.length - 30)} more keys`);
  let h = `jq 'keys' ${q}`;
  const k = key || first;
  let p = "";
  if (/^"[A-Za-z_][A-Za-z0-9_]*"$/.test(k))
    p = "." + k.slice(1, -1);
  else if (k && !k.includes("'") && !k.includes("\\"))
    p = `.[${k}]`;
  if (p && kt === "a")
    h += ` · jq '${p} | length' ${q} · jq '${p}[0]' ${q}`;
  else if (p && kt === "o")
    h += ` · jq '${p} | keys[0:20]' ${q}`;
  else if (p)
    h += ` · jq '${p}' ${q}`;
  return { lines, hint: h };
}
function jsonView(log, cmd, lines, bytes) {
  const t0 = Date.now();
  const js = jsonStructure(log, bytes);
  if (!js?.hint)
    return;
  const label = redact(cmd);
  const out = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(lines)} lines / ${Math.ceil(bytes / 1024)} KB of JSON · full log: ${log}
── structure ──
${js.lines.join(`
`)}
── query it instead of reading it ──
${js.hint}`;
  const bout = Buffer.byteLength(out);
  appendStats2({
    kind: "digest",
    source: "json",
    label,
    log,
    model: "",
    bytes_in: bytes,
    bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)),
    seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: false,
    model_tried: false,
    worker_tokens_in: 0,
    worker_tokens_out: 0
  });
  return out;
}
function bigFileMessage2(host, file, lines, tokens, how) {
  const chunk = cfgInt2("hooks.read_max_chunk_lines", 600);
  const bytes = fileBytes(file);
  const avg = Math.floor(bytes / (lines > 0 ? lines : 1));
  const long = avg > 4000;
  const lock = lockTool(file);
  const js = /\.json$/i.test(file) ? jsonStructure(file, bytes) : undefined;
  let m = `offload: ${how} would put all of ${file} into your context (${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens; limit ${cfgStr2("hooks.read_threshold_lines")} lines / ${fmtInt(cfgInt2("hooks.read_threshold_tokens", 6000))} tokens).
`;
  if (lock)
    m += `It is a lockfile, written by the package manager: \`${lock}\` answers "which version, who needs it" without reading it.
`;
  if (long)
    m += `Its lines average ${fmtInt(avg)} characters (minified or generated), so line slices do not help.
`;
  m += `Pick the cheapest option:
`;
  m += long ? `- Need exact text? Bash: grep -noE '.{0,80}PATTERN.{0,80}' ${shquote(file)} shows each match with 80 characters around it.
` : `- Need exact text (to edit/quote)? Read a slice (max ${chunk} lines per call) — outline below; \`grep -n PATTERN ${shquote(file)}\` finds more.
`;
  if (js?.hint)
    m += `- Need values? Bash: ${js.hint}
`;
  m += `- Need understanding/facts? Use ${readCmd(host, file)}
  A cheap model answers with ${file}:Lx-Ly citations whose quotes are checked; then read only those lines if you must edit.
- Question spans many files? Use ${exploreCmd(host)}
`;
  if (js)
    m += `Structure of ${file}:
${js.lines.join(`
`)}
`;
  if (!long) {
    const out = outline2(file, 40);
    if (out)
      m += `Outline of ${file}:
${out}`;
  }
  return m.replace(/\n+$/, "");
}
function contextUsed(transcript) {
  if (!transcript || !existsSync(transcript))
    return;
  try {
    const size = statSync(transcript).size;
    const len = Math.min(size, 400000);
    const buf = Buffer.alloc(len);
    const fd = openSync(transcript, "r");
    try {
      readSync(fd, buf, 0, len, size - len);
    } finally {
      closeSync(fd);
    }
    const line = buf.toString("utf8").split(`
`).filter((l) => l.includes('"usage"')).pop();
    if (!line)
      return;
    const j = JSON.parse(line);
    const u = j.message?.usage ?? j.usage;
    if (!u)
      return;
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  } catch {
    return;
  }
}
function readGuard2(host, cwd, file, offset, limit, transcript) {
  if (!enabled() || cfgStr2("hooks.read_guard", "block") === "off" || !file)
    return;
  const p = isAbsolute(file) ? file : resolve(cwd, file);
  if (!existsSync(p) || !statSync(p).isFile())
    return;
  if (ignored(file) || notForOffload(p))
    return;
  const lines = fileLines(p);
  const tokens = estTokens(fileBytes(p));
  const chunk = cfgInt2("hooks.read_max_chunk_lines", 600);
  if (offset !== undefined || limit !== undefined) {
    const start = Math.max(1, offset ?? 1);
    const remaining = lines - start + 1;
    let span = limit !== undefined ? limit : remaining;
    if (span > remaining)
      span = remaining;
    const avg = Math.floor(fileBytes(p) / (lines > 0 ? lines : 1));
    const sliceTokens = Math.floor((span * avg + 3) / 4);
    if (avg > 4000 && sliceTokens > cfgInt2("hooks.read_threshold_tokens", 6000)) {
      appendStats2({ kind: "hook", event: "read_slice_blocked", host, lines: span, file });
      return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}, but its lines average ${fmtInt(avg)} characters (minified or generated): ~${fmtInt(sliceTokens)} tokens. Bash: grep -noE '.{0,80}PATTERN.{0,80}' ${shquote(file)} shows each match with 80 characters around it, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}`);
    }
    if (span <= chunk)
      return;
    appendStats2({ kind: "hook", event: "read_slice_blocked", host, lines: span, file });
    return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}; keep slices to at most ${chunk} lines, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}:${start}-${start + span - 1}`);
  }
  let maxLines = cfgInt2("hooks.read_threshold_lines", 600);
  let maxTokens = cfgInt2("hooks.read_threshold_tokens", 6000);
  let note = "";
  let used;
  if (lines <= maxLines && tokens <= maxTokens) {
    const tight = cfgInt2("hooks.context_tight_tokens", 0);
    if (!(tight > 0 && (lines > maxLines / 2 || tokens > maxTokens / 2)))
      return;
    used = contextUsed(transcript);
    if (used === undefined || used < tight)
      return;
    maxLines = Math.floor(maxLines / 2);
    maxTokens = Math.floor(maxTokens / 2);
    if (lines <= maxLines && tokens <= maxTokens)
      return;
    note = `
(Your context is nearly full: ~${fmtInt(used)} tokens in use, at or above hooks.context_tight_tokens, so the limit is halved.)`;
  }
  appendStats2({ kind: "hook", event: "read_blocked", host, lines, tokens, file, ...used !== undefined ? { context: used } : {} });
  return guard(bigFileMessage2(host, file, lines, tokens, "A full read") + note);
}
function autowrap2(command, background) {
  if (!enabled() || !command || background || !cfgBool2("hooks.autowrap", false))
    return;
  const pat = cfgStr2("hooks.autowrap_pattern");
  if (!pat)
    return;
  try {
    const re = new RegExp(posixToJs2(pat));
    if (!command.split(`
`).some((l) => re.test(l)))
      return;
  } catch {
    return;
  }
  appendStats2({ kind: "hook", event: "autowrap", command: redact(command) });
  return `${cliCommand()} run -c ${shquote(command)}`;
}
function bashGuard2(host, cwd, command) {
  if (!enabled() || !command || !cfgBool2("hooks.bash_read_guard", true) || cfgStr2("hooks.read_guard", "block") === "off")
    return;
  if (/^OFFLOAD_RAW=1/.test(command) || /offload /.test(command))
    return;
  if (/[|><;`]|&&|\|\||\$\(/.test(command))
    return;
  const words = command.trim().split(/\s+/);
  const prog = words.shift() ?? "";
  if (!["cat", "nl", "bat", "batcat", "less", "more", "head", "tail", "sed"].includes(prog))
    return;
  let n = "";
  let range = "";
  const files = [];
  for (let i = 0;i < words.length; i++) {
    const a = words[i];
    if (prog === "head" || prog === "tail") {
      if (a === "-n" || a === "--lines") {
        if (i + 1 >= words.length)
          return;
        n = words[++i];
        continue;
      }
      if (/^-n\+?\d/.test(a))
        n = a.slice(2);
      else if (a.startsWith("--lines="))
        n = a.slice(8);
      else if (/^-\d/.test(a))
        n = a.slice(1);
      else if (["-f", "-F"].includes(a) || a.startsWith("--follow") || a.startsWith("-c") || a.startsWith("--bytes"))
        return;
    }
    if (a.startsWith("-"))
      continue;
    const clean = a.replace(/["']/g, "");
    const abs = isAbsolute(clean) ? clean : resolve(cwd, clean);
    if (prog === "sed" && !range && !existsSync(abs))
      range = clean;
    else
      files.push(clean);
  }
  const chunk = cfgInt2("hooks.read_max_chunk_lines", 600);
  const maxLines = cfgInt2("hooks.read_threshold_lines", 600);
  const maxTokens = cfgInt2("hooks.read_threshold_tokens", 6000);
  for (const f of files) {
    const p = isAbsolute(f) ? f : resolve(cwd, f);
    if (!existsSync(p) || !statSync(p).isFile() || ignored(f) || notForOffload(p))
      continue;
    const lines = fileLines(p);
    const tokens = estTokens(fileBytes(p));
    let span = lines;
    if (prog === "head" || prog === "tail") {
      span = Math.min(Number(n.replace(/\D/g, "")) || 10, lines);
      if (span <= chunk)
        continue;
    } else if (prog === "sed") {
      const m = range.match(/^(\d+),(\d+|\$)p$/);
      if (!m)
        continue;
      const b = m[2] === "$" ? lines : Number(m[2]);
      span = b - Number(m[1]) + 1;
      if (span <= chunk)
        continue;
    } else if (lines <= maxLines && tokens <= maxTokens)
      continue;
    if (span <= maxLines && lines <= maxLines && tokens <= maxTokens)
      continue;
    appendStats2({ kind: "hook", event: "bash_read_blocked", host, lines, tokens, prog, file: f });
    return guard(bigFileMessage2(host, f, lines, tokens, `\`${prog}\``));
  }
  return;
}
async function postBash2(opts) {
  if (!enabled() || !cfgBool2("hooks.summarize_bash_output", true))
    return;
  const cmd = opts.command ?? "";
  if (!cmd || /^OFFLOAD_RAW=1/.test(cmd) || opts.background || opts.interrupted)
    return;
  const lastLine = cmd.trim().split(`
`).pop() ?? "";
  const last = lastLine.split(/\|\||&&|;|\|/).pop() ?? "";
  let search = false;
  const sre = cfgBool2("hooks.search_view", true) ? cfgStr2("hooks.search_commands") : "";
  if (sre) {
    try {
      const { posixToJs } = await import("./chunk-3x3wsxar.js");
      search = new RegExp(posixToJs(sre)).test(last);
    } catch {
      search = false;
    }
  }
  const diffv = !search && cfgBool2("hooks.diff_view", true) && /^\s*git\s+(diff|show)(\s|$)/.test(last);
  const never = cfgStr2("hooks.bash_never_summarize");
  if (never && !search && !diffv) {
    try {
      const { posixToJs } = await import("./chunk-3x3wsxar.js");
      if (new RegExp(posixToJs(never)).test(last))
        return;
    } catch {
      return;
    }
  }
  let text = opts.output;
  let bytesBuf;
  let compact = false;
  let bigFile;
  if (opts.persistedPath && existsSync(opts.persistedPath)) {
    compact = true;
    if (statSync(opts.persistedPath).size > BIG) {
      bigFile = opts.persistedPath;
      text = undefined;
    } else {
      bytesBuf = readFileSync(opts.persistedPath);
      text = bytesBuf.toString("utf8");
    }
  }
  const src = bigFile ? logSrc(bigFile) : textSrc(text);
  const lines = src.count();
  if (lines <= cfgInt2("hooks.bash_output_threshold_lines", 250) && src.bytes <= cfgInt2("hooks.bash_output_threshold_bytes", 20000))
    return;
  if (diffv) {
    let isDiff = false;
    for (const l of src.lines())
      if (l.startsWith("diff --git ")) {
        isDiff = true;
        break;
      }
    if (!isDiff)
      return;
  }
  let jsonv = false;
  if (!search && !diffv && src.bytes <= 16777216 && cfgBool2("hooks.json_view", true)) {
    for (const l of src.lines()) {
      const t = l.replace(/^[ \t]+/, "");
      if (!t)
        continue;
      jsonv = t[0] === "{" || t[0] === "[";
      break;
    }
  }
  let raw = bigFile ? undefined : bytesBuf ??= Buffer.from(text);
  const seen = opts.session ? seenFile2(opts.session, raw ?? { file: bigFile }) : "";
  if (seen && existsSync(seen)) {
    const m = /^(\d+) (\S+) (.*)$/.exec(readFileSync(seen, "utf8").replace(/\n$/, ""));
    if (m && Math.floor(Date.now() / 1000) - Number(m[1]) <= 3600 && existsSync(m[3]) && (raw ? readFileSync(m[3]).equals(raw) : sameFile2(m[3], bigFile))) {
      const label = redact(cmd);
      const bytes = src.bytes;
      const note = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(lines)} lines / ${Math.ceil(bytes / 1024)} KB · same output as at ${m[2]}, shown then · full log: ${m[3]} · its digest again: offload summarize ${shquote(m[3])}`;
      appendStats2({ kind: "digest", source: "repeat", label, log: m[3], model: "", bytes_in: bytes, bytes_out: Buffer.byteLength(note), saved_tokens: Math.max(0, Math.floor((bytes - Buffer.byteLength(note)) / 4)), seconds: 0, model_ok: false, model_tried: false, worker_tokens_in: 0, worker_tokens_out: 0 });
      return note;
    }
  }
  const cmdSeen = opts.session ? seenCmdFile2(opts.session, cmd) : "";
  let prev;
  if (cmdSeen && existsSync(cmdSeen)) {
    const c = /^(\d+) (\S+) (.*)$/.exec(readFileSync(cmdSeen, "utf8").replace(/\n$/, ""));
    if (c && Math.floor(Date.now() / 1000) - Number(c[1]) <= 3600 && existsSync(c[3]))
      prev = { log: c[3], at: c[2] };
  }
  const markSeen = (log) => {
    if (!seen)
      return;
    try {
      mkdirSync(dirname(seen), { recursive: true });
      const d = new Date;
      const p = (n) => String(n).padStart(2, "0");
      const line = `${Math.floor(d.getTime() / 1000)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${log}
`;
      writeFileSync(seen, line);
      if (cmdSeen)
        writeFileSync(cmdSeen, line);
    } catch {}
  };
  if (search || diffv) {
    const log = newLogPath2(cmd);
    if (raw)
      writeFileSync(log, raw);
    else
      copyFileSync(bigFile, log);
    raw = bytesBuf = undefined;
    const v = (diffv ? diffView(log, cmd, text) : searchView(log, cmd, text)).replace(/\n$/, "");
    markSeen(log);
    return v;
  }
  let log;
  if (jsonv) {
    log = newLogPath2(cmd);
    if (raw)
      writeFileSync(log, raw);
    else
      copyFileSync(bigFile, log);
    const v = jsonView(log, cmd, lines, src.bytes);
    if (v) {
      markSeen(log);
      return v;
    }
  }
  const budgetSec = cfgInt2("hooks.digest_timeout_seconds", 20);
  const noModel = budgetSec === 0 || !await available2();
  if (!log) {
    log = newLogPath2(cmd);
    if (raw)
      writeFileSync(log, raw);
    else
      copyFileSync(bigFile, log);
  }
  raw = bytesBuf = undefined;
  const d = (await digest(log, cmd, "0", opts.description ?? "", "hook", undefined, { noModel, compact, budgetSec, prev, text })).replace(/\n$/, "");
  if (d)
    markSeen(log);
  return d;
}
function sessionGuide2(host, cliPath = cliCommand()) {
  const lines = cfgStr2("hooks.read_threshold_lines", "600");
  const tasks = taskSummary();
  if (callStyle(host) === "mcp") {
    return `offload is installed: cheap worker models do bulk reading/digesting so it stays out of your context. Use its tools:
- offload_read(question, paths[]) — questions about big files or dirs (paths may be file:START-END). Answers cite path:Lx-Ly with machine-checked quotes; read just those lines before editing.
- offload_explore(question) — read-only cheap agent searches the repo itself ("where/how is X done?" across many files).
- offload_run(command, focus?) — run noisy commands (tests, builds, installs, linters): digest + verbatim error lines + full-log path.
- offload_write(spec, reference, out) — boilerplate that follows an existing file's patterns; review the result.
${tasks ? `- offload_task(name, paths?, question?) — the user's own tasks: ${tasks}.
` : ""}Keep for yourself: debugging reasoning, design decisions, edits (read slices for exact text), small files. Full reads of files over ~${lines} lines may be blocked with an outline and these options.`;
  }
  return `offload is installed: cheap worker models do bulk reading/digesting so it stays out of your context. Use these shell commands:
- ${cliPath} read -q "QUESTION" PATH... — questions about big files or dirs (PATH may be file:START-END). Answers cite path:Lx-Ly with machine-checked quotes; read just those lines before editing.
- ${cliPath} explore "QUESTION" — read-only cheap agent searches the repo itself ("where/how is X done?" across many files).
- ${cliPath} run -- CMD... — for noisy commands (tests, builds, installs, linters, long logs): prints a digest + verbatim error lines + full-log path, keeps the exit code.
- ${cliPath} write --spec "..." --ref EXAMPLE_FILE --out NEW_FILE — boilerplate that follows an existing file's patterns (tests, configs, stubs); review the result.
${tasks ? `- ${cliPath} task NAME [PATH...] — the user's own tasks: ${tasks}.
` : ""}Keep for yourself: debugging reasoning, design decisions, edits (read slices for exact text), small files. Full reads of files over ~${lines} lines may be blocked with an outline and these options; large successful command output may come back as a digest with a log path.`;
}

export { workerWords2, PAUSED_MESSAGE2, welcomeMessage2, firstSession2, available2, bigFileMessage2, readGuard2, autowrap2, bashGuard2, postBash2, sessionGuide2 };
