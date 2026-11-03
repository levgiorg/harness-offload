// Bundles the CLI for Node. Shared assets are inlined.
//   dist/cli.js       tiny entry: turns on Node's compile cache, then loads main.js
//   dist/main.js      the CLI, split into chunks so a hook (run on every tool
//   dist/chunk-*.js   call) loads only what it needs, not the MCP SDK, the
//                     setup wizard or the report page
export {};
const { chmodSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, readdirSync } = await import("node:fs");
const { resolve } = await import("node:path");
// Absolute paths: Bun on Windows rejects rmSync on "../.."-relative directories (EINVAL).
const pkgDir = resolve(import.meta.dir, "..");
const repoDir = resolve(pkgDir, "..", "..");
// The committed plugin dist must be what this Bun produces: CI rebuilds it with the pinned
// version and fails on any difference, so a build with another Bun is flagged here.
const pinned = readFileSync(resolve(pkgDir, ".bun-version"), "utf8").trim();
if (Bun.version !== pinned)
  console.warn(`warning: building with Bun ${Bun.version}; the committed dist is built with Bun ${pinned} (packages/cli/.bun-version). Use that version, or CI's reproducibility check will fail.`);
mkdirSync("dist", { recursive: true });
for (const f of readdirSync("dist")) if (/^(chunk-.*|main)\.js$/.test(f)) rmSync(`dist/${f}`);
const res = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  minify: false,
  splitting: true,
  naming: { entry: "main.js", chunk: "chunk-[hash].js" },
});
// dist/hook.cjs: the hook path alone, CommonJS (see src/hook-main.ts). Bun
// would inline import.meta.url as the build machine's path, so it is defined
// from __filename at run time instead.
const resHook = await Bun.build({
  entrypoints: ["src/hook-main.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  naming: "hook.cjs",
  define: { "import.meta.url": "__offload_module_url" },
  banner: 'const __offload_module_url = require("node:url").pathToFileURL(__filename).href;',
});
if (!resHook.success) {
  for (const l of resHook.logs) console.error(l);
  process.exit(1);
}
if (/file:\/\/\/|\/home\/|\/Users\//.test(readFileSync("dist/hook.cjs", "utf8").replace(/^.*__offload_module_url.*$/m, ""))) {
  console.error("dist/hook.cjs embeds a build-machine path");
  process.exit(1);
}
// Host integrations loaded in-process by pi (Node), OpenCode and Amp (Bun).
const res2 = await Bun.build({
  entrypoints: ["src/integrations/pi.ts", "src/integrations/opencode.ts", "src/integrations/amp.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  naming: "[name].js",
  external: ["typebox", "@earendil-works/*"],
});
for (const r of [res, res2]) {
  if (!r.success) {
    for (const l of r.logs) console.error(l);
    process.exit(1);
  }
}
// Bun keeps the source shebang; main.js is not run directly, so drop it.
writeFileSync("dist/main.js", readFileSync("dist/main.js", "utf8").replace(/^(#!.*\n)+/, ""));
writeFileSync(
  "dist/cli.js",
  `#!/usr/bin/env node
// harness-offload entry. Node 22.1+ keeps compiled code in its on-disk cache
// (NODE_DISABLE_COMPILE_CACHE=1 turns that off), so hooks start faster.
import module from "node:module";
try {
  module.enableCompileCache?.();
} catch {}
await import("./main.js");
`,
);
chmodSync("dist/cli.js", 0o755);
const cliFiles = readdirSync("dist").filter((f) => f === "cli.js" || f === "main.js" || f === "hook.cjs" || /^chunk-.*\.js$/.test(f));
// dist/offload-node: a bash launcher used by the conformance suite.
const { copyFileSync } = await import("node:fs");
copyFileSync("scripts/node-wrapper.sh", "dist/offload-node");
chmodSync("dist/offload-node", 0o755);
// plugins/harness-offload/dist: the same bundles inside the plugin, so a
// marketplace/zip install of the plugin never needs a build or npm (Codex and
// Cursor copy plugins into caches; hooks and MCP find ./dist/cli.js there).
{
  const { sourceHash } = await import("./source-hash.mjs");
  const pdist = resolve(repoDir, "plugins/harness-offload/dist");
  rmSync(pdist, { recursive: true, force: true });
  mkdirSync(pdist, { recursive: true });
  for (const f of [...cliFiles, "pi.js", "opencode.js", "amp.js"]) cpSync(`dist/${f}`, `${pdist}/${f}`);
  chmodSync(`${pdist}/cli.js`, 0o755);
  // ESM, said up front: Node then skips guessing the format of every file
  // (and Node 18 / early 20 would otherwise refuse to load them at all)
  writeFileSync(`${pdist}/package.json`, `{ "type": "module" }\n`);
  writeFileSync(`${pdist}/SOURCE_HASH`, sourceHash() + "\n");
}
// assets/marketplace: the Claude-format marketplace (plugin + host files) that
// `offload install` registers with Claude Code, Codex, Cursor, Gemini, Devin.
const market = resolve(pkgDir, "assets/marketplace");
rmSync(market, { recursive: true, force: true });
mkdirSync(`${market}/.claude-plugin`, { recursive: true });
cpSync(resolve(repoDir, ".claude-plugin/marketplace.json"), `${market}/.claude-plugin/marketplace.json`);
cpSync(resolve(repoDir, "plugins/harness-offload"), `${market}/plugins/harness-offload`, {
  recursive: true,
  filter: (p) => !/[\\/]tests([\\/]|$)/.test(p),
});
console.log("built dist/cli.js, dist/pi.js, dist/opencode.js, plugins/harness-offload/dist, assets/marketplace");
