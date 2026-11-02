import {
  TASKS,
  PROMPTS,
  parseFlags,
  str
} from "./chunk-25ca7170.js";
import {
  cfgStr,
  cfgInt,
  cfgList
} from "./chunk-djerf2vs.js";
import"./chunk-5at3kbd8.js";
import {
  E,
  WorkerError,
  workDir2
} from "./chunk-d1jn8t5x.js";
import {
  parseRef,
  backendFor
} from "./chunk-e1kbmva9.js";

// src/commands/worker.ts
import { readFileSync } from "node:fs";
async function cmdWorker(argv) {
  const { opts } = parseFlags(argv, { task: { value: true }, cwd: { value: true }, model: { value: true }, variant: { value: true }, timeout: { value: true }, "system-file": { value: true } });
  const task = str(opts.task);
  if (!TASKS.includes(task)) {
    process.stderr.write(`offload worker: --task must be one of ${TASKS.join(", ")}
`);
    return E.USAGE;
  }
  let system = PROMPTS[task];
  const sysFile = str(opts["system-file"]);
  if (sysFile) {
    try {
      system = readFileSync(sysFile, "utf8");
    } catch (e) {
      process.stderr.write(`offload worker: cannot read --system-file: ${e.message}
`);
      return E.USAGE;
    }
  }
  const chunks = [];
  for await (const c of process.stdin)
    chunks.push(c);
  const { backend, model, ref } = parseRef(str(opts.model));
  const b = backendFor(backend);
  if (!b) {
    process.stderr.write(`offload worker: unknown backend "${backend}"
`);
    return E.USAGE;
  }
  try {
    const r = await b.run({
      task,
      system,
      prompt: Buffer.concat(chunks).toString("utf8"),
      model,
      variant: str(opts.variant) || cfgStr(`variants.${task}`) || undefined,
      cwd: str(opts.cwd) || workDir2(),
      timeoutSec: Number(str(opts.timeout)) || cfgInt("opencode.timeout_seconds", 180),
      maxSteps: cfgInt("explore.max_steps", 40),
      secretGlobs: cfgList("privacy.secret_globs"),
      allowGlobs: cfgList("privacy.secret_allow_globs")
    });
    process.stdout.write(r.text.replace(/\n?$/, `
`));
    process.stderr.write(`OFFLOAD_WORKER ${JSON.stringify({ model: ref, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ctx_in: r.ctxIn, cost: r.cost })}
`);
    return 0;
  } catch (e) {
    const w = e instanceof WorkerError ? e : new WorkerError(E.WORKER, String(e?.message ?? e));
    process.stderr.write(`OFFLOAD_WORKER_ERROR ${JSON.stringify({ code: w.code, message: w.message })}
`);
    return w.code;
  }
}
export {
  cmdWorker
};
