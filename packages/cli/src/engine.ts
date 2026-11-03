import { redact } from "./secrets.ts";
import { PROMPTS, Task } from "./assets.ts";
import { cfgInt, cfgList, cfgStr } from "./config.ts";
import { backendFor, parseRef } from "./backends/registry.ts";
import { E, WorkerError, WorkerResult } from "./backends/types.ts";
import { coolDown, cooling, newLogPath } from "./state.ts";
import { fmtInt } from "./text.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface InvokeResult extends WorkerResult {
  model: string;
  seconds: number;
  /** "fell back after A (quota), B (cooling down)" when earlier models in the chain didn't answer. */
  fallback?: string;
  /** "answer cut at ~N tokens … full answer: LOG" when a runaway answer was cut. */
  cut?: string;
}

/** The length rule added to a prompt when answers.max_tokens.<task> is set. Twin: co_length_rule. */
export const lengthRule = (budget: number) =>
  `<length>Keep the answer under about ${fmtInt(budget)} tokens (roughly ${fmtInt(Math.floor((budget * 3) / 4))} words): the findings and their citations, no preamble or recap.</length>\n`;

/** An answer past twice its budget is cut after the last whole line that fits; the full answer
 *  goes to a log. A one-line answer is left whole. Twin: co_cut_answer. */
export function cutAnswer(text: string, task: string, budget: number): { text: string; cut?: string } {
  const limit = budget * 2 * 4;
  if (Buffer.byteLength(text) <= limit) return { text };
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let n = 0;
  const kept: string[] = [];
  for (const l of lines) {
    n += Buffer.byteLength(l) + 1;
    if (n > limit) break;
    kept.push(l);
  }
  if (!kept.length) return { text };
  const log = newLogPath(`answer ${task}`);
  try {
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, text);
  } catch {
    return { text };
  }
  return { text: kept.join("\n") + "\n", cut: `answer cut at ~${fmtInt(budget * 2)} tokens (asked for ${fmtInt(budget)}) · full answer: ${log}` };
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

/** Seconds per model attempt: timeouts.<task>, else opencode.timeout_seconds; OFFLOAD_TIMEOUT
 *  (a one-off) beats both. Twin: co_attempt_timeout. */
export function attemptTimeout(task: string): number {
  const t = !process.env.OFFLOAD_TIMEOUT && /^[a-z][a-z_-]*$/.test(task) ? cfgInt(`timeouts.${task}`, 0) : 0;
  return t > 0 ? t : cfgInt("opencode.timeout_seconds", 180);
}

export async function invoke(task: Task, prompt: string, cwd: string, override?: string, opts: InvokeOptions = {}): Promise<InvokeResult> {
  const variant = cfgStr(`variants.${task}`);
  // answers.max_tokens.<task>: the prompt asks for a short answer; a runaway is cut below
  const budget = task === "read" || task === "explore" || task === "ask" ? cfgInt(`answers.max_tokens.${task}`, 0) : 0;
  if (budget > 0) {
    // before the last <question> line, so the question stays last (else at the end)
    const lines = prompt.replace(/\n$/, "").split("\n");
    let q = -1;
    lines.forEach((l, i) => {
      if (l.startsWith("<question>")) q = i;
    });
    const rule = lengthRule(budget).replace(/\n$/, "");
    if (q >= 0) lines.splice(q, 0, rule);
    else lines.push(rule);
    prompt = lines.join("\n") + "\n";
  }
  const perModel = attemptTimeout(task);
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
      const c = budget > 0 ? cutAnswer(task === "write" ? r.text : redact(r.text), task, budget) : { text: task === "write" ? r.text : redact(r.text) };
      const text = c.text;
      return { ...r, text, cut: c.cut, model: ref === "@default" ? `${backend}-default-model` : ref, seconds: Math.round((Date.now() - t0) / 1000), fallback: skipped.length ? `fell back after ${skipped.join(", ")}` : undefined };
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
