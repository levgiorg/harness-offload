// Hash of everything the plugin's bundled dist/ is built from, so CI can tell
// when plugins/harness-offload/dist is stale without depending on the exact
// bundler output.   node scripts/source-hash.mjs          → prints the hash
//                   node scripts/source-hash.mjs --check  → exit 1 when stale
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repo = join(pkg, "..", "..");
const plugin = join(repo, "plugins", "harness-offload");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function sourceHash() {
  const files = [
    ...walk(join(pkg, "src")),
    ...walk(join(pkg, "scripts")).filter((f) => !f.endsWith("source-hash.mjs")),
    join(pkg, "package.json"),
    join(pkg, "bun.lock"),
    ...walk(join(plugin, "config")),
    ...walk(join(plugin, "prompts")),
    join(plugin, ".claude-plugin", "plugin.json"),
  ].filter((f) => existsSync(f));
  const h = createHash("sha256");
  for (const f of files) {
    // normalise line endings and separators so Windows checkouts agree
    h.update(relative(repo, f).split(sep).join("/") + "\0");
    h.update(readFileSync(f, "utf8").replace(/\r\n/g, "\n") + "\0");
  }
  return h.digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = sourceHash();
  if (process.argv.includes("--check")) {
    const file = join(plugin, "dist", "SOURCE_HASH");
    const was = existsSync(file) ? readFileSync(file, "utf8").trim() : "(missing)";
    if (was !== now) {
      console.error(`plugins/harness-offload/dist is stale (built from ${was.slice(0, 12)}, sources are ${now.slice(0, 12)}).\nRun: cd packages/cli && bun run build — and commit plugins/harness-offload/dist.`);
      process.exit(1);
    }
    console.log(`plugins/harness-offload/dist is up to date (${now.slice(0, 12)})`);
  } else console.log(now);
}
