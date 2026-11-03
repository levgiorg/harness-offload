import {
  spawnSafe2,
  parseFlags,
  str,
  list,
  ExitError2
} from "./chunk-yrbt2j5y.js";
import {
  cfgInt2,
  cfgBool2,
  isSecretPath,
  isSecretTarget,
  redact,
  fence
} from "./chunk-fprvy154.js";
import {
  fileLines,
  estTokens,
  estTokensText,
  isText,
  fmtInt,
  shquote,
  numberLines,
  stripWrappingFence
} from "./chunk-rh4zgg1b.js";
import {
  E,
  WorkerError,
  stateDir2,
  workDir2,
  appendStats2,
  newLogPath2,
  cksum2
} from "./chunk-t783jg2c.js";
import {
  invoke2
} from "./chunk-20nw982y.js";
import {
  digest,
  isSmall,
  outline2
} from "./chunk-7pg52q8v.js";
import {
  TASK_NAME,
  taskNames,
  taskDef,
  taskSystem,
  setTaskContext,
  taskContext
} from "./chunk-x3bqkf9c.js";

// src/commands/core.ts
import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync as readFileSync2, readdirSync, rmSync, statSync as statSync2, writeFileSync } from "node:fs";
import { dirname, join as join2, relative as relative2, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

// src/verify.ts
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
var MAX_FILE_BYTES = 8 * 1024 * 1024;
var MAX_LINE = 4000;
var norm = (s) => s.replace(/[ \t\r]+/g, " ").trim();
function lastSpan(s) {
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
    } else if (open)
      cur += c;
  }
  return last;
}
function elided(hay, q) {
  const t = q.replace(/…/g, "...");
  if (!t.includes("..."))
    return false;
  let pos = 0;
  let longest = 0;
  for (const piece of t.split(/\.{3,}/)) {
    const f = norm(piece);
    if (!f)
      continue;
    const at = hay.indexOf(f, pos);
    if (at < 0)
      return false;
    pos = at + f.length;
    longest = Math.max(longest, f.length);
  }
  return longest >= 6;
}
function again(s, c) {
  for (let i = s.indexOf(c);i >= 0; i = s.indexOf(c, i + c.length)) {
    const x = i > 0 ? s[i - 1] : "";
    const y = s[i + c.length] ?? "";
    if (!/[A-Za-z0-9_.@\/+-]/.test(x) && !/[0-9-]/.test(y))
      return true;
  }
  return false;
}
function verifyCitations(answer, root, slack = 3, sent = [], known = []) {
  const cache = new Map;
  const sentPaths = new Set(sent.map((s) => s.replace(/^\.\//, "")));
  const load = (p) => {
    if (cache.has(p))
      return cache.get(p);
    let lines = null;
    try {
      const real = realpathSync(isAbsolute(p) ? p : join(root, p.replace(/^\.\//, "")));
      const rel = relative(realpathSync(root), real);
      if (!sentPaths.has(p.replace(/^\.\//, "")) && (rel.startsWith("..") || isAbsolute(rel)))
        throw new Error("outside");
      const st = statSync(real);
      if (!st.isFile() || st.size > MAX_FILE_BYTES)
        throw new Error("not a regular file");
      const t = readFileSync(real, "utf8");
      lines = t.split(`
`);
      if (t.endsWith(`
`))
        lines.pop();
      if (lines.length === 0)
        lines = null;
    } catch {
      lines = null;
    }
    cache.set(p, lines);
    return lines;
  };
  const knownList = [];
  const isKnown = new Set;
  const byBase = new Map;
  const remember = (k0) => {
    const k = k0.replace(/^\.\//, "");
    if (!k || isKnown.has(k) || knownList.length >= 50000)
      return;
    isKnown.add(k);
    knownList.push(k);
    const base = k.slice(k.lastIndexOf("/") + 1);
    const list = byBase.get(base);
    if (list)
      list.push(k);
    else
      byBase.set(base, [k]);
  };
  for (const s of sent)
    remember(s);
  for (const k of known)
    remember(k);
  const locate = (p) => {
    if (load(p))
      return p;
    const q = p.replace(/^\.\//, "");
    if (!q || !knownList.length)
      return;
    const hits = knownList.filter((k) => k.length > q.length && k.endsWith("/" + q) || q.length > k.length && q.endsWith("/" + k));
    if (hits.length === 1)
      return hits[0];
    if (hits.length > 1)
      return;
    const byName = byBase.get(q.slice(q.lastIndexOf("/") + 1)) ?? [];
    return byName.length === 1 ? byName[0] : undefined;
  };
  const check = (p, a, b, q) => {
    const lines = load(p);
    if (!lines)
      return false;
    if (b < a)
      b = a;
    const lo = Math.max(1, a - slack);
    const hi = Math.min(lines.length, b + slack);
    const nq = norm(q.replace(/&lt;/g, "<"));
    if (!nq)
      return false;
    for (let i = lo;i <= hi; i++)
      if (norm(lines[i - 1]).includes(nq))
        return true;
    const hay = norm(lines.slice(lo - 1, hi).join(" "));
    return hay.includes(nq) || elided(hay, nq);
  };
  let ok = 0;
  let bad = 0;
  const cite = /(?<![A-Za-z0-9_.@\/+-])[A-Za-z0-9_.@\/+-]+:L?[0-9]+(?:-L?[0-9]+)?/;
  const out = answer.split(`
`).map((line) => {
    if (line.length > MAX_LINE)
      return line;
    let rest = line;
    let marked = false;
    let outl = "";
    let m;
    while (m = cite.exec(rest)) {
      const c = m[0];
      const before = rest.slice(0, m.index);
      const after = rest.slice(m.index + c.length);
      const bt = before.endsWith("`") && after.startsWith("`");
      rest = bt ? after.slice(1) : after;
      outl += before + c;
      const at = c.indexOf(":");
      const path = c.slice(0, at);
      const range = c.slice(at + 1).replace(/^L/, "");
      if (c[at + 1] !== "L" && !isKnown.has(path.replace(/^\.\//, ""))) {
        if (bt)
          outl += "`";
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
          const s2 = t.indexOf("`", e + 1);
          if (s2 >= 0 && !/[A-Za-z0-9_.@\/+-]+:L?[0-9]/.test(t.slice(e + 1, s2 + 1))) {
            const e2 = t.indexOf("`", s2 + 1);
            if (e2 >= 0)
              qa2 = t.slice(s2 + 1, e2);
          }
        }
      }
      let qb = lastSpan(before);
      if (norm(qa).length < 3)
        qa = "";
      if (norm(qa2).length < 3)
        qa2 = "";
      if (norm(qb).length < 6)
        qb = "";
      if (again(after, c))
        qa = qa2 = qb = "";
      if (qa || qa2 || qb) {
        const real = locate(path);
        if (real && (qa && check(real, a, b, qa) || qa2 && check(real, a, b, qa2) || qb && check(real, a, b, qb))) {
          ok++;
          if (real !== path)
            outl = outl.slice(0, outl.length - c.length) + real + c.slice(at);
        } else {
          bad++;
          marked = true;
        }
      }
      if (bt)
        outl += "`";
    }
    outl += rest;
    return marked ? outl + " ⚠unverified" : outl;
  });
  return { text: out.join(`
`), ok, bad };
}
// src/commands/core.ts
var err = (m) => process.stderr.write(`offload: ${m}
`);
var die = (m, code = E.USAGE) => {
  err(m);
  throw new ExitError2(code);
};
var lastFallback = "";
var lastCut = "";
var footer = (s) => `
[offload ${s}${lastFallback ? ` · ${lastFallback}` : ""}${lastCut ? ` · ${lastCut}` : ""}]
`;
var label = (kind) => {
  const t = taskContext();
  return t ? `task ${t.name}` : kind;
};
var appendStats = (row) => {
  const t = taskContext();
  const { kind, ...rest } = row;
  appendStats2(t ? { kind, task: t.name, ...rest } : row);
};
var secs = (t0) => Math.round((Date.now() - t0) / 1000);
function reportFailure(what, e) {
  const w = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String(e));
  err(`${what} failed (exit ${w.code}): ${w.message}`);
  const hints = {
    [E.QUOTA]: "hint: quota/rate limit — add models.fallback in the config, or do this step yourself.",
    [E.AUTH]: "hint: log the backend in (its own CLI login, or `opencode auth login`) or set its API key with `offload setup`; `offload doctor` shows which.",
    [E.MODEL]: 'hint: check the model id (`offload models BACKEND` lists them) and switch with `offload model BACKEND:MODEL`; some providers also say "model not found" when the API key is wrong.',
    [E.TIMEOUT]: "hint: raise opencode.timeout_seconds (or timeouts.<task> for one kind of work) or send less input.",
    [E.TOO_LARGE]: "hint: send less at once — fewer files, a range (path:START-END) — or pick a model with a bigger context window (`offload model …`)."
  };
  if (hints[w.code])
    err(hints[w.code]);
  throw new ExitError2(w.code);
}
async function run(task, prompt, cwd, model, what) {
  try {
    const t = taskContext();
    const r = await invoke2(task, prompt, cwd, model || undefined, t ? { system: t.system, primary: t.model } : {});
    lastFallback = r.fallback ?? "";
    lastCut = r.cut ?? "";
    return r;
  } catch (e) {
    return reportFailure(what, e);
  }
}
function listRelFiles(d) {
  let files = [];
  try {
    const out = execFileSync("git", ["-C", d, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
    files = out.split(`
`).filter(Boolean);
  } catch {
    const skip = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "target", "vendor"]);
    const walk = (p, rel) => {
      for (const e of readdirSync(p)) {
        if (skip.has(e))
          continue;
        const q = join2(p, e);
        const st = lstatSync(q);
        if (st.isDirectory())
          walk(q, `${rel}${e}/`);
        else if (st.isFile())
          files.push(`${rel}${e}`);
      }
    };
    walk(d, "");
  }
  return files.filter((f) => !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|.*\.min\.(js|css)|.*\.map)$/.test(f)).sort();
}
function listDirFiles(d) {
  const pre = relative2(process.cwd(), d).split(sep).join("/");
  return listRelFiles(d).map((f) => pre ? `${pre}/${f}` : f);
}
function fileBlock(path, from, to, total) {
  const body = numberLines(readFileSync2(path, "utf8"), from, to);
  return `<file path="${path}" lines="${from}-${to}" total_lines="${total}">
${fence(redact(body))}</file>

`;
}
async function cmdRead2(argv) {
  const { opts, rest } = parseFlags(argv, {
    question: { alias: ["-q"], value: true },
    model: { alias: ["-m"], value: true },
    "no-verify": {},
    "no-cache": {},
    "allow-secrets": {},
    paths: {}
  });
  const question = str(opts.question);
  if (!question)
    die('read: -q "QUESTION" is required');
  if (!rest.length)
    die("read: give at least one file or directory");
  const allow = Boolean(opts["allow-secrets"]);
  const maxBytes = cfgInt2("read.max_input_bytes", 1500000);
  const maxFiles = cfgInt2("read.max_files", 60);
  let prompt = "";
  let nfiles = 0;
  let nlines = 0;
  const skipped = [];
  const sent = [];
  for (const item of rest) {
    let path = item;
    let from = 0;
    let to = 0;
    const m = item.match(/^(.*):(\d+)-(\d+)$/);
    const hash = item.lastIndexOf("#");
    if (!existsSync(item) && m) {
      path = m[1];
      from = Number(m[2]);
      to = Number(m[3]);
    } else if (!existsSync(item) && hash > 0 && existsSync(item.slice(0, hash)) && statSync2(item.slice(0, hash)).isFile()) {
      path = item.slice(0, hash);
      const sym = item.slice(hash + 1);
      const r = (await import("./chunk-pvms9vpq.js")).symbolRange(path, sym);
      if (!r)
        die(`read: no symbol "${sym}" in ${path} (offload outline ${shquote(path)} lists them)`);
      [from, to] = r;
    }
    path = path.replace(/^\.\//, "");
    if (existsSync(path) && statSync2(path).isDirectory()) {
      for (const f of listDirFiles(path)) {
        if (!existsSync(f) || !statSync2(f).isFile())
          continue;
        if (lstatSync(f).isSymbolicLink()) {
          skipped.push(`${f}(symlink)`);
          continue;
        }
        if (isSecretPath(f) && !allow) {
          skipped.push(`${f}(secret)`);
          continue;
        }
        if (!isText(f))
          continue;
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
    if (!existsSync(path) || !statSync2(path).isFile())
      die(`read: file not found or unreadable: ${item}`);
    if (isSecretTarget(path) && !allow)
      die(`read: refusing to send ${path} to a third-party model (matches privacy.secret_globs). Use --allow-secrets if you are sure.`, E.REFUSED);
    if (!isText(path))
      die(`read: ${path} looks binary; offload only handles text`, E.REFUSED);
    const total = fileLines(path);
    if (!from)
      from = 1;
    if (!to || to > total)
      to = total;
    prompt += fileBlock(path, from, to, total);
    sent.push(path);
    nfiles++;
    nlines += to - from + 1;
  }
  if (!nfiles)
    die(`read: no readable text files to send${skipped.length ? ` (skipped: ${skipped.join(" ")})` : ""}`, E.REFUSED);
  const bytes = Buffer.byteLength(prompt);
  if (bytes > maxBytes)
    die(`read: ${fmtInt(bytes)} bytes is over read.max_input_bytes (${fmtInt(maxBytes)}). Send fewer files, use file:START-END ranges, or try \`offload explore\`.`, E.REFUSED);
  prompt += `<question>${question}</question>
`;
  const ein = Math.max(0, estTokensText(prompt) - Math.floor(nlines * 3066 / 1000)) || estTokens(bytes);
  const t0 = Date.now();
  const verifyOn = !opts["no-verify"];
  const cacheSec = cfgInt2("read.cache_seconds", 3600);
  let cacheFile = "";
  if (!opts["no-cache"] && process.env.OFFLOAD_NO_CACHE !== "1" && cacheSec > 0) {
    const t = taskContext();
    const key = cksum2(Buffer.from(`${prompt}
${str(opts.model)}|${t?.name ?? ""}|${verifyOn}|${t?.system ?? ""}`));
    cacheFile = join2(stateDir2(), "cache", "answers", key);
    if (existsSync(cacheFile)) {
      const all = readFileSync2(cacheFile, "utf8");
      const nl = all.indexOf(`
`);
      const [at, hms, cok, cbad, ...m] = all.slice(0, nl).split(" ");
      if (Math.floor(Date.now() / 1000) - Number(at) <= cacheSec) {
        const body = all.slice(nl + 1);
        lastFallback = "";
        lastCut = "";
        let out = body + footer(`${label("read")} · ${m.join(" ")} · ${nfiles} file(s), ${fmtInt(nlines)} lines (~${fmtInt(ein)} tokens) kept out of your context · 0s${verifyOn ? ` · citations: ${cok} verified, ${cbad} unverified` : ""} · cached from ${hms} (--no-cache to ask again)`);
        if (Number(cbad) > 0)
          out += `⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.
`;
        process.stdout.write(out);
        const bout = Buffer.byteLength(body);
        appendStats2({ kind: "read", source: "cache", model: m.join(" "), files: nfiles, bytes_in: bytes, bytes_out: bout, saved_tokens: Math.max(0, ein - estTokensText(body)), seconds: 0, cites_ok: 0, cites_bad: 0, worker_tokens_in: 0, worker_tokens_out: 0 });
        return;
      }
    }
  }
  const r = await run("read", prompt, workDir2(), str(opts.model), "read");
  let answer = r.text.replace(/\n?$/, `
`);
  let cite = "";
  let ok = 0;
  let bad = 0;
  if (!opts["no-verify"] && cfgBool2("read.verify_citations", true)) {
    const v = verifyCitations(answer, process.cwd(), 3, sent);
    answer = v.text;
    ok = v.ok;
    bad = v.bad;
    let retried = "";
    if (bad >= 2 && bad > ok && cfgBool2("read.retry_unverified", true)) {
      const p2 = `${prompt}<previous_answer>
${answer}</previous_answer>
<check>Some citations in your previous answer quote text that is not at the lines they cite (marked ⚠unverified). Answer the question again: copy every quote character for character from the numbered lines it cites, and leave out a claim you cannot cite.</check>
<question>${question}</question>
`;
      try {
        const t = taskContext();
        const r2 = await invoke2("read", p2, workDir2(), str(opts.model) || undefined, t ? { system: t.system, primary: t.model } : {});
        const v2 = verifyCitations(r2.text.replace(/\n?$/, `
`), process.cwd(), 3, sent);
        r.tokensIn += r2.tokensIn;
        r.tokensOut += r2.tokensOut;
        if (v2.bad < bad || v2.bad === bad && v2.ok > ok) {
          retried = ` · retried once: ${bad} → ${v2.bad} unverified`;
          answer = v2.text;
          ok = v2.ok;
          bad = v2.bad;
          r.model = r2.model;
        } else
          retried = " · retried once, the first answer was better";
      } catch {
        retried = " · a retry failed, first answer kept";
      }
    }
    cite = ` · citations: ${ok} verified, ${bad} unverified${retried}`;
  }
  if (cacheFile) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const d = new Date;
      const p2 = (n) => String(n).padStart(2, "0");
      writeFileSync(cacheFile, `${Math.floor(d.getTime() / 1000)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${ok} ${bad} ${r.model}
${answer}`);
    } catch {}
  }
  let out = answer + footer(`${label("read")} · ${r.model} · ${nfiles} file(s), ${fmtInt(nlines)} lines (~${fmtInt(ein)} tokens) kept out of your context · ${secs(t0)}s${cite}`);
  if (bad > 0)
    out += `⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.
`;
  if (skipped.length)
    out += `skipped: ${skipped.join(" ")}
`;
  process.stdout.write(out);
  const bout = Buffer.byteLength(answer);
  appendStats({ kind: "read", model: r.model, files: nfiles, bytes_in: bytes, bytes_out: bout, saved_tokens: Math.max(0, ein - estTokensText(answer)), seconds: secs(t0), cites_ok: ok, cites_bad: bad, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}
async function cmdExplore2(argv) {
  const { opts, rest } = parseFlags(argv, {
    question: { alias: ["-q"], value: true },
    model: { alias: ["-m"], value: true },
    dir: { value: true },
    "no-verify": {}
  });
  const question = [str(opts.question), ...rest].filter(Boolean).join(" ");
  if (!question)
    die('explore: give a question, e.g. offload explore "where are JWTs validated?"');
  const dir = resolve(str(opts.dir) || process.cwd());
  if (!existsSync(dir))
    die(`explore: no such directory: ${dir}`);
  const prompt = `Investigate the codebase in the current working directory and answer the question.

<question>${question}</question>
`;
  const t0 = Date.now();
  const r = await run("explore", prompt, dir, str(opts.model), "explore");
  let answer = r.text.replace(/\n?$/, `
`);
  let cite = "";
  let ok = 0;
  let bad = 0;
  if (!opts["no-verify"]) {
    const known = listRelFiles(dir);
    const v = verifyCitations(answer, dir, 3, [], known);
    answer = v.text;
    ok = v.ok;
    bad = v.bad;
    cite = ` · citations: ${ok} verified, ${bad} unverified`;
  }
  let out = answer + footer(`${label("explore")} · ${r.model} · worker read ~${fmtInt(r.ctxIn)} tokens of context for you · ${secs(t0)}s${cite}`);
  if (bad > 0)
    out += `⚠unverified = quote not found near the cited lines; confirm with Read(offset/limit) before acting on it.
`;
  process.stdout.write(out);
  const bout = Buffer.byteLength(answer);
  appendStats({ kind: "explore", model: r.model, bytes_out: bout, saved_tokens: Math.max(0, r.ctxIn - estTokensText(answer)), seconds: secs(t0), cites_ok: ok, cites_bad: bad, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}
function execToFile(cmd, log) {
  return new Promise((res) => {
    const fd = openSync(log, "w");
    const child = typeof cmd === "string" ? spawn(process.platform === "win32" ? cmd : "bash", process.platform === "win32" ? [] : ["-c", cmd], { stdio: ["inherit", fd, fd], shell: process.platform === "win32" }) : spawnSafe2(cmd[0], cmd.slice(1), { stdio: ["inherit", fd, fd] });
    child.on("error", (e) => {
      try {
        writeFileSync(log, `offload: cannot run ${Array.isArray(cmd) ? cmd[0] : cmd}: ${e.message}
`, { flag: "a" });
      } catch {}
    });
    child.on("close", (code, signal) => {
      closeSync(fd);
      res(code ?? (signal ? 143 : 1));
    });
  });
}
async function cmdRun2(argv) {
  const { opts, rest } = parseFlags(argv, { focus: { alias: ["-q", "--question", "--intent"], value: true }, model: { alias: ["-m"], value: true }, c: { alias: ["-c"], value: true }, "no-model": {} }, true);
  const sh = str(opts.c);
  if (!sh && !rest.length)
    die("run: nothing to run. Usage: offload run [-q FOCUS] -- CMD ARGS...  or  offload run -c 'CMD'");
  const label = sh || rest.map(shquote).join(" ");
  const log = newLogPath2(label);
  const code = await execToFile(sh || rest, log);
  const text = readFileSync2(log, "utf8");
  if (isSmall(text)) {
    process.stdout.write(text);
    rmSync(log, { force: true });
    return code;
  }
  process.stdout.write(await digest(log, label, String(code), str(opts.focus), "run", str(opts.model) || undefined, { noModel: Boolean(opts["no-model"]) }));
  return code;
}
async function cmdSummarize2(argv) {
  const { opts, rest } = parseFlags(argv, { focus: { alias: ["-q", "--question", "--intent"], value: true }, model: { alias: ["-m"], value: true }, label: { value: true }, "no-model": {} });
  const file = rest[0] ?? "";
  const label = str(opts.label) || file || "stdin";
  const log = newLogPath2(label);
  if (file && file !== "-") {
    if (!existsSync(file))
      die(`summarize: no such file: ${file}`);
    if (isSecretTarget(file))
      die(`summarize: refusing to send ${file} (matches privacy.secret_globs)`, E.REFUSED);
    writeFileSync(log, readFileSync2(file));
  } else {
    if (process.stdin.isTTY)
      die("summarize: pipe text in or give a FILE");
    const chunks = [];
    for await (const c of process.stdin)
      chunks.push(c);
    writeFileSync(log, Buffer.concat(chunks));
  }
  const text = readFileSync2(log, "utf8");
  if (isSmall(text)) {
    process.stdout.write(text);
    rmSync(log, { force: true });
    return;
  }
  process.stdout.write(await digest(log, label, "", str(opts.focus), "summarize", str(opts.model) || undefined, { noModel: Boolean(opts["no-model"]) }));
}
async function cmdWrite2(argv) {
  const { opts, rest } = parseFlags(argv, {
    spec: { alias: ["-s"], value: true },
    ref: { alias: ["--reference", "-r"], value: true, multi: true },
    context: { alias: ["-x"], value: true, multi: true },
    out: { alias: ["--target", "-o"], value: true },
    model: { alias: ["-m"], value: true },
    force: {},
    check: { value: true },
    "allow-secrets": {}
  });
  if (rest.length)
    die(`write: unexpected argument ${rest[0]} (see offload help)`);
  const spec = str(opts.spec);
  const refs = list(opts.ref);
  const ctxs = list(opts.context);
  const out = str(opts.out);
  if (!spec)
    die('write: --spec "WHAT TO GENERATE" is required');
  if (!refs.length)
    die("write: --ref FILE is required — an existing file whose patterns the output must follow. For a follow-up, reference the file the previous call generated.");
  if (out && existsSync(out) && !opts.force)
    die(`write: ${out} already exists — pick a new --out, or add --force to overwrite it`);
  for (const f of [...refs, ...ctxs]) {
    if (!existsSync(f))
      die(`write: file not found: ${f}`);
    if (isSecretTarget(f) && !opts["allow-secrets"])
      die(`write: refusing to send ${f} (matches privacy.secret_globs)`, E.REFUSED);
  }
  let prompt = "";
  for (const f of refs)
    prompt += `<reference path="${f}">
${redact(readFileSync2(f, "utf8"))}</reference>

`;
  for (const f of ctxs)
    prompt += `<context path="${f}">
${redact(readFileSync2(f, "utf8"))}</context>

`;
  if (out)
    prompt += `<target path="${out}"/>
`;
  prompt += `<spec>${spec}</spec>
`;
  const t0 = Date.now();
  const r = await run("write", prompt, workDir2(), str(opts.model), "write");
  const code = stripWrappingFence(r.text);
  const n = code.split(`
`).length - 1;
  const todos = (code.match(/TODO\(offload\)/g) || []).length;
  let failed = false;
  if (!out) {
    process.stdout.write(code + footer(`write · ${r.model} · ${n} lines · ${secs(t0)}s · review before use`));
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code);
    let msg = `offload write: wrote ${n} lines to ${out} (${r.model}, ${secs(t0)}s).
`;
    if (todos)
      msg += `  ${todos} TODO(offload) marker(s) where the worker lacked information — grep -n 'TODO(offload)' ${shquote(out)}
`;
    msg += `  Review it: Read the file (or the parts that need judgment) and fix what the worker got wrong.
`;
    process.stdout.write(msg);
    const check = str(opts.check);
    if (check) {
      const log = newLogPath2(`check-${check}`);
      const crc = await execToFile(check, log);
      failed = crc !== 0;
      process.stdout.write(crc === 0 ? `  check passed: ${check}
` : `  check FAILED (exit ${crc}): ${check}
`);
      const text = readFileSync2(log, "utf8");
      if (isSmall(text)) {
        process.stdout.write(text.split(`
`).filter((l, i, a) => i < a.length - 1 || l).map((l) => `    ${l}
`).join(""));
        rmSync(log, { force: true });
      } else {
        process.stdout.write((await digest(log, check, String(crc), "", "run")).split(`
`).map((l) => l ? `    ${l}` : l).join(`
`));
      }
    }
  }
  appendStats({ kind: "write", model: r.model, lines: n, seconds: secs(t0), saved_tokens: out ? estTokensText(code) : 0, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
  return failed ? 1 : 0;
}
async function cmdAsk2(argv) {
  const { opts, rest } = parseFlags(argv, { model: { alias: ["-m"], value: true }, stdin: {}, file: { alias: ["-f"], value: true } });
  const question = rest.join(" ");
  if (!question)
    die("ask: give a question");
  let prompt = "";
  if (opts.stdin) {
    const chunks = [];
    for await (const c of process.stdin)
      chunks.push(c);
    prompt += `<input>
${fence(redact(Buffer.concat(chunks).toString("utf8")))}</input>

`;
  }
  const file = str(opts.file);
  if (file) {
    if (!existsSync(file))
      die(`ask: no such file: ${file}`);
    if (isSecretTarget(file))
      die(`ask: refusing to send ${file} (matches privacy.secret_globs)`, E.REFUSED);
    prompt += `<input path="${file}">
${fence(redact(readFileSync2(file, "utf8")))}</input>

`;
  }
  prompt += `${question}
`;
  const t0 = Date.now();
  const r = await run("ask", prompt, workDir2(), str(opts.model), "ask");
  process.stdout.write(r.text.replace(/\n?$/, `
`) + footer(`${label("ask")} · ${r.model} · ${secs(t0)}s`));
  appendStats({ kind: "ask", model: r.model, seconds: secs(t0), saved_tokens: 0, worker_tokens_in: r.tokensIn, worker_tokens_out: r.tokensOut });
}
function cmdOutline2(argv) {
  if (argv[0] === "--")
    argv = argv.slice(1);
  const file = argv[0];
  if (!file || !existsSync(file))
    die("outline: give a file");
  process.stdout.write(outline2(file, Number(argv[1]) || 80));
}
async function tasksTemplates(argv) {
  const { TASK_TEMPLATES_JSON: T } = await import("./chunk-rk7gt2jq.js");
  const names = Object.keys(T).filter((k) => !k.startsWith("_"));
  if (argv[0] === "templates") {
    let out = `Task templates (offload tasks add NAME --from TEMPLATE):
`;
    for (const n of names)
      out += `  ${n}${" ".repeat(Math.max(0, 20 - n.length))}${T[n].description}
  ${" ".repeat(20)}e.g. ${T[n].usage}
`;
    process.stdout.write(out);
    return true;
  }
  if (argv[0] !== "add")
    return false;
  let name = "";
  let from = "";
  let project = false;
  const rest = argv.slice(1);
  for (let i = 0;i < rest.length; i++) {
    if (rest[i] === "--from")
      from = rest[++i] ?? "";
    else if (rest[i] === "--project")
      project = true;
    else if (rest[i].startsWith("-"))
      return die(`tasks add: unknown option ${rest[i]}`);
    else
      name = rest[i];
  }
  if (!name)
    return die("tasks add NAME [--from TEMPLATE] [--project]   (templates: offload tasks templates)");
  from ||= name;
  if (!TASK_NAME.test(name))
    return die("tasks add: a task name is lowercase letters, digits, - and _ (up to 40)");
  if (!names.includes(from))
    return die(`tasks add: no template "${from}" (offload tasks templates lists them)`);
  const { readConfigFile, writeConfigFile } = await import("./chunk-2m1sdmyv.js");
  const { projectConfigPath, userConfigPath } = await import("./chunk-5fzas80d.js");
  const target = project ? projectConfigPath() : userConfigPath();
  const cur = readConfigFile(target);
  if (cur.tasks?.[name] != null)
    return die(`tasks add: ${name} already exists in ${target}`);
  const { description, prompt, tools } = T[from];
  writeConfigFile(target, { ...cur, tasks: { ...cur.tasks ?? {}, [name]: { description, prompt, tools } } });
  process.stdout.write(`added task ${name} (from ${from}) to ${target}
run it: ${String(T[from].usage).replace(`task ${from}`, `task ${name}`)}
`);
  return true;
}
async function cmdTasks2(argv = []) {
  if (await tasksTemplates(argv))
    return;
  const names = taskNames();
  if (!names.length) {
    process.stdout.write(`No custom tasks yet. Start from a template (offload tasks templates), for example:
  offload tasks add review-diff
or write your own:
  offload config set tasks.review-sql '{"description":"Find N+1 queries","prompt":"You review SQL access code for N+1 queries.","tools":"none"}'
then: offload task review-sql src/db/
`);
    return;
  }
  let out = `Custom tasks (offload task NAME [-q QUESTION] [PATH...]):
`;
  for (const n of names) {
    const d = taskDef(n);
    out += `  ${n.padEnd(20)} ${d?.description ?? ""}  [${d?.tools ?? "none"} · ${d?.model || "default model"}]
`;
  }
  process.stdout.write(out);
}
async function cmdTask2(argv) {
  const name = argv[0] ?? "";
  if (!name || name === "--list" || name === "-l")
    return cmdTasks2();
  if (!/^[a-z0-9_-]+$/.test(name) || name.startsWith("-"))
    die(`task: names use lowercase letters, digits, - and _ (${name})`);
  if (!TASK_NAME.test(name))
    die(`task: names are at most 40 characters (${name})`);
  const def = taskDef(name);
  if (!def)
    die(`task: no task named ${name} (offload tasks lists them)`);
  const { opts, rest } = parseFlags(argv.slice(1), { question: { alias: ["-q"], value: true }, model: { alias: ["-m"], value: true }, stdin: {} });
  let system;
  try {
    system = taskSystem(def);
  } catch (e) {
    return die(e.message);
  }
  setTaskContext({ name, system, model: def.model || undefined });
  try {
    let question = str(opts.question) || "Do the task described in your instructions.";
    const m = str(opts.model) ? ["-m", str(opts.model)] : [];
    if (def.tools === "read") {
      if (rest.length)
        question += ` (start with: ${rest.join(" ")})`;
      await cmdExplore2([...m, "--", question]);
    } else if (rest.length)
      await cmdRead2([...m, "-q", question, "--", ...rest]);
    else
      await cmdAsk2([...m, ...opts.stdin ? ["--stdin"] : [], "--", question]);
  } finally {
    setTaskContext(undefined);
  }
}

export { cmdRead2, cmdExplore2, cmdRun2, cmdSummarize2, cmdWrite2, cmdAsk2, cmdOutline2, cmdTasks2, cmdTask2 };
