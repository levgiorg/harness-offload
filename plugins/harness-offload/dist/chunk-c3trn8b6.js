import {
  PROMPTS
} from "./chunk-x0pmyrax.js";
import {
  cfgStr,
  cfgInt,
  cfgList,
  redact
} from "./chunk-pa508w83.js";
import {
  E,
  WorkerError,
  cooling2,
  coolDown2
} from "./chunk-g8k1ht2n.js";
import {
  parseRef,
  backendFor
} from "./chunk-p4e0skck.js";

// src/engine.ts
function modelFor(task) {
  return cfgStr(`models.${task}`) || cfgStr("models.default");
}
function modelChain2(task, override, primary) {
  if (override)
    return [override];
  const first = primary || modelFor(task) || "@default";
  return [...new Set([first, ...cfgList("models.fallback")].filter(Boolean))];
}
async function invoke2(task, prompt, cwd, override, opts = {}) {
  const variant = cfgStr(`variants.${task}`);
  const perModel = cfgInt("opencode.timeout_seconds", 180);
  const deadline = opts.budgetSec ? Date.now() + opts.budgetSec * 1000 : Infinity;
  const errors = [];
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
      continue;
    }
    if (!override) {
      const c = cooling2(ref);
      if (c) {
        errors.push(`  - ${ref}: skipped, cooling down (${c})`);
        continue;
      }
    }
    const { backend, model } = parsed;
    const b = backendFor(backend);
    if (!b) {
      errors.push(`  - ${ref}: unknown backend "${backend}"`);
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
        maxSteps: cfgInt("explore.max_steps", 40),
        secretGlobs: cfgList("privacy.secret_globs"),
        allowGlobs: cfgList("privacy.secret_allow_globs")
      });
      const text = task === "write" ? r.text : redact(r.text);
      return { ...r, text, model: ref === "@default" ? `${backend}-default-model` : ref, seconds: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String(e?.message ?? e));
      lastCode = err.code;
      errors.push(`  - ${ref}: ${err.message}`);
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
