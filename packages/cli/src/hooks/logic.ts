// Host-neutral hook decisions — the TypeScript twin of the bash hooks in the
// Claude Code plugin. Host adapters translate their JSON in and out.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfgBool, cfgInt, cfgList, cfgStr, loadConfig } from "../config.ts";
import { digest, searchView } from "../digest.ts";
import { parseRef, backendFor } from "../backends/registry.ts";
import { modelChain } from "../engine.ts";
import { isSecretTarget, matchesAny, redact } from "../secrets.ts";
import { appendStats, cooling, newLogPath, seenFile } from "../state.ts";
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

/** Fail-open check: is there a backend that could run a delegation? */
export async function available(): Promise<boolean> {
  if (!enabled()) return false;
  for (const task of ["read", "summarize"] as const) {
    for (const raw of modelChain(task)) {
      let parsed;
      try {
        parsed = parseRef(raw); // @host outside a known harness throws: skip it
      } catch {
        continue;
      }
      if (cooling(parsed.ref)) continue;
      const b = backendFor(parsed.backend);
      if (b && (await b.available()).ok) return true;
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

export function bigFileMessage(host: Host, file: string, lines: number, tokens: number, how: string): string {
  const chunk = cfgInt("hooks.read_max_chunk_lines", 600);
  const out = outline(file, 40);
  let m = `offload: ${how} would put all of ${file} into your context (${fmtInt(lines)} lines, ~${fmtInt(tokens)} tokens; limit ${cfgStr("hooks.read_threshold_lines")} lines / ${fmtInt(cfgInt("hooks.read_threshold_tokens", 6000))} tokens).
Pick the cheapest option:
- Need exact text (to edit/quote)? Read a slice (max ${chunk} lines per call) — outline below; \`grep -n PATTERN ${shquote(file)}\` finds more.
- Need understanding/facts? Use ${readCmd(host, file)}
  A cheap model answers with ${file}:Lx-Ly citations whose quotes are checked; then read only those lines if you must edit.
- Question spans many files? Use ${exploreCmd(host)}
`;
  if (out) m += `Outline of ${file}:\n${out}`;
  return m;
}

/** Full-file read guard. offset/limit are 1-based lines; undefined = not given. */
export function readGuard(host: Host, cwd: string, file: string | undefined, offset?: number, limit?: number): Verdict | undefined {
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
    if (span <= chunk) return undefined;
    appendStats({ kind: "hook", event: "read_slice_blocked", host, lines: span, file });
    return guard(`offload: that read slice is ${fmtInt(span)} lines of ${file}; keep slices to at most ${chunk} lines, or ask: ${callStyle(host) === "mcp" ? "offload_read" : `${cliCommand()} read`} -q "<question>" ${shquote(file)}:${start}-${start + span - 1}`);
  }
  if (lines <= cfgInt("hooks.read_threshold_lines", 600) && tokens <= cfgInt("hooks.read_threshold_tokens", 6000)) return undefined;
  appendStats({ kind: "hook", event: "read_blocked", host, lines, tokens, file });
  return guard(bigFileMessage(host, file, lines, tokens, "A full read"));
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
  const never = cfgStr("hooks.bash_never_summarize");
  if (never && !search) {
    try {
      const { posixToJs } = await import("../outline.ts");
      if (new RegExp(posixToJs(never)).test(last)) return undefined;
    } catch {
      /* bad regex: be safe and leave output alone */
      return undefined;
    }
  }
  let text = opts.output;
  let compact = false;
  if (opts.persistedPath && existsSync(opts.persistedPath)) {
    text = readFileSync(opts.persistedPath, "utf8");
    compact = true;
  }
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lines <= cfgInt("hooks.bash_output_threshold_lines", 250) && Buffer.byteLength(text) <= cfgInt("hooks.bash_output_threshold_bytes", 20000)) return undefined;
  // options, not process.env: in-process hosts (OpenCode, Pi) live on.
  // The agent waits for this hook: the model gets hooks.digest_timeout_seconds
  // in all; 0 = no model in hooks (the digest is then instant).
  // the same output again in this session (a re-run with nothing changed): one line
  // instead of a second digest and worker call. Twin: post-bash.
  const seen = opts.session ? seenFile(opts.session, text) : "";
  if (seen && existsSync(seen)) {
    const m = /^(\d+) (\S+) (.*)$/.exec(readFileSync(seen, "utf8").replace(/\n$/, ""));
    // byte for byte against the earlier run's log, so a checksum clash can't mislead
    if (m && Math.floor(Date.now() / 1000) - Number(m[1]) <= 3600 && existsSync(m[3]) && readFileSync(m[3]).equals(Buffer.from(text))) {
      const label = redact(cmd);
      const bytes = Buffer.byteLength(text);
      const note = `[offload] \`${label.slice(0, 120)}\` · ${fmtInt(lines)} lines / ${Math.ceil(bytes / 1024)} KB · same output as at ${m[2]}, shown then · full log: ${m[3]} · its digest again: offload summarize ${shquote(m[3])}`;
      appendStats({ kind: "digest", source: "repeat", label, log: m[3], model: "", bytes_in: bytes, bytes_out: Buffer.byteLength(note), saved_tokens: Math.max(0, Math.floor((bytes - Buffer.byteLength(note)) / 4)), seconds: 0, model_ok: false, model_tried: false, worker_tokens_in: 0, worker_tokens_out: 0 });
      return note;
    }
  }
  const markSeen = (log: string) => {
    if (!seen) return;
    try {
      mkdirSync(dirname(seen), { recursive: true });
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      writeFileSync(seen, `${Math.floor(d.getTime() / 1000)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${log}\n`);
    } catch {
      /* best-effort */
    }
  };
  if (search) {
    const log = newLogPath(cmd);
    writeFileSync(log, text);
    const v = searchView(log, cmd).replace(/\n$/, "");
    markSeen(log);
    return v;
  }
  const budgetSec = cfgInt("hooks.digest_timeout_seconds", 20);
  const noModel = budgetSec === 0 || !(await available());
  const log = newLogPath(cmd);
  writeFileSync(log, text);
  // no final newline, as the bash hook returns it
  const d = (await digest(log, cmd, "0", opts.description ?? "", "hook", undefined, { noModel, compact, budgetSec })).replace(/\n$/, "");
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
