// Bundles the CLI for Node (dist/cli.js). Shared assets are inlined.
export {};
const res = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  minify: false,
  naming: "cli.js",
  banner: "#!/usr/bin/env node",
});
// Host integrations loaded in-process by pi (Node) and OpenCode (Bun).
const res2 = await Bun.build({
  entrypoints: ["src/integrations/pi.ts", "src/integrations/opencode.ts"],
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
const { chmodSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } = await import("node:fs");
// Bun keeps the source shebang too; make sure there is exactly one.
const out = readFileSync("dist/cli.js", "utf8").replace(/^(#!.*\n)+/, "#!/usr/bin/env node\n");
writeFileSync("dist/cli.js", out);
chmodSync("dist/cli.js", 0o755);
// dist/offload-node: a bash launcher used by the conformance suite.
const { copyFileSync } = await import("node:fs");
copyFileSync("scripts/node-wrapper.sh", "dist/offload-node");
chmodSync("dist/offload-node", 0o755);
// plugins/harness-offload/dist: the same bundles inside the plugin, so a
// marketplace/zip install of the plugin never needs a build or npm (Codex and
// Cursor copy plugins into caches; hooks and MCP find ./dist/cli.js there).
{
  const { sourceHash } = await import("./source-hash.mjs");
  const pdist = "../../plugins/harness-offload/dist";
  rmSync(pdist, { recursive: true, force: true });
  mkdirSync(pdist, { recursive: true });
  for (const f of ["cli.js", "pi.js", "opencode.js"]) cpSync(`dist/${f}`, `${pdist}/${f}`);
  chmodSync(`${pdist}/cli.js`, 0o755);
  writeFileSync(`${pdist}/SOURCE_HASH`, sourceHash() + "\n");
}
// assets/marketplace: the Claude-format marketplace (plugin + host files) that
// `offload install` registers with Claude Code, Codex, Cursor, Gemini, Devin.
rmSync("assets/marketplace", { recursive: true, force: true });
mkdirSync("assets/marketplace/.claude-plugin", { recursive: true });
cpSync("../../.claude-plugin/marketplace.json", "assets/marketplace/.claude-plugin/marketplace.json");
cpSync("../../plugins/harness-offload", "assets/marketplace/plugins/harness-offload", { recursive: true, filter: (p) => !p.includes("/tests") });
console.log("built dist/cli.js, dist/pi.js, dist/opencode.js, plugins/harness-offload/dist, assets/marketplace");
