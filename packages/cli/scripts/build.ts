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
if (!res.success) {
  for (const l of res.logs) console.error(l);
  process.exit(1);
}
const { chmodSync, readFileSync, writeFileSync } = await import("node:fs");
// Bun keeps the source shebang too; make sure there is exactly one.
const out = readFileSync("dist/cli.js", "utf8").replace(/^(#!.*\n)+/, "#!/usr/bin/env node\n");
writeFileSync("dist/cli.js", out);
chmodSync("dist/cli.js", 0o755);
// dist/offload-node: a bash launcher used by the conformance suite.
const { copyFileSync } = await import("node:fs");
copyFileSync("scripts/node-wrapper.sh", "dist/offload-node");
chmodSync("dist/offload-node", 0o755);
console.log("built dist/cli.js");
