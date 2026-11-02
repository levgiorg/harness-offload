// Entry of dist/hook.cjs: only the hook path, as one CommonJS file. Hooks run
// before and after every tool call of the agent; Node loads a CommonJS file
// without its ESM loader, which saves ~10 ms per call over dist/cli.js.
//   node dist/hook.cjs [hook] HOST EVENT   (stdin: the host's hook JSON)
import { cmdHook } from "./commands/hook.ts";

const argv = process.argv.slice(2);
if (argv[0] === "hook") argv.shift();
cmdHook(argv).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 0; // hooks fail open
  },
);
