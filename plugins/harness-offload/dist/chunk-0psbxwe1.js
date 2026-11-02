import {
  digest
} from "./chunk-rj54vw4r.js";
import {
  taskSummary
} from "./chunk-xjqtr3z1.js";
import {
  outline
} from "./chunk-gh6yet37.js";
import {
  modelChain
} from "./chunk-jmghvs0p.js";
import {
  CLI_AGENTS,
  backendFor,
  parseRef
} from "./chunk-8p0ks1cq.js";
import {
  estTokens,
  fileBytes,
  fileLines,
  fmtInt,
  isText,
  shquote
} from "./chunk-gw3gb7a8.js";
import {
  appendStats,
  cooling,
  newLogPath,
  stateDir
} from "./chunk-xrb8jsn8.js";
import {
  cfgBool,
  cfgInt,
  cfgList,
  cfgStr,
  isSecretTarget,
  loadConfig,
  matchesAny
} from "./chunk-z20wwhvz.js";
import {
  CONNECTORS
} from "./chunk-gaybtz2x.js";
import {
  __require
} from "./chunk-d1gt213s.js";

// src/hooks/logic.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
function workerWords() {
  let p;
  try {
    p = parseRef(modelChain("read")[0] ?? "@default");
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
var PAUSED_MESSAGE = "Harness Offload is paused: it found no model to hand work to, so your tools work as usual. /harness-offload:setup sets one up (or run: offload doctor).";
var welcomeMessage = () => `Harness Offload is on: huge file reads and long command output now go to ${workerWords()} instead of filling this session. Nothing to set up — /harness-offload:setup changes who does the work.`;
function firstSession() {
  const mark = join(stateDir(), "welcome-shown");
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
    return cfgStr(`hosts.${host}.call`, "mcp") === "shell" ? "shell" : "mcp";
  return "shell";
}
function enabled() {
  loadConfig();
  return cfgBool("enabled", true);
}
async function available() {
  if (!enabled())
    return false;
  for (const task of ["read", "summarize"]) {
    for (const raw of modelChain(task)) {
      let parsed;
      try {
        parsed = parseRef(raw);
      } catch {
        continue;
      }
      if (cooling(parsed.ref))
        continue;
      const b = backendFor(parsed.backend);
      if (b && (await b.available()).ok)
        return true;
    }
  }
  return false;
}
function ignored(p) {
  const globs = cfgList("hooks.ignore_globs");
  return matchesAny(p, globs) || matchesAny(basename(p), globs);
}
var BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|ipynb|zip|gz|tgz|tar|jar|wasm|so|dylib|dll|exe|bin|pyc|class|o|a|mp3|mp4|mov|woff2?|ttf|otf)$/i;
function notForOffload(p) {
  return BINARY.test(p) || !isText(p) || isSecretTarget(p);
}
function guard(message) {
  switch (cfgStr("hooks.read_guard", "block")) {
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
function bigFileMessage(host, file, lines, tokens, how) {
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  const out = outline(file, 40);
  let m = `offload: ${how} would put all of ${file} into your context (${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens; limit ${cfgStr("hooks.read_threshold_lines")} lines / ${fmtInt(cfgInt("hooks.read_threshold_tokens", 6000))} tokens).
Pick the cheapest option:
- Need exact text (to edit/quote)? Read a slice (max ${chunk} lines per call) — outline below; \`grep -n PATTERN ${shquote(file)}\` finds more.
- Need understanding/facts? Use ${readCmd(host, file)}
  A cheap model answers with ${file}:Lx-Ly citations whose quotes are checked; then read only those lines if you must edit.
- Question spans many files? Use ${exploreCmd(host)}
`;
  if (out)
    m += `Outline of ${file}:
${out}`;
  return m;
}
function readGuard(host, cwd, file, offset, limit) {
  if (!enabled() || cfgStr("hooks.read_guard", "block") === "off" || !file)
    return;
  const p = isAbsolute(file) ? file : resolve(cwd, file);
  if (!existsSync(p) || !statSync(p).isFile())
    return;
  if (ignored(file) || notForOffload(p))
    return;
  const lines = fileLines(p);
  const tokens = estTokens(fileBytes(p));
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  if (offset !== undefined || limit !== undefined) {
    const start = Math.max(1, offset ?? 1);
    const remaining = lines - start + 1;
    let span = limit !== undefined ? limit : remaining;
    if (span > remaining)
      span = remaining;
    if (span <= chunk)
      return;
    appendStats({ kind: "hook", event: "read_slice_blocked", host, lines: span });
    return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}; keep slices to at most ${chunk} lines, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}:${start}-${start + span - 1}`);
  }
  if (lines <= cfgInt("hooks.read_threshold_lines", 600) && tokens <= cfgInt("hooks.read_threshold_tokens", 6000))
    return;
  appendStats({ kind: "hook", event: "read_blocked", host, lines, tokens });
  return guard(bigFileMessage(host, file, lines, tokens, "A full read"));
}
function bashGuard(host, cwd, command) {
  if (!enabled() || !command || !cfgBool("hooks.bash_read_guard", true) || cfgStr("hooks.read_guard", "block") === "off")
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
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  const maxLines = cfgInt("hooks.read_threshold_lines", 600);
  const maxTokens = cfgInt("hooks.read_threshold_tokens", 6000);
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
    appendStats({ kind: "hook", event: "bash_read_blocked", host, lines, tokens, prog });
    return guard(bigFileMessage(host, f, lines, tokens, `\`${prog}\``));
  }
  return;
}
async function postBash(opts) {
  if (!enabled() || !cfgBool("hooks.summarize_bash_output", true))
    return;
  const cmd = opts.command ?? "";
  if (!cmd || /^OFFLOAD_RAW=1/.test(cmd) || opts.background || opts.interrupted)
    return;
  const lastLine = cmd.trim().split(`
`).pop() ?? "";
  const last = lastLine.split(/\|\||&&|;|\|/).pop() ?? "";
  const never = cfgStr("hooks.bash_never_summarize");
  if (never) {
    try {
      const { posixToJs } = await import("./chunk-fjfzrncd.js");
      if (new RegExp(posixToJs(never)).test(last))
        return;
    } catch {
      return;
    }
  }
  let text = opts.output;
  let compact = false;
  if (opts.persistedPath && existsSync(opts.persistedPath)) {
    text = readFileSync(opts.persistedPath, "utf8");
    compact = true;
  }
  const lines = text.split(`
`).length - (text.endsWith(`
`) ? 1 : 0);
  if (lines <= cfgInt("hooks.bash_output_threshold_lines", 250) && Buffer.byteLength(text) <= cfgInt("hooks.bash_output_threshold_bytes", 20000))
    return;
  const budgetSec = cfgInt("hooks.digest_timeout_seconds", 20);
  const noModel = budgetSec === 0 || !await available();
  const log = newLogPath(cmd);
  writeFileSync(log, text);
  return digest(log, cmd, "0", opts.description ?? "", "hook", undefined, { noModel, compact, budgetSec });
}
function sessionGuide(host, cliPath = cliCommand()) {
  const lines = cfgStr("hooks.read_threshold_lines", "600");
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

export { workerWords, PAUSED_MESSAGE, welcomeMessage, firstSession, callStyle, enabled, available, cliCommand, bigFileMessage, readGuard, bashGuard, postBash, sessionGuide };
