// src/lazy.ts
import { createRequire } from "node:module";
var req = createRequire(import.meta.url);
var cp;
var wt;
var childProcess = () => cp ??= req("node:child_process");
var workerThreads = () => wt ??= req("node:worker_threads");

export { childProcess, workerThreads };
