import { redact } from "./secrets.ts";
import { PROMPTS, Task } from "./assets.ts";
import { cfgInt, cfgList, cfgStr } from "./config.ts";
import { backendFor, parseRef } from "./backends/registry.ts";
import { E, WorkerError, WorkerResult } from "./backends/types.ts";
import { coolDown, cooling } from "./state.ts";

export interface InvokeResult extends WorkerResult {
  model: string;
  seconds: number;
  /** "fell back after A (quota), B (cooling down)" when earlier models in the chain didn't answer. */
  fallback?: string;
}

export function modelFor(task: Task): string {
  return cfgStr(`models.${task}`) || cfgStr("models.default");
}

/** The task's model then models.fallback; an explicit override (-m) is used alone.
 * A custom task's own model (primary) comes before the task's configured one. */
export function modelChain(task: Task, override?: string, primary?: string): string[] {
  if (override) return [override];
  const first = primary || modelFor(task) || "@default";
  return [...new Set([first, ...cfgList("models.fallback")].filter(Boolean))];
}

/**
 * Runs a task on the first model of the chain that works, cooling down models
 * that hit quota (5 min), auth (30 min) or unknown-model (1 h) errors.
 */
export interface InvokeOptions {
  /** Total time budget across the whole fallback chain (hooks have host timeouts). */
  budgetSec?: number;
  /** A custom task's instructions instead of the built-in prompt. */
  system?: string;
  /** A custom task's own model, tried first. */
  primary?: string;
}

export async function invoke(task: Task, prompt: string, cwd: string, override?: string, opts: InvokeOptions = {}): Promise<InvokeResult> {
  const variant = cfgStr(`variants.${task}`);
  const perModel = cfgInt("opencode.timeout_seconds", 180);
  const deadline = opts.budgetSec ? Date.now() + opts.budgetSec * 1000 : Infinity;
  const errors: string[] = [];
  // each model skipped or failed, in a few words: the footer of the answer says why it fell back
  const skipped: string[] = [];
  const why = (code: number) => ({ [E.QUOTA]: "quota", [E.AUTH]: "login", [E.MODEL]: "unknown model", [E.TIMEOUT]: "timeout", [E.TOO_LARGE]: "too large", [E.USAGE]: "not set up", [E.MISSING]: "not installed" } as Record<number, string>)[code] ?? "error";
  let tried = 0;
  let lastCode: number = E.WORKER;
  for (const raw of modelChain(task, override, opts.primary)) {
    let ref = raw;
    let parsed;
    try {
      parsed = parseRef(raw);
      if (raw === "@host" || raw === "@self" || raw === "@host-api") ref = parsed.ref;
    } catch (e) {
      errors.push(`  - ${raw}: ${(e as Error).message}`);
      lastCode = E.USAGE;
      skipped.push(`${raw} (not set up)`);
      continue;
    }
    if (!override) {
      const c = cooling(ref);
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
        maxSteps: cfgInt("explore.max_steps", 40),
        secretGlobs: cfgList("privacy.secret_globs"),
      allowGlobs: cfgList("privacy.secret_allow_globs"),
      });
      // answers can quote what a worker read (an explore agent may have opened
      // .env); generated code is left alone (its fixtures are not secrets)
      const text = task === "write" ? r.text : redact(r.text);
      return { ...r, text, model: ref === "@default" ? `${backend}-default-model` : ref, seconds: Math.round((Date.now() - t0) / 1000), fallback: skipped.length ? `fell back after ${skipped.join(", ")}` : undefined };
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String((e as Error)?.message ?? e));
      lastCode = err.code;
      errors.push(`  - ${ref}: ${err.message}`);
      skipped.push(`${ref} (${why(err.code)})`);
      if (err.code === E.QUOTA) coolDown(ref, 300, "rate-limit/quota");
      else if (err.code === E.AUTH) coolDown(ref, 1800, "auth");
      else if (err.code === E.MODEL) coolDown(ref, 3600, "unknown-model");
      else if (err.code === E.MISSING && modelChain(task, override, opts.primary).length === 1) throw err;
    }
  }
  if (tried === 0 && lastCode !== E.USAGE && lastCode !== E.TIMEOUT) {
    throw new WorkerError(E.QUOTA, `every configured model is cooling down after errors:\n${errors.join("\n")}\n(\`offload doctor --reset\` clears cooldowns)`);
  }
  const hint = lastCode === E.TOO_LARGE ? "\n(the input is larger than the model can take: ask about fewer files or a range, path:START-END, or use a model with a bigger context window)" : "";
  throw new WorkerError(lastCode, `no model succeeded:\n${errors.join("\n")}${hint}`);
}
