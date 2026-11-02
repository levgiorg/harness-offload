// Node built-ins that take milliseconds to load, loaded on first use. Hooks
// start on every tool call of the agent, and most of them never spawn a
// process or a worker thread.
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
let cp: typeof import("node:child_process") | undefined;
let wt: typeof import("node:worker_threads") | undefined;

export const childProcess = (): typeof import("node:child_process") => (cp ??= req("node:child_process"));
export const workerThreads = (): typeof import("node:worker_threads") => (wt ??= req("node:worker_threads"));
