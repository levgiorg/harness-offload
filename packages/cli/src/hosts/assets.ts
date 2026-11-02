import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
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
  if (process.env.OFFLOAD_PACKAGE_DIR) return process.env.OFFLOAD_PACKAGE_DIR;
  for (const c of [join(here(), ".."), join(here(), "..", "..")]) if (existsSync(join(c, "package.json")) && existsSync(join(c, "dist"))) return resolve(c);
  return resolve(here(), "..");
}

export const distFile = (name: string): string => join(packageRoot(), "dist", name);

/** The repository checkout this CLI runs from, if any (developers: installs
 * then point at it, so edits apply on the next session). */
export function checkoutRoot(): string | undefined {
  for (const c of [resolve(packageRoot(), "..", ".."), resolve(here(), "..", "..", "..")]) {
    if (existsSync(join(c, ".git")) && existsSync(join(c, ".claude-plugin", "marketplace.json")) && existsSync(join(c, "plugins", "harness-offload"))) return c;
  }
  return undefined;
}

/** Offload's own copy of its files, which installed harnesses point at. */
export const ownCopyDir = (): string => join(process.env.XDG_DATA_HOME || join(process.env.OFFLOAD_HOME || homedir(), ".local", "share"), "harness-offload");

/** Run from npm or npx, the package lives in a cache that can be cleaned at any
 * time, so `offload install` first copies the plugin and the package's dist to
 * ownCopyDir() and points every harness there (a checkout is used as is). */
export function useOwnCopy(): void {
  if (checkoutRoot() || process.env.OFFLOAD_MARKETPLACE_DIR) return;
  const dest = ownCopyDir();
  const market = marketplaceRoot();
  const pkg = packageRoot();
  rmSync(join(dest, "marketplace"), { recursive: true, force: true });
  rmSync(join(dest, "package"), { recursive: true, force: true });
  mkdirSync(join(dest, "package"), { recursive: true });
  cpSync(market, join(dest, "marketplace"), { recursive: true });
  cpSync(join(pkg, "package.json"), join(dest, "package", "package.json"));
  cpSync(join(pkg, "dist"), join(dest, "package", "dist"), { recursive: true });
  process.env.OFFLOAD_MARKETPLACE_DIR = join(dest, "marketplace");
  process.env.OFFLOAD_PACKAGE_DIR = join(dest, "package");
}
