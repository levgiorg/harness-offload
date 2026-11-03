// Checks what `npm pack` would publish, before anything is published:
// everything the CLI, the hooks and the installer need is in; sources, tests
// and secrets are out; no install-time scripts (npm 12, pnpm 10 and Bun block
// them, and they are how the 2025 npm worms spread).   node scripts/pack-check.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const [info] = JSON.parse(out);
const files = info.files.map((f) => f.path);
const has = (p) => files.includes(p);
const problems = [];

for (const need of [
  "package.json", "README.md", "LICENSE", "LICENSE-FONTS",
  "dist/cli.js", "dist/main.js", "dist/hook.cjs", "dist/pi.js", "dist/opencode.js", "dist/amp.js",
  "assets/marketplace/.claude-plugin/marketplace.json",
  "assets/marketplace/plugins/harness-offload/.claude-plugin/plugin.json",
  "assets/marketplace/plugins/harness-offload/hooks/hooks.json",
  "assets/marketplace/plugins/harness-offload/bin/offload",
  "assets/marketplace/plugins/harness-offload/bin/offload-ts",
  "assets/marketplace/plugins/harness-offload/dist/hook.cjs",
  "assets/marketplace/plugins/harness-offload/dist/package.json",
  "assets/marketplace/plugins/harness-offload/LICENSE-FONTS",
]) if (!has(need)) problems.push(`missing: ${need}`);
if (!files.some((f) => /^dist\/chunk-[a-z0-9]+\.js$/.test(f))) problems.push("missing: dist/chunk-*.js");
for (const f of files) {
  if (/^(src|test|scripts|node_modules)\//.test(f) || /\/tests\//.test(f)) problems.push(`should not ship: ${f}`);
  if (/(^|\/)\.env(\.|$)|\.pem$|\.key$|credentials/i.test(f)) problems.push(`looks secret: ${f}`);
}
for (const s of ["preinstall", "install", "postinstall", "prepare"]) if (pkg.scripts?.[s]) problems.push(`install-time script "${s}" in package.json`);
if (!/^#!\/usr\/bin\/env node/.test(readFileSync(join(pkgDir, "dist", "cli.js"), "utf8"))) problems.push("dist/cli.js has no node shebang");
if (pkg.repository?.url !== "git+https://github.com/levgiorg/harness-offload.git") problems.push(`repository.url must match the GitHub repo exactly (provenance): ${pkg.repository?.url}`);
const mb = info.unpackedSize / 1e6;
// a budget a little over today's size (0.97 MB packed, 3.7 MB unpacked): growth is a choice, not an accident
if (mb > 5) problems.push(`unpacked size ${mb.toFixed(1)} MB is over the 5 MB budget`);
if (info.size / 1e6 > 1.5) problems.push(`packed size ${(info.size / 1e6).toFixed(2)} MB is over the 1.5 MB budget`);

if (problems.length) {
  console.error(`npm pack check failed for ${info.name}@${info.version}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`npm pack check ok: ${info.name}@${info.version}, ${files.length} files, ${(info.size / 1e6).toFixed(2)} MB packed, ${mb.toFixed(2)} MB unpacked`);
