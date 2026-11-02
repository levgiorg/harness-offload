#!/usr/bin/env node
// harness-offload entry. Node 22.1+ keeps compiled code in its on-disk cache
// (NODE_DISABLE_COMPILE_CACHE=1 turns that off), so hooks start faster.
import module from "node:module";
try {
  module.enableCompileCache?.();
} catch {}
await import("./main.js");
