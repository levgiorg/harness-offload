// Host-neutral hook decisions — the TypeScript twin of the bash hooks in the
// Claude Code plugin. Host adapters translate their JSON in and out.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfgBool, cfgInt, cfgList, cfgStr, loadConfig } from "../config.ts";
import { BIG, diffView, digest, logSrc, searchView, textSrc } from "../digest.ts";
import { parseRef, backendFor } from "../backends/registry.ts";
import { modelChain } from "../engine.ts";
import { isSecretTarget, matchesAny, redact } from "../secrets.ts";
import { appendStats, cooling, newLogPath, sameFile, seenCmdFile, seenFile } from "../state.ts";
import { outline, posixToJs } from "../outline.ts";
import { taskSummary } from "../tasks.ts";
import { estTokens, fileBytes, fileLines, fmtInt, isText, shquote } from "../text.ts";
import { writeFileSync } from "node:fs";
import { CONNECTORS } from "../assets.ts";
import { CLI_AGENTS } from "../backends/agents.ts";
import { stateDir } from "../state.ts";

/** Who does the cheap work, in the user's words: "Haiku on your Claude plan".
 * Twin: co_worker_words in lib/agents.sh. */
export function workerWords(): string {
  let p;
  try {
    p = parseRef(modelChain("read")[0] ?? "@default");
  } catch {
    return "a cheap model";
  }
  const names = CONNECTORS.worker_names ?? {};
  const label = names.models?.[p.model] ?? p.model;
  if (p.backend === "opencode") return p.model ? `${p.model} via OpenCode` : "OpenCode's default model";
  if (p.backend in CLI_AGENTS) return `${label || "the default model"} on ${names.plans?.[p.backend] ?? p.backend}`;
  return `${label || "its default model"} via the ${p.backend} API`;
}

/** The one-line messages a Claude Code user sees (twins in hooks/session-start). */
export const PAUSED_MESSAGE = "Harness Offload is paused: it found no model to hand work to, so your tools work as usual. /harness-offload:setup sets one up (or run: offload doctor).";
export const welcomeMessage = () =>
  `Harness Offload is on: huge file reads and long command output now go to ${workerWords()} instead of filling this session. Nothing to set up — /harness-offload:setup changes who does the work.`;

/** True once per machine (state dir): the first session after installing. */
export function firstSession(): boolean {
  const mark = join(stateDir(), "welcome-shown");
  if (existsSync(mark)) return false;
  try {
    writeFileSync(mark, "");
  } catch {
    return false;
  }
  return true;
}

export type Host = "claude" | "codex" | "cursor" | "gemini" | "pi" | "opencode" | "kilo" | "devin" | "copilot" | "qwen" | "crush" | "amp";

export interface Verdict {
  action: "deny" | "ask" | "note";
  message: string;
}

/** How the agent on this host should call offload (shell vs MCP tools). */
export function callStyle(host: Host): "shell" | "mcp" {
  if (host === "pi") return "mcp"; // pi gets native offload_* tools
  // Codex and Cursor sandbox agent shell commands without network access.
  if (host === "codex" || host === "cursor") return cfgStr(`hosts.${host}.call`, "mcp") === "shell" ? "shell" : "mcp";
  return "shell";
}

export function enabled(): boolean {
  loadConfig();
  return cfgBool("enabled", true);
}

/** Fail-open check: could a delegation run? The backend of the first read or summarize
 *  model must be present (a missing primary means offload is not set up here, so hooks
 *  step aside), and some model of those chains must not be cooling down. Twin: co_available. */
export async function available(): Promise<boolean> {
  if (!enabled()) return false;
  const parse = (raw: string) => {
    try {
      return parseRef(raw); // @host outside a known harness throws: skip it
    } catch {
      return undefined;
    }
  };
  let present = false;
  for (const task of ["read", "summarize"] as const) {
    const first = modelChain(task)[0];
    const parsed = first ? parse(first) : undefined;
    const b = parsed && backendFor(parsed.backend);
    if (b && (await b.available()).ok) {
      present = true;
      break;
    }
  }
  if (!present) return false;
  for (const task of ["read", "summarize"] as const) {
    for (const raw of modelChain(task)) {
      const parsed = parse(raw);
      if (parsed && backendFor(parsed.backend) && !cooling(parsed.ref)) return true;
    }
  }
  return false;
}

function ignored(p: string): boolean {
  const globs = cfgList("hooks.ignore_globs");
  return matchesAny(p, globs) || matchesAny(basename(p), globs);
}

const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|ipynb|zip|gz|tgz|tar|jar|wasm|so|dylib|dll|exe|bin|pyc|class|o|a|mp3|mp4|mov|woff2?|ttf|otf)$/i;
function notForOffload(p: string): boolean {
  return BINARY.test(p) || !isText(p) || isSecretTarget(p);
}

function guard(message: string): Verdict | undefined {
  switch (cfgStr("hooks.read_guard", "block")) {
    case "off":
      return undefined;
    case "ask":
      return { action: "ask", message };
    case "suggest":
      return { action: "note", message: `offload (advice, not enforced): ${message}` };
    default:
      return { action: "deny", message };
  }
}

let cliCache: string | undefined;
/** How an agent should call the CLI from its shell: `offload` when it is on
 * PATH, else node + the bundled CLI next to this module. */
export function cliCommand(): string {
  if (cliCache) return cliCache;
  if (process.env.OFFLOAD_CLI_COMMAND) return (cliCache = process.env.OFFLOAD_CLI_COMMAND);
  const onPath = (process.env.PATH ?? "").split(delimiter).some((d) => d && (existsSync(join(d, "offload")) || existsSync(join(d, "offload.cmd"))));
  if (onPath) return (cliCache = "offload");
  try {
    const js = fileURLToPath(new URL("./cli.js", import.meta.url));
    if (existsSync(js)) return (cliCache = `node ${shquote(js)}`);
  } catch {
    /* not bundled */
  }
  return (cliCache = "offload");
}

function readCmd(host: Host, file: string): string {
  return callStyle(host) === "mcp" ? `the offload_read tool (question + paths: ["${file}"])` : `Bash: ${cliCommand()} read -q "<specific question>" ${shquote(file)}`;
}
function exploreCmd(host: Host): string {
  return callStyle(host) === "mcp" ? "the offload_explore tool" : `Bash: ${cliCommand()} explore "<question>"`;
}

const LOCK_TOOLS: Record<string, string> = {
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
  "go.sum": "go mod why -m NAME",
};
/** The package manager that answers questions about a lockfile. Twin: hk_lock_tool. */
export function lockTool(file: string): string | undefined {
  const b = file.slice(file.lastIndexOf("/") + 1);
  return Object.hasOwn(LOCK_TOOLS, b) ? LOCK_TOOLS[b] : undefined;
}

const jsonType = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
function jsonDesc(v: unknown): { text: string; kind: string; n: number } {
  const t = jsonType(v);
  if (t === "object") {
    const n = Object.keys(v as object).length;
    return { text: `object, ${fmtInt(n)} ${n === 1 ? "key" : "keys"}`, kind: "o", n };
  }
  if (t === "array") {
    const a = v as unknown[];
    const n = a.length;
    if (n === 0) return { text: "array, empty", kind: "a", n };
    const types = new Set(a.map(jsonType));
    const one = types.size === 1 ? [...types][0] : "mixed";
    const text = one === "mixed" ? `array, ${fmtInt(n)} ${n === 1 ? "item" : "items"} (mixed)` : `array, ${fmtInt(n)} ${one}${n === 1 ? "" : "s"}`;
    return { text, kind: "a", n };
  }
  return { text: t, kind: t, n: 0 };
}

/** Top-level structure of a JSON file of at most 16 MB and jq commands for its biggest
 *  member; undefined when it is not one JSON value. Twin: hk_json_structure. */
export function jsonStructure(file: string, bytes: number, shown = file): { lines: string[]; hint?: string } | undefined {
  if (bytes > 16777216) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  const q = shquote(shown);
  const top = jsonDesc(v);
  const lines = [`  ${top.text}`];
  if (top.kind === "a") return { lines, hint: `jq 'length' ${q} · jq '.[0]' ${q}` };
  if (top.kind !== "o") return { lines };
  const entries = Object.entries(v as Record<string, unknown>);
  let key = "", kt = "", best = 0, first = "";
  for (const [k, val] of entries.slice(0, 30)) {
    const kj = JSON.stringify(k);
    const d = jsonDesc(val);
    lines.push(`  ${kj}: ${d.text}`);
    if ((d.kind === "a" || d.kind === "o") && (key === "" || d.n > best)) [key, kt, best] = [kj, d.kind, d.n];
    if (first === "") first = kj;
  }
  if (entries.length > 30) lines.push(`  … ${fmtInt(entries.length - 30)} more keys`);
  let h = `jq 'keys' ${q}`;
  const k = key || first;
  let p = "";
  if (/^"[A-Za-z_][A-Za-z0-9_]*"$/.test(k)) p = "." + k.slice(1, -1);
  else if (k && !k.includes("'") && !k.includes("\\")) p = `.[${k}]`;
  if (p && kt === "a") h += ` · jq '${p} | length' ${q} · jq '${p}[0]' ${q}`;
  else if (p && kt === "o") h += ` · jq '${p} | keys[0:20]' ${q}`;
  else if (p) h += ` · jq '${p}' ${q}`;
  return { lines, hint: h };
}

/** A huge JSON output: its structure and jq commands on the log; undefined when the log is
 *  not one JSON object or array (the usual digest then runs). Twin: hk_json_view. */
export function jsonView(log: string, cmd: string, lines: number, bytes: number): string | undefined {
  const t0 = Date.now();
  const js = jsonStructure(log, bytes);
  if (!js?.hint) return undefined;
  const label = redact(cmd);
  const out = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(lines)} lines / ${Math.ceil(bytes / 1024)} KB of JSON · full log: ${log}
── structure ──
${js.lines.join("\n")}
── query it instead of reading it ──
${js.hint}`;
  const bout = Buffer.byteLength(out);
  appendStats({
    kind: "digest", source: "json", label, log, model: "", bytes_in: bytes, bytes_out: bout,
    saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: Math.round((Date.now() - t0) / 1000),
    model_ok: false, model_tried: false, worker_tokens_in: 0, worker_tokens_out: 0,
  });
  return out;
}

/** Lockfiles, long-line (minified/generated) files and JSON get advice that fits them. Twin: hk_big_file_message. */
export function bigFileMessage(host: Host, file: string, lines: number, tokens: number, how: string): string {
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  const bytes = fileBytes(file);
  const avg = Math.floor(bytes / (lines > 0 ? lines : 1));
  const long = avg > 4000;
  const lock = lockTool(file);
  const js = /\.json$/i.test(file) ? jsonStructure(file, bytes) : undefined;
  let m = `offload: ${how} would put all of ${file} into your context (${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens; limit ${cfgStr("hooks.read_threshold_lines")} lines / ${fmtInt(cfgInt("hooks.read_threshold_tokens", 6000))} tokens).\n`;
  if (lock) m += `It is a lockfile, written by the package manager: \`${lock}\` answers "which version, who needs it" without reading it.\n`;
  if (long) m += `Its lines average ${fmtInt(avg)} characters (minified or generated), so line slices do not help.\n`;
  m += "Pick the cheapest option:\n";
  m += long
    ? `- Need exact text? Bash: grep -noE '.{0,80}PATTERN.{0,80}' ${shquote(file)} shows each match with 80 characters around it.\n`
    : `- Need exact text (to edit/quote)? Read a slice (max ${chunk} lines per call) — outline below; \`grep -n PATTERN ${shquote(file)}\` finds more.\n`;
  if (js?.hint) m += `- Need values? Bash: ${js.hint}\n`;
  m += `- Need understanding/facts? Use ${readCmd(host, file)}
  A cheap model answers with ${file}:Lx-Ly citations whose quotes are checked; then read only those lines if you must edit.
- Question spans many files? Use ${exploreCmd(host)}
`;
  if (js) m += `Structure of ${file}:\n${js.lines.join("\n")}\n`;
  if (!long) {
    const out = outline(file, 40);
    if (out) m += `Outline of ${file}:\n${out}`;
  }
  return m.replace(/\n+$/, "");
}

/** Full-file read guard. offset/limit are 1-based lines; undefined = not given. */
/** Tokens in the agent's context at its last turn, from the usage Claude Code records in the
 *  transcript (input + cache creation + cache read); undefined when it can't tell. Twin: hk_context_used. */
export function contextUsed(transcript: string | undefined): number | undefined {
  if (!transcript || !existsSync(transcript)) return undefined;
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
    const line = buf.toString("utf8").split("\n").filter((l) => l.includes('"usage"')).pop();
    if (!line) return undefined;
    const j = JSON.parse(line);
    const u = j.message?.usage ?? j.usage;
    if (!u) return undefined;
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  } catch {
    return undefined;
  }
}

export function readGuard(host: Host, cwd: string, file: string | undefined, offset?: number, limit?: number, transcript?: string): Verdict | undefined {
  if (!enabled() || cfgStr("hooks.read_guard", "block") === "off" || !file) return undefined;
  const p = isAbsolute(file) ? file : resolve(cwd, file);
  if (!existsSync(p) || !statSync(p).isFile()) return undefined;
  if (ignored(file) || notForOffload(p)) return undefined;
  const lines = fileLines(p);
  const tokens = estTokens(fileBytes(p));
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  if (offset !== undefined || limit !== undefined) {
    const start = Math.max(1, offset ?? 1);
    const remaining = lines - start + 1;
    let span = limit !== undefined ? limit : remaining;
    if (span > remaining) span = remaining;
    // lines averaging over 4,000 characters (minified/generated): count the slice's size too
    const avg = Math.floor(fileBytes(p) / (lines > 0 ? lines : 1));
    const sliceTokens = Math.floor((span * avg + 3) / 4);
    if (avg > 4000 && sliceTokens > cfgInt("hooks.read_threshold_tokens", 6000)) {
      appendStats({ kind: "hook", event: "read_slice_blocked", host, lines: span, file });
      return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}, but its lines average ${fmtInt(avg)} characters (minified or generated): ~${fmtInt(sliceTokens)} tokens. Bash: grep -noE '.{0,80}PATTERN.{0,80}' ${shquote(file)} shows each match with 80 characters around it, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}`);
    }
    if (span <= chunk) return undefined;
    appendStats({ kind: "hook", event: "read_slice_blocked", host, lines: span, file });
    return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}; keep slices to at most ${chunk} lines, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}:${start}-${start + span - 1}`);
  }
  let maxLines = cfgInt("hooks.read_threshold_lines", 600);
  let maxTokens = cfgInt("hooks.read_threshold_tokens", 6000);
  let note = "";
  let used: number | undefined;
  if (lines <= maxLines && tokens <= maxTokens) {
    // opt-in (hooks.context_tight_tokens): when the agent's context is nearly full, a read over
    // half the limit could force a compaction, so the limit is halved. Twin: hooks/pre-read.
    const tight = cfgInt("hooks.context_tight_tokens", 0);
    if (!(tight > 0 && (lines > maxLines / 2 || tokens > maxTokens / 2))) return undefined;
    used = contextUsed(transcript);
    if (used === undefined || used < tight) return undefined;
    maxLines = Math.floor(maxLines / 2);
    maxTokens = Math.floor(maxTokens / 2);
    if (lines <= maxLines && tokens <= maxTokens) return undefined;
    note = `\n(Your context is nearly full: ~${fmtInt(used)} tokens in use, at or above hooks.context_tight_tokens, so the limit is halved.)`;
  }
  appendStats({ kind: "hook", event: "read_blocked", host, lines, tokens, file, ...(used !== undefined ? { context: used } : {}) });
  return guard(bigFileMessage(host, file, lines, tokens, "A full read") + note);
}

/** cat/nl/bat/less/more/head/tail/sed -n dumps of big files. */
/** hooks.autowrap (opt-in): a noisy command matching hooks.autowrap_pattern runs through
 *  `offload run`. Returns the wrapped command. Twin: section 2 of hooks/pre-bash. */
export function autowrap(command: string | undefined, background: boolean): string | undefined {
  if (!enabled() || !command || background || !cfgBool("hooks.autowrap", false)) return undefined;
  const pat = cfgStr("hooks.autowrap_pattern");
  if (!pat) return undefined;
  try {
    const re = new RegExp(posixToJs(pat));
    if (!command.split("\n").some((l) => re.test(l))) return undefined;
  } catch {
    return undefined;
  }
  appendStats({ kind: "hook", event: "autowrap", command: redact(command) });
  return `${cliCommand()} run -c ${shquote(command)}`;
}

export function bashGuard(host: Host, cwd: string, command: string | undefined): Verdict | undefined {
  if (!enabled() || !command || !cfgBool("hooks.bash_read_guard", true) || cfgStr("hooks.read_guard", "block") === "off") return undefined;
  if (/^OFFLOAD_RAW=1/.test(command) || /offload /.test(command)) return undefined;
  if (/[|><;`]|&&|\|\||\$\(/.test(command)) return undefined;
  const words = command.trim().split(/\s+/);
  const prog = words.shift() ?? "";
  if (!["cat", "nl", "bat", "batcat", "less", "more", "head", "tail", "sed"].includes(prog)) return undefined;
  let n = "";
  let range = "";
  const files: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (prog === "head" || prog === "tail") {
      if (a === "-n" || a === "--lines") {
        if (i + 1 >= words.length) return undefined;
        n = words[++i];
        continue;
      }
      if (/^-n\+?\d/.test(a)) n = a.slice(2);
      else if (a.startsWith("--lines=")) n = a.slice(8);
      else if (/^-\d/.test(a)) n = a.slice(1);
      else if (["-f", "-F"].includes(a) || a.startsWith("--follow") || a.startsWith("-c") || a.startsWith("--bytes")) return undefined;
    }
    if (a.startsWith("-")) continue;
    const clean = a.replace(/["']/g, "");
    const abs = isAbsolute(clean) ? clean : resolve(cwd, clean);
    if (prog === "sed" && !range && !existsSync(abs)) range = clean;
    else files.push(clean);
  }
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  const maxLines = cfgInt("hooks.read_threshold_lines", 600);
  const maxTokens = cfgInt("hooks.read_threshold_tokens", 6000);
  for (const f of files) {
    const p = isAbsolute(f) ? f : resolve(cwd, f);
    if (!existsSync(p) || !statSync(p).isFile() || ignored(f) || notForOffload(p)) continue;
    const lines = fileLines(p);
    const tokens = estTokens(fileBytes(p));
    let span = lines;
    if (prog === "head" || prog === "tail") {
      span = Math.min(Number(n.replace(/\D/g, "")) || 10, lines);
      if (span <= chunk) continue;
    } else if (prog === "sed") {
      const m = range.match(/^(\d+),(\d+|\$)p$/);
      if (!m) continue;
      const b = m[2] === "$" ? lines : Number(m[2]);
      span = b - Number(m[1]) + 1;
      if (span <= chunk) continue;
    } else if (lines <= maxLines && tokens <= maxTokens) continue;
    if (span <= maxLines && lines <= maxLines && tokens <= maxTokens) continue;
    appendStats({ kind: "hook", event: "bash_read_blocked", host, lines, tokens, prog, file: f });
    return guard(bigFileMessage(host, f, lines, tokens, `\`${prog}\``));
  }
  return undefined;
}

/** Digest for a large successful command output; undefined = leave it alone. */
export async function postBash(opts: { command?: string; output: string; persistedPath?: string; description?: string; background?: boolean; interrupted?: boolean; session?: string }): Promise<string | undefined> {
  if (!enabled() || !cfgBool("hooks.summarize_bash_output", true)) return undefined;
  const cmd = opts.command ?? "";
  if (!cmd || /^OFFLOAD_RAW=1/.test(cmd) || opts.background || opts.interrupted) return undefined;
  const lastLine = cmd.trim().split("\n").pop() ?? "";
  const last = lastLine.split(/\|\||&&|;|\|/).pop() ?? "";
  // a huge search (grep/rg/find…) gets the search view instead of a summary that loses matches
  let search = false;
  const sre = cfgBool("hooks.search_view", true) ? cfgStr("hooks.search_commands") : "";
  if (sre) {
    try {
      const { posixToJs } = await import("../outline.ts");
      search = new RegExp(posixToJs(sre)).test(last);
    } catch {
      search = false;
    }
  }
  // a huge diff (git diff/show) gets the diff view: files with +/- and the first hunks
  const diffv = !search && cfgBool("hooks.diff_view", true) && /^\s*git\s+(diff|show)(\s|$)/.test(last);
  const never = cfgStr("hooks.bash_never_summarize");
  if (never && !search && !diffv) {
    try {
      const { posixToJs } = await import("../outline.ts");
      if (new RegExp(posixToJs(never)).test(last)) return undefined;
    } catch {
      /* bad regex: be safe and leave output alone */
      return undefined;
    }
  }
  // one copy of the output in memory (its bytes and its text) — or none: a persisted output over
  // BIG is counted, checksummed, compared and copied as a file, and digested from it in chunks
  let text: string | undefined = opts.output;
  let bytesBuf: Buffer | undefined;
  let compact = false;
  let bigFile: string | undefined;
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
  const src = bigFile ? logSrc(bigFile) : textSrc(text!);
  const lines = src.count();
  if (lines <= cfgInt("hooks.bash_output_threshold_lines", 250) && src.bytes <= cfgInt("hooks.bash_output_threshold_bytes", 20000)) return undefined;
  // a diff view needs a real diff: anything else from git diff/show passes through, as before
  if (diffv) {
    let isDiff = false;
    for (const l of src.lines()) if (l.startsWith("diff --git ")) {
      isDiff = true;
      break;
    }
    if (!isDiff) return undefined;
  }
  // a huge JSON output (curl, kubectl -o json…) gets its structure and jq commands
  let jsonv = false;
  if (!search && !diffv && src.bytes <= 16777216 && cfgBool("hooks.json_view", true)) {
    for (const l of src.lines()) {
      const t = l.replace(/^[ \t]+/, "");
      if (!t) continue;
      jsonv = t[0] === "{" || t[0] === "[";
      break;
    }
  }
  // options, not process.env: in-process hosts (OpenCode, Pi) live on.
  // The agent waits for this hook: the model gets hooks.digest_timeout_seconds
  // in all; 0 = no model in hooks (the digest is then instant).
  // the same output again in this session (a re-run with nothing changed): one line
  // instead of a second digest and worker call. Twin: post-bash.
  let raw: Buffer | undefined = bigFile ? undefined : (bytesBuf ??= Buffer.from(text!));
  const seen = opts.session ? seenFile(opts.session, raw ?? { file: bigFile! }) : "";
  if (seen && existsSync(seen)) {
    const m = /^(\d+) (\S+) (.*)$/.exec(readFileSync(seen, "utf8").replace(/\n$/, ""));
    // byte for byte against the earlier run's log, so a checksum clash can't mislead
    if (m && Math.floor(Date.now() / 1000) - Number(m[1]) <= 3600 && existsSync(m[3]) && (raw ? readFileSync(m[3]).equals(raw) : sameFile(m[3], bigFile!))) {
      const label = redact(cmd);
      const bytes = src.bytes;
      const note = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(lines)} lines / ${Math.ceil(bytes / 1024)} KB · same output as at ${m[2]}, shown then · full log: ${m[3]} · its digest again: offload summarize ${shquote(m[3])}`;
      appendStats({ kind: "digest", source: "repeat", label, log: m[3], model: "", bytes_in: bytes, bytes_out: Buffer.byteLength(note), saved_tokens: Math.max(0, Math.floor((bytes - Buffer.byteLength(note)) / 4)), seconds: 0, model_ok: false, model_tried: false, worker_tokens_in: 0, worker_tokens_out: 0 });
      return note;
    }
  }
  // the last run of this same command in the session: a re-run's digest shows what changed
  const cmdSeen = opts.session ? seenCmdFile(opts.session, cmd) : "";
  let prev: { log: string; at: string } | undefined;
  if (cmdSeen && existsSync(cmdSeen)) {
    const c = /^(\d+) (\S+) (.*)$/.exec(readFileSync(cmdSeen, "utf8").replace(/\n$/, ""));
    if (c && Math.floor(Date.now() / 1000) - Number(c[1]) <= 3600 && existsSync(c[3])) prev = { log: c[3], at: c[2] };
  }
  const markSeen = (log: string) => {
    if (!seen) return;
    try {
      mkdirSync(dirname(seen), { recursive: true });
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const line = `${Math.floor(d.getTime() / 1000)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${log}\n`;
      writeFileSync(seen, line);
      if (cmdSeen) writeFileSync(cmdSeen, line);
    } catch {
      /* best-effort */
    }
  };
  if (search || diffv) {
    const log = newLogPath(cmd);
    if (raw) writeFileSync(log, raw);
    else copyFileSync(bigFile!, log);
    raw = bytesBuf = undefined; // the bytes are on disk now; the text is all the view needs
    const v = (diffv ? diffView(log, cmd, text) : searchView(log, cmd, text)).replace(/\n$/, "");
    markSeen(log);
    return v;
  }
  let log: string | undefined;
  if (jsonv) {
    log = newLogPath(cmd);
    if (raw) writeFileSync(log, raw);
    else copyFileSync(bigFile!, log);
    const v = jsonView(log, cmd, lines, src.bytes);
    if (v) {
      markSeen(log);
      return v;
    }
  }
  const budgetSec = cfgInt("hooks.digest_timeout_seconds", 20);
  const noModel = budgetSec === 0 || !(await available());
  if (!log) {
    log = newLogPath(cmd);
    if (raw) writeFileSync(log, raw);
    else copyFileSync(bigFile!, log);
  }
  raw = bytesBuf = undefined; // the bytes are on disk now; the text is all the digest needs
  // no final newline, as the bash hook returns it
  const d = (await digest(log, cmd, "0", opts.description ?? "", "hook", undefined, { noModel, compact, budgetSec, prev, text })).replace(/\n$/, "");
  if (d) markSeen(log);
  return d;
}

/** Usage guidance injected at session start. */
export function sessionGuide(host: Host, cliPath = cliCommand()): string {
  const lines = cfgStr("hooks.read_threshold_lines", "600");
  const tasks = taskSummary();
  if (callStyle(host) === "mcp") {
    return `offload is installed: cheap worker models do bulk reading/digesting so it stays out of your context. Use its tools:
- offload_read(question, paths[]) — questions about big files or dirs (paths may be file:START-END). Answers cite path:Lx-Ly with machine-checked quotes; read just those lines before editing.
- offload_explore(question) — read-only cheap agent searches the repo itself ("where/how is X done?" across many files).
- offload_run(command, focus?) — run noisy commands (tests, builds, installs, linters): digest + verbatim error lines + full-log path.
- offload_write(spec, reference, out) — boilerplate that follows an existing file's patterns; review the result.
${tasks ? `- offload_task(name, paths?, question?) — the user's own tasks: ${tasks}.\n` : ""}Keep for yourself: debugging reasoning, design decisions, edits (read slices for exact text), small files. Full reads of files over ~${lines} lines may be blocked with an outline and these options.`;
  }
  return `offload is installed: cheap worker models do bulk reading/digesting so it stays out of your context. Use these shell commands:
- ${cliPath} read -q "QUESTION" PATH... — questions about big files or dirs (PATH may be file:START-END). Answers cite path:Lx-Ly with machine-checked quotes; read just those lines before editing.
- ${cliPath} explore "QUESTION" — read-only cheap agent searches the repo itself ("where/how is X done?" across many files).
- ${cliPath} run -- CMD... — for noisy commands (tests, builds, installs, linters, long logs): prints a digest + verbatim error lines + full-log path, keeps the exit code.
- ${cliPath} write --spec "..." --ref EXAMPLE_FILE --out NEW_FILE — boilerplate that follows an existing file's patterns (tests, configs, stubs); review the result.
${tasks ? `- ${cliPath} task NAME [PATH...] — the user's own tasks: ${tasks}.\n` : ""}Keep for yourself: debugging reasoning, design decisions, edits (read slices for exact text), small files. Full reads of files over ~${lines} lines may be blocked with an outline and these options; large successful command output may come back as a digest with a log path.`;
}
