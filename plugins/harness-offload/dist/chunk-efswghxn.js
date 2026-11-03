import {
  PROMPTS
} from "./chunk-yrbt2j5y.js";
import {
  cfgStr2,
  cfgInt2,
  cfgList2,
  redact
} from "./chunk-gh6zr0fa.js";
import {
  fmtInt
} from "./chunk-gwdfekfb.js";
import {
  E,
  WorkerError,
  newLogPath2,
  cooling2,
  coolDown2
} from "./chunk-xtyp4a5g.js";
import {
  parseRef,
  backendFor
} from "./chunk-spdrtbj8.js";

// src/engine.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var lengthRule = (budget) => `<length>Keep the answer under about ${fmtInt(budget)} tokens (roughly ${fmtInt(Math.floor(budget * 3 / 4))} words): the findings and their citations, no preamble or recap.</length>
`;
function cutAnswer(text, task, budget) {
  const limit = budget * 2 * 4;
  if (Buffer.byteLength(text) <= limit)
    return { text };
  const lines = text.split(`
`);
  if (lines[lines.length - 1] === "")
    lines.pop();
  let n = 0;
  const kept = [];
  for (const l of lines) {
    n += Buffer.byteLength(l) + 1;
    if (n > limit)
      break;
    kept.push(l);
  }
  if (!kept.length)
    return { text };
  const log = newLogPath2(`answer ${task}`);
  try {
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, text);
  } catch {
    return { text };
  }
  return { text: kept.join(`
`) + `
`, cut: `answer cut at ~${fmtInt(budget * 2)} tokens (asked for ${fmtInt(budget)}) · full answer: ${log}` };
}
function modelFor(task) {
  return cfgStr2(`models.${task}`) || cfgStr2("models.default");
}
function modelChain2(task, override, primary) {
  if (override)
    return [override];
  const first = primary || modelFor(task) || "@default";
  return [...new Set([first, ...cfgList2("models.fallback")].filter(Boolean))];
}
function attemptTimeout(task) {
  const t = !process.env.OFFLOAD_TIMEOUT && /^[a-z][a-z_-]*$/.test(task) ? cfgInt2(`timeouts.${task}`, 0) : 0;
  return t > 0 ? t : cfgInt2("opencode.timeout_seconds", 180);
}
async function invoke2(task, prompt, cwd, override, opts = {}) {
  const variant = cfgStr2(`variants.${task}`);
  const budget = task === "read" || task === "explore" || task === "ask" ? cfgInt2(`answers.max_tokens.${task}`, 0) : 0;
  if (budget > 0) {
    const lines = prompt.replace(/\n$/, "").split(`
`);
    let q = -1;
    lines.forEach((l, i) => {
      if (l.startsWith("<question>"))
        q = i;
    });
    const rule = lengthRule(budget).replace(/\n$/, "");
    if (q >= 0)
      lines.splice(q, 0, rule);
    else
      lines.push(rule);
    prompt = lines.join(`
`) + `
`;
  }
  const perModel = attemptTimeout(task);
  const deadline = opts.budgetSec ? Date.now() + opts.budgetSec * 1000 : Infinity;
  const errors = [];
  const skipped = [];
  const why = (code) => ({ [E.QUOTA]: "quota", [E.AUTH]: "login", [E.MODEL]: "unknown model", [E.TIMEOUT]: "timeout", [E.TOO_LARGE]: "too large", [E.USAGE]: "not set up", [E.MISSING]: "not installed" })[code] ?? "error";
  let tried = 0;
  let lastCode = E.WORKER;
  for (const raw of modelChain2(task, override, opts.primary)) {
    let ref = raw;
    let parsed;
    try {
      parsed = parseRef(raw);
      if (raw === "@host" || raw === "@self" || raw === "@host-api")
        ref = parsed.ref;
    } catch (e) {
      errors.push(`  - ${raw}: ${e.message}`);
      lastCode = E.USAGE;
      skipped.push(`${raw} (not set up)`);
      continue;
    }
    if (!override) {
      const c = cooling2(ref);
      if (c) {
        errors.push(`  - ${ref}: skipped, cooling down (${c})`);
        skipped.push(`${ref} (cooling down)`);
        continue;
      }
    }
    const { backend, model } = parsed;
    const b = backendFor(backend);
    if (!b) {
      errors.push(`  - ${ref}: unknown backend "${backend}"`);
      skipped.push(`${ref} (not set up)`);
      lastCode = E.USAGE;
      continue;
    }
    const left = Math.floor((deadline - Date.now()) / 1000);
    if (left < 3) {
      errors.push(`  - ${ref}: skipped, time budget used up`);
      lastCode = E.TIMEOUT;
      break;
    }
    const timeoutSec = Math.min(perModel, left);
    tried++;
    const t0 = Date.now();
    try {
      const r = await b.run({
        task,
        system: opts.system ?? PROMPTS[task],
        prompt,
        model,
        variant: variant || undefined,
        cwd,
        timeoutSec,
        maxSteps: cfgInt2("explore.max_steps", 40),
        secretGlobs: cfgList2("privacy.secret_globs"),
        allowGlobs: cfgList2("privacy.secret_allow_globs")
      });
      const c = budget > 0 ? cutAnswer(task === "write" ? r.text : redact(r.text), task, budget) : { text: task === "write" ? r.text : redact(r.text) };
      const text = c.text;
      return { ...r, text, cut: c.cut, model: ref === "@default" ? `${backend}-default-model` : ref, seconds: Math.round((Date.now() - t0) / 1000), fallback: skipped.length ? `fell back after ${skipped.join(", ")}` : undefined };
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String(e?.message ?? e));
      lastCode = err.code;
      errors.push(`  - ${ref}: ${err.message}`);
      skipped.push(`${ref} (${why(err.code)})`);
      if (err.code === E.QUOTA)
        coolDown2(ref, 300, "rate-limit/quota");
      else if (err.code === E.AUTH)
        coolDown2(ref, 1800, "auth");
      else if (err.code === E.MODEL)
        coolDown2(ref, 3600, "unknown-model");
      else if (err.code === E.MISSING && modelChain2(task, override, opts.primary).length === 1)
        throw err;
    }
  }
  if (tried === 0 && lastCode !== E.USAGE && lastCode !== E.TIMEOUT) {
    throw new WorkerError(E.QUOTA, `every configured model is cooling down after errors:
${errors.join(`
`)}
(\`offload doctor --reset\` clears cooldowns)`);
  }
  const hint = lastCode === E.TOO_LARGE ? `
(the input is larger than the model can take: ask about fewer files or a range, path:START-END, or use a model with a bigger context window)` : "";
  throw new WorkerError(lastCode, `no model succeeded:
${errors.join(`
`)}${hint}`);
}

export { modelChain2, invoke2 };
