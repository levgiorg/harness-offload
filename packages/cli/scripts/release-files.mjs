// Copies the files npm shows on the package page into packages/cli before a
// pack or publish: LICENSE, LICENSE-FONTS and README.md (its repo-relative links
// and images rewritten to GitHub, which npmjs.com can't resolve otherwise).
//   node scripts/release-files.mjs      (GITHUB_REPOSITORY overrides the repo)
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkg, "..", "..");
const slug = process.env.GITHUB_REPOSITORY || "levgiorg/harness-offload";
copyFileSync(join(repo, "LICENSE"), join(pkg, "LICENSE"));
copyFileSync(join(repo, "LICENSE-FONTS"), join(pkg, "LICENSE-FONTS"));
const readme = readFileSync(join(repo, "README.md"), "utf8")
  .replace(/src="((?:docs|site)\/[^"]+)"/g, `src="https://raw.githubusercontent.com/${slug}/main/$1"`)
  .replace(/\]\(((?:docs\/|site\/)[^)]+|SECURITY\.md|CONTRIBUTING\.md|CHANGELOG\.md|LICENSE(?:-FONTS)?)\)/g, `](https://github.com/${slug}/blob/main/$1)`);
writeFileSync(join(pkg, "README.md"), readme);
console.log(`release files ready in ${pkg} (README links → github.com/${slug})`);
