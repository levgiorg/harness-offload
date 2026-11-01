import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = () => dirname(fileURLToPath(import.meta.url));

/** Root of a Claude-format marketplace containing plugins/harness-offload. */
export function marketplaceRoot(): string {
  const candidates = [
    process.env.OFFLOAD_MARKETPLACE_DIR,
    join(here(), "..", "assets", "marketplace"), // npm package (dist/ → assets/)
    join(here(), "..", "..", "..", "assets", "marketplace"),
    resolve(here(), "..", "..", ".."), // repo checkout: packages/cli/dist → repo root
    resolve(here(), "..", "..", "..", ".."),
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(join(c, ".claude-plugin", "marketplace.json")) && existsSync(join(c, "plugins", "harness-offload"))) return c;
  throw new Error("cannot find the bundled plugin files (set OFFLOAD_MARKETPLACE_DIR)");
}

export const pluginDir = (): string => join(marketplaceRoot(), "plugins", "harness-offload");

/** The package root (has package.json with the "pi" manifest and dist/). */
export function packageRoot(): string {
  for (const c of [join(here(), ".."), join(here(), "..", "..")]) if (existsSync(join(c, "package.json")) && existsSync(join(c, "dist"))) return resolve(c);
  return resolve(here(), "..");
}

export const distFile = (name: string): string => join(packageRoot(), "dist", name);
