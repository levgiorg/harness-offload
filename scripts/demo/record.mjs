// Records scripts/demo/terminal.html into PNG frames, then build-gif.py turns
// them into docs/assets/demo.gif.
//   node scripts/demo/record.mjs OUT_DIR   (needs Playwright with Chromium)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, "frames");
mkdirSync(out, { recursive: true });
const session = JSON.parse(readFileSync(join(here, "session.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)("playwright");

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });
const page = await browser.newPage({ viewport: { width: 1200, height: 680 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await page.goto(pathToFileURL(join(here, "terminal.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const frames = [];
let n = 0;
async function shot(scene, typed, lines, cursor, ms) {
  await page.evaluate(([s, sc, t, l, c]) => window.show(s, sc, t, l, c), [session, scene, typed, lines, cursor]);
  const file = join(out, `f${String(n++).padStart(3, "0")}.png`);
  await page.locator("#win").screenshot({ path: file });
  frames.push({ file, ms });
}

for (let i = 0; i < session.scenes.length; i++) {
  const s = session.scenes[i];
  const steps = 6;
  for (let k = 1; k <= steps; k++) await shot(i, Math.ceil((s.command.length * k) / steps), 0, true, k === steps ? 500 : 90);
  const chunks = 4;
  for (let k = 1; k <= chunks; k++) await shot(i, s.command.length, Math.ceil((s.output.length * k) / chunks), false, k === chunks ? 4200 : 260);
}
await shot(-1, 0, 0, false, 3600);
writeFileSync(join(out, "frames.json"), JSON.stringify(frames, null, 1));
await browser.close();
console.log(`${frames.length} frames → ${out}`);
