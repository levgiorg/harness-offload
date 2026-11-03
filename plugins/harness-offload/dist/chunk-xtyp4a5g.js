import {
  PROMPTS,
  runProcess2,
  spawnDetached2,
  which2
} from "./chunk-yrbt2j5y.js";
import {
  stateHome2,
  cfgStr2,
  cfgInt2,
  cfgBool2,
  cfgList2,
  redact
} from "./chunk-gh6zr0fa.js";

// src/backends/types.ts
var E = {
  USAGE: 2,
  QUOTA: 10,
  AUTH: 11,
  TIMEOUT: 12,
  MODEL: 13,
  WORKER: 14,
  MISSING: 15,
  REFUSED: 16,
  TOO_LARGE: 17
};

class WorkerError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function classify(message) {
  const m = message.toLowerCase();
  if (/prompt is too long|input is too long|input too long|context.length|maximum context|context window|too many (input )?tokens|exceeds? the (model.s )?(maximum )?(context|token)|request too large|payload too large/.test(m))
    return E.TOO_LARGE;
  if (/provider\.(rate-limit|quota|free-limit|go-limit|overloaded)|usage limit|rate limit|rate_limit|quota|too many requests|\b429\b|overloaded|limit reached|insufficient|credit/.test(m))
    return E.QUOTA;
  if (/provider\.auth|api key|api_key|unauthori[sz]ed|\b401\b|\b403\b|forbidden|not authenticated|log ?in|authenticat|auth type|auth method|security token|invalid token|token expired|expired token|no providers? configured/.test(m))
    return E.AUTH;
  if (/provider\.no-route|model unavailable|model not found|unknown model|provider not found|providermodelnotfound|model_not_found|does not exist/.test(m))
    return E.MODEL;
  if (/provider\.timeout|timed out/.test(m))
    return E.TIMEOUT;
  return E.WORKER;
}

// src/backends/opencode.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync as statSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/state.ts
import { appendFileSync, chmodSync, closeSync, existsSync, openSync, readSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
function stateDir2() {
  const d = cfgStr2("state_dir") || join(stateHome2(), "harness-offload");
  for (const sub of ["logs", "cooldowns", "work"])
    mkdirSync(join(d, sub), { recursive: true });
  if (!existsSync(join(d, ".private"))) {
    try {
      chmodSync(d, 448);
      writeFileSync(join(d, ".private"), "");
    } catch {}
  }
  return d;
}
var workDir2 = () => join(stateDir2(), "work");
function appendStats2(row) {
  try {
    appendFileSync(join(stateDir2(), "stats.jsonl"), JSON.stringify({ ts: Math.floor(Date.now() / 1000), ...row }) + `
`);
  } catch {}
}
function readStats2() {
  const f = join(stateDir2(), "stats.jsonl");
  if (!existsSync(f))
    return [];
  return readFileSync(f, "utf8").split(`
`).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
function slug(s) {
  return s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").slice(0, 40).replace(/-+$/, "");
}
function newLogPath2(label) {
  const d = new Date;
  const p = (n) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return join(stateDir2(), "logs", `${ts}-${slug(redact(label))}-${process.pid}.log`);
}
function pruneLogs2() {
  const days = cfgInt2("log_retention_days", 7);
  const dir = join(stateDir2(), "logs");
  const cutoff = Date.now() - days * 86400000;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.endsWith(".log") && statSync(p).mtimeMs < cutoff)
        rmSync(p, { force: true });
    }
  } catch {}
  try {
    const seen = join(stateDir2(), "seen");
    for (const f of readdirSync(seen)) {
      const p = join(seen, f);
      if (statSync(p).mtimeMs < Date.now() - 120 * 60000)
        rmSync(p, { force: true });
    }
  } catch {}
}
var CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0;i < 256; i++) {
    let c = i << 24;
    for (let k = 0;k < 8; k++)
      c = c & 2147483648 ? c << 1 ^ 79764919 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function cksum2(src) {
  let crc = 0;
  const step = (b) => crc = (crc << 8 ^ CRC[(crc >>> 24 ^ b) & 255]) >>> 0;
  let len = 0;
  if (Buffer.isBuffer(src)) {
    for (const b of src)
      step(b);
    len = src.length;
  } else {
    const fd = openSync(src.file, "r");
    const buf = Buffer.alloc(1 << 20);
    try {
      for (let n;(n = readSync(fd, buf, 0, buf.length, null)) > 0; len += n)
        for (let i = 0;i < n; i++)
          step(buf[i]);
    } finally {
      closeSync(fd);
    }
  }
  for (let n = len;n > 0; n = Math.floor(n / 256))
    step(n & 255);
  return `${~crc >>> 0}-${len}`;
}
function sameFile2(a, b) {
  if (statSync(a).size !== statSync(b).size)
    return false;
  const fa = openSync(a, "r");
  const fb = openSync(b, "r");
  const ba = Buffer.alloc(1 << 20);
  const bb = Buffer.alloc(1 << 20);
  try {
    for (;; ) {
      const na = readSync(fa, ba, 0, ba.length, null);
      const nb = readSync(fb, bb, 0, bb.length, null);
      if (na !== nb || !ba.subarray(0, na).equals(bb.subarray(0, nb)))
        return false;
      if (na === 0)
        return true;
    }
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}
var seenSession = (s) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
var seenFile2 = (session, output) => join(stateDir2(), "seen", `${seenSession(session)}-${cksum2(output)}`);
var seenCmdFile2 = (session, cmd) => join(stateDir2(), "seen", `${seenSession(session)}-cmd-${cksum2(Buffer.from(cmd))}`);
function compactIndex2(session) {
  if (!session)
    return "";
  const prefix = `${seenSession(session)}-cmd-`;
  const rows = [];
  try {
    for (const f of readdirSync(join(stateDir2(), "seen"))) {
      if (!f.startsWith(prefix))
        continue;
      const m = /^(\d+) (\S+) (.*)$/.exec(readFileSync(join(stateDir2(), "seen", f), "utf8").replace(/\n$/, ""));
      if (m)
        rows.push({ at: Number(m[1]), hms: m[2], log: m[3] });
    }
  } catch {
    return "";
  }
  rows.sort((a, b) => b.at - a.at || Buffer.compare(Buffer.from(a.log), Buffer.from(b.log)));
  const head = "Before the compaction, offload digested these outputs (full logs kept; offload summarize LOG digests one again):";
  let n = Buffer.byteLength(head);
  let out = "";
  for (const r of rows) {
    if (!r.log || !existsSync(r.log))
      continue;
    const name = basename(r.log).replace(/^.{8}-.{6}-/, "").replace(/-[^-]*\.log$/, "");
    const line = `  ${r.hms} ${name} → ${r.log}`;
    const len = Buffer.byteLength(line);
    if (n + 1 + len > 600)
      break;
    out += `
${line}`;
    n += 1 + len;
  }
  return out ? head + out : "";
}
function seenForget2(session) {
  if (!session)
    return;
  const prefix = `${seenSession(session)}-`;
  try {
    for (const f of readdirSync(join(stateDir2(), "seen")))
      if (f.startsWith(prefix))
        rmSync(join(stateDir2(), "seen", f), { force: true });
  } catch {}
}
var cooldownFile = (model) => join(stateDir2(), "cooldowns", model.replace(/[^A-Za-z0-9._-]/g, "_"));
function cooling2(model) {
  const f = cooldownFile(model);
  if (!existsSync(f))
    return;
  const [until, ...reason] = readFileSync(f, "utf8").trim().split(" ");
  const u = Number(until);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(u) || u <= now) {
    rmSync(f, { force: true });
    return;
  }
  return `${reason.join(" ") || "error"}, ${u - now}s left`;
}
function coolDown2(model, seconds, reason) {
  try {
    writeFileSync(cooldownFile(model), `${Math.floor(Date.now() / 1000) + seconds} ${reason}
`);
  } catch {}
}
function listCooldowns2() {
  const dir = join(stateDir2(), "cooldowns");
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const f of readdirSync(dir)) {
    try {
      const [until, ...reason] = readFileSync(join(dir, f), "utf8").trim().split(" ");
      const u = Number(until);
      if (Number.isFinite(u) && u > now)
        out.push({ model: f, until: u, reason: reason.join(" ") || "error" });
    } catch {}
  }
  return out.sort((a, b) => a.until - b.until);
}
function clearCooldowns2() {
  const dir = join(stateDir2(), "cooldowns");
  for (const f of readdirSync(dir))
    rmSync(join(dir, f), { force: true });
}

// src/backends/opencode.ts
var bin = () => cfgStr2("opencode.bin", "opencode");
var majorCache;
async function opencodeMajor() {
  if (majorCache)
    return majorCache;
  const b = bin();
  const cache = join2(stateDir2(), "opencode-version");
  try {
    if (existsSync2(cache) && Date.now() - statSync2(cache).mtimeMs < 3600000) {
      const [maj, cbin] = readFileSync2(cache, "utf8").trim().split(" ");
      if (cbin === b && /^\d+$/.test(maj))
        return majorCache = Number(maj);
    }
  } catch {}
  const r = await runProcess2(b, ["--version"], { timeoutMs: 15000 });
  const m = (r.stdout.trim().split(`
`).pop() || "").match(/(\d+)\./);
  const major = m ? Number(m[1]) : 1;
  if (m) {
    try {
      writeFileSync2(cache, `${major} ${b}
`);
    } catch {}
  }
  return majorCache = major;
}
function resetOpencodeMajor() {
  majorCache = undefined;
}
function opencodeConfig(major, overrides = {}) {
  const P = { ...PROMPTS, ...overrides };
  let user = {};
  try {
    const v = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
    if (v && typeof v === "object" && !Array.isArray(v))
      user = v;
  } catch {}
  const steps = cfgInt2("explore.max_steps", 40);
  const secrets = cfgList2("privacy.secret_globs").flatMap((g) => [g, "**/" + g]);
  const merge = (a, b) => {
    if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) || Array.isArray(b))
      return b;
    const out = { ...a };
    for (const [k, v] of Object.entries(b))
      out[k] = k in out ? merge(out[k], v) : v;
    return out;
  };
  if (major >= 2) {
    const v2 = (name, system) => ({
      mode: "primary",
      hidden: true,
      description: name,
      system,
      permissions: [{ action: "*", resource: "*", effect: "deny" }]
    });
    const explore = v2("offload read-only explorer", P.explore);
    explore.steps = steps;
    explore.permissions.push(...["read", "grep", "glob"].map((action) => ({ action, resource: "*", effect: "allow" })));
    explore.permissions.push(...secrets.map((resource) => ({ action: "read", resource, effect: "deny" })));
    return merge(user, {
      snapshots: false,
      agents: {
        "offload-read": v2("offload bulk reader", P.read),
        "offload-summarize": v2("offload output digester", P.summarize),
        "offload-write": v2("offload code writer", P.write),
        "offload-ask": v2("offload one-shot helper", P.ask),
        "offload-explore": explore
      }
    });
  }
  const v1 = (name, prompt, temperature) => ({ mode: "primary", description: name, prompt, temperature, permission: { "*": "deny" } });
  const explore = v1("offload read-only explorer", P.explore, 0.1);
  explore.steps = steps;
  explore.permission = { "*": "deny", read: { "*": "allow", ...Object.fromEntries(secrets.map((g) => [g, "deny"])) }, grep: "allow", glob: "allow", list: "allow" };
  return merge(user, {
    snapshot: false,
    agent: {
      "offload-read": v1("offload bulk reader", P.read, 0.1),
      "offload-summarize": v1("offload output digester", P.summarize, 0.1),
      "offload-write": v1("offload code writer", P.write, 0.2),
      "offload-ask": v1("offload one-shot helper", P.ask, 0.3),
      "offload-explore": explore
    }
  });
}
function parseEvents(stdout) {
  return stdout.split(`
`).flatMap((l) => {
    if (!l.trim())
      return [];
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
function finalText(events) {
  const steps = [];
  let cur = "";
  for (const e of events) {
    if (e.type === "step_start") {
      steps.push(cur);
      cur = "";
    } else if (e.type === "text")
      cur += e.part?.text ?? "";
  }
  steps.push(cur);
  return steps.filter((s) => /\S/.test(s)).pop() ?? "";
}
function retries(stdout, stderr) {
  const v1 = (stderr.match(/stream error/g) || []).length;
  if (v1 > 0)
    return v1;
  let open = false;
  let r = 0;
  for (const m of stdout.matchAll(/^\{"type":"(step_start|step_finish)"/gm)) {
    if (m[1] === "step_start") {
      if (open)
        r++;
      open = true;
    } else
      open = false;
  }
  return r;
}
function forgetSession(sid, major) {
  if (!sid || cfgBool2("opencode.keep_sessions", false))
    return;
  const args = major >= 2 ? ["session", "delete", "--standalone", sid] : ["session", "delete", sid];
  spawnDetached2(bin(), args, stateDir2());
}

class OpencodeBackend {
  kind = "opencode";
  label = "OpenCode CLI";
  async available() {
    const p = await which2(bin());
    if (!p)
      return { ok: false, detail: `opencode not found (${bin()}) — https://opencode.ai` };
    return { ok: true, detail: `${p} (v${await opencodeMajor()})` };
  }
  async models() {
    const r = await runProcess2(bin(), ["models"], { timeoutMs: 60000 });
    return r.stdout.split(`
`).map((s) => s.trim()).filter((s) => /^[\w.-]+\/\S+$/.test(s));
  }
  async run(req) {
    if (!await which2(bin()))
      throw new WorkerError(E.MISSING, `opencode CLI not found (${bin()}). Install it from https://opencode.ai, or set opencode.bin in the config.`);
    const major = await opencodeMajor();
    const agent = `offload-${req.task}`;
    const args = ["run", "--format", "json", "--agent", agent, "--title", `offload:${req.task}`];
    if (major >= 2) {
      args.push("--standalone");
      if (req.model)
        args.push("-m", req.variant ? `${req.model}#${req.variant}` : req.model);
    } else {
      args.push("--print-logs", "--log-level", "ERROR");
      if (req.model)
        args.push("-m", req.model);
      if (req.variant)
        args.push("--variant", req.variant);
    }
    const env = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(major, req.system !== PROMPTS[req.task] ? { [req.task]: req.system } : {})),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OFFLOAD_DISABLE: "1",
      PWD: req.cwd
    };
    if (cfgBool2("opencode.disable_claude_code_compat", true))
      env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
    const maxErr = cfgInt2("opencode.max_stream_errors", 2);
    const r = await runProcess2(bin(), args, {
      input: req.prompt,
      cwd: req.cwd,
      env,
      timeoutMs: req.timeoutSec * 1000,
      watchdog: (out, err) => retries(out, err) >= maxErr ? "retries" : undefined
    });
    const events = parseEvents(r.stdout);
    const sid = events.find((e) => e.sessionID)?.sessionID || (r.stderr.match(/session\.id=(ses_[A-Za-z0-9]+)/) || [])[1];
    forgetSession(sid, major);
    if (r.timedOut)
      throw new WorkerError(E.TIMEOUT, `timed out after ${req.timeoutSec}s`);
    if (r.killedBy === "retries") {
      const msg = (r.stderr.match(/error\.error="([^"]*)"/g) || []).pop()?.replace(/^error\.error="|"$/g, "");
      const why = `provider kept failing and retrying (${retries(r.stdout, r.stderr)} retries): ${msg || "likely rate limit, quota or overload"}`;
      throw new WorkerError(classify(msg || "rate limit"), why);
    }
    const err = events.filter((e) => e.type === "error").pop();
    if (err || r.code !== 0) {
      let msg = err ? `${err.error?.type ?? err.error?.name ?? "error"}: ${err.error?.message ?? err.error?.data?.message ?? JSON.stringify(err.error)}` : "";
      if (!msg)
        msg = (r.stderr.match(/level=ERROR.*error="([^"]*)"/) || [])[1] || r.stderr.split(`
`).filter((l) => !l.startsWith("timestamp=")).join(`
`).slice(-400);
      if (/nknown argument|nknown option|nknown flag|nrecognized/.test(msg)) {
        resetOpencodeMajor();
        try {
          writeFileSync2(join2(stateDir2(), "opencode-version"), "");
        } catch {}
        msg += " (opencode version changed? cleared the cache — run again)";
      }
      if (/Unexpected server error/.test(msg))
        throw new WorkerError(E.MODEL, `${msg} (V1 reports unknown model ids this way — check \`opencode models\`)`);
      if (/Agent not found/.test(msg))
        throw new WorkerError(E.WORKER, `${msg} (opencode ignored offload's agent config — run \`offload doctor\`)`);
      const status = r.signal ? `was killed by ${r.signal}` : `exited with status ${r.code}`;
      throw new WorkerError(classify(msg || `exit ${r.code}`), msg || `opencode ${status}`);
    }
    const text = finalText(events);
    if (!text)
      throw new WorkerError(E.WORKER, "worker returned an empty answer");
    const fin = events.filter((e) => e.type === "step_finish").map((e) => e.part ?? {});
    const last = fin[fin.length - 1];
    return {
      text,
      tokensIn: fin.reduce((s, p) => s + (p.tokens?.input ?? 0), 0),
      tokensOut: fin.reduce((s, p) => s + (p.tokens?.output ?? 0), 0),
      ctxIn: last ? (last.tokens?.input ?? 0) + (last.tokens?.cache?.read ?? 0) : 0,
      cost: fin.reduce((s, p) => s + (p.cost ?? 0), 0)
    };
  }
}

export { E, WorkerError, classify, stateDir2, workDir2, appendStats2, readStats2, newLogPath2, pruneLogs2, cksum2, sameFile2, seenFile2, seenCmdFile2, compactIndex2, seenForget2, cooling2, coolDown2, listCooldowns2, clearCooldowns2, opencodeMajor, opencodeConfig, OpencodeBackend };
