// `offload worker` — transport-only entry point used by the bash engine for
// backends it does not implement natively. One model, no fallback chain (the
// caller owns chains and cooldowns). Prompt on stdin, answer on stdout, exit
// code = offload's error codes, and a final stderr line with usage.
import { PROMPTS, Task, TASKS } from "../assets.ts";
import { parseFlags, str } from "../args.ts";
import { cfgInt, cfgList, cfgStr } from "../config.ts";
import { backendFor, parseRef } from "../backends/registry.ts";
import { E, WorkerError } from "../backends/types.ts";
import { workDir } from "../state.ts";

export async function cmdWorker(argv: string[]): Promise<number> {
  const { opts } = parseFlags(argv, { task: { value: true }, cwd: { value: true }, model: { value: true }, variant: { value: true }, timeout: { value: true } });
  const task = str(opts.task) as Task;
  if (!TASKS.includes(task)) {
    process.stderr.write(`offload worker: --task must be one of ${TASKS.join(", ")}\n`);
    return E.USAGE;
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const { backend, model, ref } = parseRef(str(opts.model));
  const b = backendFor(backend);
  if (!b) {
    process.stderr.write(`offload worker: unknown backend "${backend}"\n`);
    return E.USAGE;
  }
  try {
    const r = await b.run({
      task,
      system: PROMPTS[task],
      prompt: Buffer.concat(chunks).toString("utf8"),
      model,
      variant: str(opts.variant) || cfgStr(`variants.${task}`) || undefined,
      cwd: str(opts.cwd) || workDir(),
      timeoutSec: Number(str(opts.timeout)) || cfgInt("opencode.timeout_seconds", 180),
      maxSteps: cfgInt("explore.max_steps", 40),
      secretGlobs: cfgList("privacy.secret_globs"),
      allowGlobs: cfgList("privacy.secret_allow_globs"),
    });
    process.stdout.write(r.text.replace(/\n?$/, "\n"));
    process.stderr.write(`OFFLOAD_WORKER ${JSON.stringify({ model: ref, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ctx_in: r.ctxIn, cost: r.cost })}\n`);
    return 0;
  } catch (e) {
    const w = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String((e as Error)?.message ?? e));
    process.stderr.write(`OFFLOAD_WORKER_ERROR ${JSON.stringify({ code: w.code, message: w.message })}\n`);
    return w.code;
  }
}
