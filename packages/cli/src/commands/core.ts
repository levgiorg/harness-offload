import { spawn } from "node:child_process";
import { spawnSafe } from "../proc.ts";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { list, parseFlags, str, UsageError } from "../args.ts";
import { cfgBool, cfgInt } from "../config.ts";
import { digest, isSmall } from "../digest.ts";
import { invoke, InvokeResult } from "../engine.ts";
import { E, WorkerError } from "../backends/types.ts";
import { outline } from "../outline.ts";
import { fence, isSecretPath, isSecretTarget, redact } from "../secrets.ts";
import { appendStats as appendStatsRow, cksum, newLogPath, stateDir, workDir } from "../state.ts";
import { setTaskContext, taskContext, taskDef, taskNames, taskSystem, TASK_NAME } from "../tasks.ts";
import { estTokens, fileLines, fmtInt, isText, numberLines, shquote, stripWrappingFence } from "../text.ts";
import { verifyCitations } from "../verify.ts";

export { ExitError } from "../errors.ts";
import { ExitError } from "../errors.ts";

const err = (m: string) => process.stderr.write(`offload: ${m}\n`);
const die = (m: string, code: number = E.USAGE): never => {
  err(m);
  throw new ExitError(code);
};
// the last worker call's fallback note ("fell back after A (quota)"), added to the footer
let lastFallback = "";
const footer = (s: string) => `\n[offload ${s}${lastFallback ? ` · ${lastFallback}` : ""}]\n`;
/** "read", "explore", "ask" — or "task NAME" while a custom task runs through that flow. */
const label = (kind: string) => {
  const t = taskContext();
  return t ? `task ${t.name}` : kind;
};
const appendStats = (row: Record<string, unknown>) => {
  const t = taskContext();
  const { kind, ...rest } = row;
  appendStatsRow(t ? { kind, task: t.name, ...rest } : row);
};
const secs = (t0: number) => Math.round((Date.now() - t0) / 1000);

function reportFailure(what: string, e: unknown): never {
  const w = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String(e));
  err(`${what} failed (exit ${w.code}): ${w.message}`);
  const hints: Record<number, string> = {
    [E.QUOTA]: "hint: quota/rate limit — add models.fallback in the config, or do this step yourself.",
    [E.AUTH]: "hint: log the backend in (its own CLI login, or `opencode auth login`) or set its API key with `offload setup`; `offload doctor` shows which.",
    [E.MODEL]: "hint: check the model id (`offload models BACKEND` lists them) and switch with `offload model BACKEND:MODEL`; some providers also say \"model not found\" when the API key is wrong.",
    [E.TIMEOUT]: "hint: raise opencode.timeout_seconds or send less input.",
    [E.TOO_LARGE]: "hint: send less at once — fewer files, a range (path:START-END) — or pick a model with a bigger context window (`offload model …`).",
  };
  if (hints[w.code]) err(hints[w.code]);
  throw new ExitError(w.code);
}

async function run(task: Parameters<typeof invoke>[0], prompt: string, cwd: string, model: string, what: string): Promise<InvokeResult> {
  try {
    const t = taskContext();
    const r = await invoke(task, prompt, cwd, model || undefined, t ? { system: t.system, primary: t.model } : {});
    lastFallback = r.fallback ?? "";
    return r;
  } catch (e) {
    return reportFailure(what, e);
  }
}

// ------------------------------------------------------------------ read

/** The files under d, relative to d with "/" separators, sorted (git's list when it is a
 *  repo: ignored files left out). */
function listRelFiles(d: string): string[] {
  let files: string[] = [];
  try {
    // big repos list more than the 1 MB default buffer, and a throw here meant a slow walk that ignores .gitignore
    const out = execFileSync("git", ["-C", d, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
    files = out.split("\n").filter(Boolean);
  } catch {
    const skip = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "target", "vendor"]);
    const walk = (p: string, rel: string) => {
      for (const e of readdirSync(p)) {
        if (skip.has(e)) continue;
        const q = join(p, e);
        const st = lstatSync(q);
        if (st.isDirectory()) walk(q, `${rel}${e}/`);
        else if (st.isFile()) files.push(`${rel}${e}`);
      }
    };
    walk(d, "");
  }
  return files.filter((f) => !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|.*\.min\.(js|css)|.*\.map)$/.test(f)).sort();
}

/** The files under d as paths from the current folder (one prefix, no path call per file). */
function listDirFiles(d: string): string[] {
  const pre = relative(process.cwd(), d).split(sep).join("/");
  return listRelFiles(d).map((f) => (pre ? `${pre}/${f}` : f));
}

function fileBlock(path: string, from: number, to: number, total: number): string {
  const body = numberLines(readFileSync(path, "utf8"), from, to);
  return `<file path="${path}" lines="${from}-${to}" total_lines="${total}">\n${fence(redact(body))}</file>\n\n`;
}

export async function cmdRead(argv: string[]): Promise<void> {
  const { opts, rest } = parseFlags(argv, {
    question: { alias: ["-q"], value: true },
    model: { alias: ["-m"], value: true },
    "no-verify": {},
    "no-cache": {},
    "allow-secrets": {},
    paths: {},
  });
  const question = str(opts.question);
  if (!question) die('read: -q "QUESTION" is required');
  if (!rest.length) die("read: give at least one file or directory");
  const allow = Boolean(opts["allow-secrets"]);
  const maxBytes = cfgInt("read.max_input_bytes", 1500000);
  const maxFiles = cfgInt("read.max_files", 60);
  let prompt = "";
  let nfiles = 0;
  let nlines = 0;
  const skipped: string[] = [];
  const sent: string[] = []; // paths as written in the prompt (citations may point at them)
  for (const item of rest) {
    let path = item;
    let from = 0;
    let to = 0;
    const m = item.match(/^(.*):(\d+)-(\d+)$/);
    if (!existsSync(item) && m) {
      path = m[1];
      from = Number(m[2]);
      to = Number(m[3]);
    }
    path = path.replace(/^\.\//, "");
    if (existsSync(path) && statSync(path).isDirectory()) {
      for (const f of listDirFiles(path)) {
        if (!existsSync(f) || !statSync(f).isFile()) continue;
        // links inside a directory are not followed (they may point outside it)
        if (lstatSync(f).isSymbolicLink()) {
          skipped.push(`${f}(symlink)`);
          continue;
        }
        if (isSecretPath(f) && !allow) {
          skipped.push(`${f}(secret)`);
          continue;
        }
        if (!isText(f)) continue;
        if (nfiles >= maxFiles) {
          skipped.push(`(+more: max_files=${maxFiles})`);
          break;
        }
        const total = fileLines(f);
        prompt += fileBlock(f, 1, total, total);
        sent.push(f);
        nfiles++;
        nlines += total;
      }
      continue;
    }
    if (!existsSync(path) || !statSync(path).isFile()) die(`read: file not found or unreadable: ${item}`);
    if (isSecretTarget(path) && !allow) die(`read: refusing to send ${path} to a third-party model (matches privacy.secret_globs). Use --allow-secrets if you are sure.`, E.REFUSED);
    if (!isText(path)) die(`read: ${path} looks binary; offload only handles text`, E.REFUSED);
    const total = fileLines(path);
    if (!from) from = 1;
    if (!to || to > total) to = total;
    prompt += fileBlock(path, from, to, total);
    sent.push(path);
    nfiles++;
    nlines += to - from + 1;
  }
  if (!nfiles) die(`read: no readable text files to send${skipped.length ? ` (skipped: ${skipped.join(" ")})` : ""}`, E.REFUSED);
  const bytes = Buffer.byteLength(prompt);
  if (bytes > maxBytes) die(`read: ${fmtInt(bytes)} bytes is over read.max_input_bytes (${fmtInt(maxBytes)}). Send fewer files, use file:START-END ranges, or try \`offload explore\`.`, E.REFUSED);
  prompt += `<question>${question}</question>\n`;
  const t0 = Date.now();
  // The same question about the same file contents (the prompt holds them) with the same model
  // and instructions: the checked answer from earlier, if it is recent. Twin: cmd_read (same files).
  const verifyOn = !opts["no-verify"];
  const cacheSec = cfgInt("read.cache_seconds", 3600);
  let cacheFile = "";
  if (!opts["no-cache"] && process.env.OFFLOAD_NO_CACHE !== "1" && cacheSec > 0) {
    const t = taskContext();
    const key = cksum(Buffer.from(`${prompt}\n${str(opts.model)}|${t?.name ?? ""}|${verifyOn}|${t?.system ?? ""}`));
    cacheFile = join(stateDir(), "cache", "answers", key);
    if (existsSync(cacheFile)) {
      const all = readFileSync(cacheFile, "utf8");
      const nl = all.indexOf("\n");
      const [at, hms, cok, cbad, ...m] = all.slice(0, nl).split(" ");
      if (Math.floor(Date.now() / 1000) - Number(at) <= cacheSec) {
        const body = all.slice(nl + 1);
        lastFallback = "";
        let out = body + footer(`${label("read")} · ${m.join(" ")} · ${nfiles} file(s), ${fmtInt(nlines)} lines (~${fmtInt(estTokens(bytes))} tokens) kept out of your context · 0s${verifyOn ? ` · citations: ${cok} verified, ${cbad} unverified` : ""} · cached from ${hms} (--no-cache to ask again)`);
        if (Number(cbad) > 0) out += "⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.\n";
        process.stdout.write(out);
        const bout = Buffer.byteLength(body);
        appendStatsRow({ kind: "read", source: "cache", model: m.join(" "), files: nfiles, bytes_in: bytes, bytes_out: bout, saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: 0, cites_ok: 0, cites_bad: 0, worker_tokens_in: 0, worker_tokens_out: 0 });
        return;
      }
    }
  }
  const r = await run("read", prompt, workDir(), str(opts.model), "read");
  let answer = r.text.replace(/\n?$/, "\n");
  let cite = "";
  let ok = 0;
  let bad = 0;
  if (!opts["no-verify"] && cfgBool("read.verify_citations", true)) {
    const v = verifyCitations(answer, process.cwd(), 3, sent);
    answer = v.text;
    ok = v.ok;
    bad = v.bad;
    // most citations wrong: ask once more with the failures in view, keep the better answer
    let retried = "";
    if (bad >= 2 && bad > ok && cfgBool("read.retry_unverified", true)) {
      const p2 = `${prompt}<previous_answer>\n${answer}</previous_answer>\n<check>Some citations in your previous answer quote text that is not at the lines they cite (marked ⚠unverified). Answer the question again: copy every quote character for character from the numbered lines it cites, and leave out a claim you cannot cite.</check>\n<question>${question}</question>\n`;
      try {
        const t = taskContext();
        const r2 = await invoke("read", p2, workDir(), str(opts.model) || undefined, t ? { system: t.system, primary: t.model } : {});
        const v2 = verifyCitations(r2.text.replace(/\n?$/, "\n"), process.cwd(), 3, sent);
        r.tokensIn += r2.tokensIn;
        r.tokensOut += r2.tokensOut;
        if (v2.bad < bad || (v2.bad === bad && v2.ok > ok)) {
          retried = ` · retried once: ${bad} → ${v2.bad} unverified`;
          answer = v2.text;
          ok = v2.ok;
          bad = v2.bad;
          r.model = r2.model;
        } else retried = " · retried once, the first answer was better";
      } catch {
        retried = " · a retry failed, first answer kept";
      }
    }
    cite = ` · citations: ${ok} verified, ${bad} unverified${retried}`;
  }
  if (cacheFile) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      writeFileSync(cacheFile, `${Math.floor(d.getTime() / 1000)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${ok} ${bad} ${r.model}\n${answer}`);
    } catch {
      /* a cache is best-effort */
    }
  }
  let out = answer + footer(`${label("read")} · ${r.model} · ${nfiles} file(s), ${fmtInt(nlines)} lines (~${fmtInt(estTokens(bytes))} tokens) kept out of your context · ${secs(t0)}s${cite}`);
  if (bad > 0) out += "⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.\n";
  if (skipped.length) out += `skipped: ${skipped.join(" ")}\n`;
  process.stdout.write(out);
  const bout = Buffer.byteLength(answer);
  appendStats({ kind: "read", model: r.model, files: nfiles, bytes_in: bytes, bytes_out: bout, saved_tokens: Math.max(0, Math.floor((bytes - bout) / 4)), seconds: secs(t0), cites_ok: ok, cites_bad: bad, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}

// --------------------------------------------------------------- explore

export async function cmdExplore(argv: string[]): Promise<void> {
  const { opts, rest } = parseFlags(argv, {
    question: { alias: ["-q"], value: true },
    model: { alias: ["-m"], value: true },
    dir: { value: true },
    "no-verify": {},
  });
  const question = [str(opts.question), ...rest].filter(Boolean).join(" ");
  if (!question) die('explore: give a question, e.g. offload explore "where are JWTs validated?"');
  const dir = resolve(str(opts.dir) || process.cwd());
  if (!existsSync(dir)) die(`explore: no such directory: ${dir}`);
  const prompt = `Investigate the codebase in the current working directory and answer the question.\n\n<question>${question}</question>\n`;
  const t0 = Date.now();
  const r = await run("explore", prompt, dir, str(opts.model), "explore");
  let answer = r.text.replace(/\n?$/, "\n");
  let cite = "";
  let ok = 0;
  let bad = 0;
  if (!opts["no-verify"]) {
    // the project's files, so a citation with a shortened path still finds its file
    const known = listRelFiles(dir);
    const v = verifyCitations(answer, dir, 3, [], known);
    answer = v.text;
    ok = v.ok;
    bad = v.bad;
    cite = ` · citations: ${ok} verified, ${bad} unverified`;
  }
  let out = answer + footer(`${label("explore")} · ${r.model} · worker read ~${fmtInt(r.ctxIn)} tokens of context for you · ${secs(t0)}s${cite}`);
  if (bad > 0) out += "⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.\n";
  process.stdout.write(out);
  const bout = Buffer.byteLength(answer);
  appendStats({ kind: "explore", model: r.model, bytes_out: bout, saved_tokens: Math.max(0, Math.floor(r.ctxIn - bout / 4)), seconds: secs(t0), cites_ok: ok, cites_bad: bad, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}

// ------------------------------------------------------------------- run

function execToFile(cmd: string[] | string, log: string): Promise<number> {
  return new Promise((res) => {
    const fd = openSync(log, "w");
    const child =
      typeof cmd === "string"
        ? spawn(process.platform === "win32" ? cmd : "bash", process.platform === "win32" ? [] : ["-c", cmd], { stdio: ["inherit", fd, fd], shell: process.platform === "win32" })
        : spawnSafe(cmd[0], cmd.slice(1), { stdio: ["inherit", fd, fd] }); // npm/npx .cmd shims on Windows
    child.on("error", (e) => {
      try {
        writeFileSync(log, `offload: cannot run ${Array.isArray(cmd) ? cmd[0] : cmd}: ${e.message}\n`, { flag: "a" });
      } catch {
        /* ignore */
      }
    });
    child.on("close", (code, signal) => {
      closeSync(fd);
      res(code ?? (signal ? 128 + 15 : 1));
    });
  });
}

export async function cmdRun(argv: string[]): Promise<number> {
  const { opts, rest } = parseFlags(argv, { focus: { alias: ["-q", "--question"], value: true }, model: { alias: ["-m"], value: true }, c: { alias: ["-c"], value: true }, "no-model": {} }, true);
  const sh = str(opts.c);
  if (!sh && !rest.length) die("run: nothing to run. Usage: offload run [-q FOCUS] -- CMD ARGS...  or  offload run -c 'CMD'");
  const label = sh || rest.map(shquote).join(" ");
  const log = newLogPath(label);
  const code = await execToFile(sh || rest, log);
  const text = readFileSync(log, "utf8");
  if (isSmall(text)) {
    process.stdout.write(text);
    rmSync(log, { force: true });
    return code;
  }
  process.stdout.write(await digest(log, label, String(code), str(opts.focus), "run", str(opts.model) || undefined, { noModel: Boolean(opts["no-model"]) }));
  return code;
}

export async function cmdSummarize(argv: string[]): Promise<void> {
  const { opts, rest } = parseFlags(argv, { focus: { alias: ["-q", "--question"], value: true }, model: { alias: ["-m"], value: true }, label: { value: true }, "no-model": {} });
  const file = rest[0] ?? "";
  const label = str(opts.label) || file || "stdin";
  const log = newLogPath(label);
  if (file && file !== "-") {
    if (!existsSync(file)) die(`summarize: no such file: ${file}`);
    if (isSecretTarget(file)) die(`summarize: refusing to send ${file} (matches privacy.secret_globs)`, E.REFUSED);
    writeFileSync(log, readFileSync(file));
  } else {
    if (process.stdin.isTTY) die("summarize: pipe text in or give a FILE");
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    writeFileSync(log, Buffer.concat(chunks));
  }
  const text = readFileSync(log, "utf8");
  if (isSmall(text)) {
    process.stdout.write(text);
    rmSync(log, { force: true });
    return;
  }
  process.stdout.write(await digest(log, label, "", str(opts.focus), "summarize", str(opts.model) || undefined, { noModel: Boolean(opts["no-model"]) }));
}

// ----------------------------------------------------------------- write

export async function cmdWrite(argv: string[]): Promise<number> {
  const { opts, rest } = parseFlags(argv, {
    spec: { alias: ["-s"], value: true },
    ref: { alias: ["--reference", "-r"], value: true, multi: true },
    context: { alias: ["-x"], value: true, multi: true },
    out: { alias: ["--target", "-o"], value: true },
    model: { alias: ["-m"], value: true },
    force: {},
    check: { value: true },
    "allow-secrets": {},
  });
  if (rest.length) die(`write: unexpected argument ${rest[0]} (see offload help)`);
  const spec = str(opts.spec);
  const refs = list(opts.ref);
  const ctxs = list(opts.context);
  const out = str(opts.out);
  if (!spec) die('write: --spec "WHAT TO GENERATE" is required');
  if (!refs.length) die("write: --ref FILE is required — an existing file whose patterns the output must follow. For a follow-up, reference the file the previous call generated.");
  if (out && existsSync(out) && !opts.force) die(`write: ${out} already exists — pick a new --out, or add --force to overwrite it`);
  for (const f of [...refs, ...ctxs]) {
    if (!existsSync(f)) die(`write: file not found: ${f}`);
    if (isSecretTarget(f) && !opts["allow-secrets"]) die(`write: refusing to send ${f} (matches privacy.secret_globs)`, E.REFUSED);
  }
  let prompt = "";
  for (const f of refs) prompt += `<reference path="${f}">\n${redact(readFileSync(f, "utf8"))}</reference>\n\n`;
  for (const f of ctxs) prompt += `<context path="${f}">\n${redact(readFileSync(f, "utf8"))}</context>\n\n`;
  if (out) prompt += `<target path="${out}"/>\n`;
  prompt += `<spec>${spec}</spec>\n`;
  const t0 = Date.now();
  const r = await run("write", prompt, workDir(), str(opts.model), "write");
  const code = stripWrappingFence(r.text);
  const n = code.split("\n").length - 1;
  const todos = (code.match(/TODO\(offload\)/g) || []).length;
  let failed = false;
  if (!out) {
    process.stdout.write(code + footer(`write · ${r.model} · ${n} lines · ${secs(t0)}s · review before use`));
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code);
    let msg = `offload write: wrote ${n} lines to ${out} (${r.model}, ${secs(t0)}s).\n`;
    if (todos) msg += `  ${todos} TODO(offload) marker(s) where the worker lacked information — grep -n 'TODO(offload)' ${shquote(out)}\n`;
    msg += "  Review it: Read the file (or the parts that need judgment) and fix what the worker got wrong.\n";
    process.stdout.write(msg);
    const check = str(opts.check);
    if (check) {
      const log = newLogPath(`check-${check}`);
      const crc = await execToFile(check, log);
      failed = crc !== 0;
      process.stdout.write(crc === 0 ? `  check passed: ${check}\n` : `  check FAILED (exit ${crc}): ${check}\n`);
      const text = readFileSync(log, "utf8");
      if (isSmall(text)) {
        process.stdout.write(text.split("\n").filter((l, i, a) => i < a.length - 1 || l).map((l) => `    ${l}\n`).join(""));
        rmSync(log, { force: true });
      } else {
        process.stdout.write((await digest(log, check, String(crc), "", "run")).split("\n").map((l) => (l ? `    ${l}` : l)).join("\n"));
      }
    }
  }
  appendStats({ kind: "write", model: r.model, lines: n, seconds: secs(t0), saved_tokens: out ? Math.floor(Buffer.byteLength(code) / 4) : 0, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
  return failed ? 1 : 0;
}

// ------------------------------------------------------------------- ask

export async function cmdAsk(argv: string[]): Promise<void> {
  const { opts, rest } = parseFlags(argv, { model: { alias: ["-m"], value: true }, stdin: {}, file: { alias: ["-f"], value: true } });
  const question = rest.join(" ");
  if (!question) die("ask: give a question");
  let prompt = "";
  if (opts.stdin) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    prompt += `<input>\n${fence(redact(Buffer.concat(chunks).toString("utf8")))}</input>\n\n`;
  }
  const file = str(opts.file);
  if (file) {
    if (!existsSync(file)) die(`ask: no such file: ${file}`);
    if (isSecretTarget(file)) die(`ask: refusing to send ${file} (matches privacy.secret_globs)`, E.REFUSED);
    prompt += `<input path="${file}">\n${fence(redact(readFileSync(file, "utf8")))}</input>\n\n`;
  }
  prompt += `${question}\n`;
  const t0 = Date.now();
  const r = await run("ask", prompt, workDir(), str(opts.model), "ask");
  process.stdout.write(r.text.replace(/\n?$/, "\n") + footer(`${label("ask")} · ${r.model} · ${secs(t0)}s`));
  appendStats({ kind: "ask", model: r.model, seconds: secs(t0), saved_tokens: 0, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}

export function cmdOutline(argv: string[]): void {
  if (argv[0] === "--") argv = argv.slice(1);
  const file = argv[0];
  if (!file || !existsSync(file)) die("outline: give a file");
  process.stdout.write(outline(file, Number(argv[1]) || 80));
}

export { UsageError };

// ------------------------------------------------------------------ custom tasks

/** offload tasks templates | offload tasks add NAME [--from TEMPLATE] [--project]. Twin: cmd_tasks (same text). */
async function tasksTemplates(argv: string[]): Promise<boolean> {
  const { TASK_TEMPLATES_JSON: T } = await import("../generated/assets.ts");
  const names = Object.keys(T).filter((k) => !k.startsWith("_"));
  if (argv[0] === "templates") {
    let out = "Task templates (offload tasks add NAME --from TEMPLATE):\n";
    for (const n of names) out += `  ${n}${" ".repeat(Math.max(0, 20 - n.length))}${T[n].description}\n  ${" ".repeat(20)}e.g. ${T[n].usage}\n`;
    process.stdout.write(out);
    return true;
  }
  if (argv[0] !== "add") return false;
  let name = "";
  let from = "";
  let project = false;
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--from") from = rest[++i] ?? "";
    else if (rest[i] === "--project") project = true;
    else if (rest[i].startsWith("-")) return die(`tasks add: unknown option ${rest[i]}`);
    else name = rest[i];
  }
  if (!name) return die("tasks add NAME [--from TEMPLATE] [--project]   (templates: offload tasks templates)");
  from ||= name;
  if (!TASK_NAME.test(name)) return die("tasks add: a task name is lowercase letters, digits, - and _ (up to 40)");
  if (!names.includes(from)) return die(`tasks add: no template "${from}" (offload tasks templates lists them)`);
  const { readConfigFile, writeConfigFile } = await import("../config.ts");
  const { projectConfigPath, userConfigPath } = await import("../paths.ts");
  const target = project ? projectConfigPath() : userConfigPath();
  const cur = readConfigFile(target) as Record<string, any>;
  if (cur.tasks?.[name] != null) return die(`tasks add: ${name} already exists in ${target}`);
  const { description, prompt, tools } = T[from];
  writeConfigFile(target, { ...cur, tasks: { ...(cur.tasks ?? {}), [name]: { description, prompt, tools } } });
  process.stdout.write(`added task ${name} (from ${from}) to ${target}\nrun it: ${String(T[from].usage).replace(`task ${from}`, `task ${name}`)}\n`);
  return true;
}
export async function cmdTasks(argv: string[] = []): Promise<void> {
  if (await tasksTemplates(argv)) return;
  const names = taskNames();
  if (!names.length) {
    process.stdout.write(
      "No custom tasks yet. Start from a template (offload tasks templates), for example:\n  offload tasks add review-diff\nor write your own:\n" +
        `  offload config set tasks.review-sql '{"description":"Find N+1 queries","prompt":"You review SQL access code for N+1 queries.","tools":"none"}'\n` +
        "then: offload task review-sql src/db/\n",
    );
    return;
  }
  let out = "Custom tasks (offload task NAME [-q QUESTION] [PATH...]):\n";
  for (const n of names) {
    const d = taskDef(n);
    out += `  ${n.padEnd(20)} ${d?.description ?? ""}  [${d?.tools ?? "none"} · ${d?.model || "default model"}]\n`;
  }
  process.stdout.write(out);
}

/** offload task NAME [-q Q] [-m REF] [--stdin] [PATH...] — runs through read, ask or explore. */
export async function cmdTask(argv: string[]): Promise<void> {
  const name = argv[0] ?? "";
  if (!name || name === "--list" || name === "-l") return cmdTasks();
  if (!/^[a-z0-9_-]+$/.test(name) || name.startsWith("-")) die(`task: names use lowercase letters, digits, - and _ (${name})`);
  if (!TASK_NAME.test(name)) die(`task: names are at most 40 characters (${name})`);
  const def = taskDef(name);
  if (!def) die(`task: no task named ${name} (offload tasks lists them)`);
  const { opts, rest } = parseFlags(argv.slice(1), { question: { alias: ["-q"], value: true }, model: { alias: ["-m"], value: true }, stdin: {} });
  let system: string;
  try {
    system = taskSystem(def!);
  } catch (e) {
    return die((e as Error).message);
  }
  setTaskContext({ name, system, model: def!.model || undefined });
  try {
    let question = str(opts.question) || "Do the task described in your instructions.";
    const m = str(opts.model) ? ["-m", str(opts.model)] : [];
    if (def!.tools === "read") {
      if (rest.length) question += ` (start with: ${rest.join(" ")})`;
      await cmdExplore([...m, "--", question]);
    } else if (rest.length) await cmdRead([...m, "-q", question, "--", ...rest]);
    else await cmdAsk([...m, ...(opts.stdin ? ["--stdin"] : []), "--", question]);
  } finally {
    setTaskContext(undefined);
  }
}
