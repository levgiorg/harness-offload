import { PROMPTS, Task } from "./assets.ts";
import { cfgInt, cfgList, cfgStr } from "./config.ts";
import { backendFor, parseRef } from "./backends/registry.ts";
import { E, WorkerError, WorkerResult } from "./backends/types.ts";
import { coolDown, cooling } from "./state.ts";

export interface InvokeResult extends WorkerResult {
  model: string;
  seconds: number;
}

export function modelFor(task: Task): string {
  return cfgStr(`models.${task}`) || cfgStr("models.default");
}

/** Primary model for the task, then models.fallback, de-duplicated. */
export function modelChain(task: Task, override?: string): string[] {
  const first = override || modelFor(task) || "@default";
  return [...new Set([first, ...cfgList("models.fallback")].filter(Boolean))];
}

/**
 * Runs a task on the first model of the chain that works, cooling down models
 * that hit quota (5 min), auth (30 min) or unknown-model (1 h) errors.
 */
export async function invoke(task: Task, prompt: string, cwd: string, override?: string): Promise<InvokeResult> {
  const variant = cfgStr(`variants.${task}`);
  const timeoutSec = cfgInt("opencode.timeout_seconds", 180);
  const errors: string[] = [];
  let tried = 0;
  let lastCode: number = E.WORKER;
  for (const ref of modelChain(task, override)) {
    if (!override) {
      const c = cooling(ref);
      if (c) {
        errors.push(`  - ${ref}: skipped, cooling down (${c})`);
        continue;
      }
    }
    const { backend, model } = parseRef(ref);
    const b = backendFor(backend);
    if (!b) {
      errors.push(`  - ${ref}: unknown backend "${backend}"`);
      lastCode = E.USAGE;
      continue;
    }
    tried++;
    const t0 = Date.now();
    try {
      const r = await b.run({
        task,
        system: PROMPTS[task],
        prompt,
        model,
        variant: variant || undefined,
        cwd,
        timeoutSec,
        maxSteps: cfgInt("explore.max_steps", 40),
        secretGlobs: cfgList("privacy.secret_globs"),
      });
      return { ...r, model: ref === "@default" ? `${backend}-default-model` : ref, seconds: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String((e as Error)?.message ?? e));
      lastCode = err.code;
      errors.push(`  - ${ref}: ${err.message}`);
      if (err.code === E.QUOTA) coolDown(ref, 300, "rate-limit/quota");
      else if (err.code === E.AUTH) coolDown(ref, 1800, "auth");
      else if (err.code === E.MODEL) coolDown(ref, 3600, "unknown-model");
      else if (err.code === E.MISSING && modelChain(task, override).length === 1) throw err;
    }
  }
  if (tried === 0 && lastCode !== E.USAGE) {
    throw new WorkerError(E.QUOTA, `every configured model is cooling down after errors:\n${errors.join("\n")}\n(\`offload doctor --reset\` clears cooldowns)`);
  }
  throw new WorkerError(lastCode, `no model succeeded:\n${errors.join("\n")}`);
}
