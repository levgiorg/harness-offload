// src/hosts/assets.ts
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var here = () => dirname(fileURLToPath(import.meta.url));
function marketplaceRoot() {
  const candidates = [
    process.env.OFFLOAD_MARKETPLACE_DIR,
    join(here(), "..", "assets", "marketplace"),
    join(here(), "..", "..", "..", "assets", "marketplace"),
    resolve(here(), "..", "..", ".."),
    resolve(here(), "..", "..", "..", "..")
  ].filter(Boolean);
  for (const c of candidates)
    if (existsSync(join(c, ".claude-plugin", "marketplace.json")) && existsSync(join(c, "plugins", "harness-offload")))
      return c;
  throw new Error("cannot find the bundled plugin files (set OFFLOAD_MARKETPLACE_DIR)");
}
var pluginDir = () => join(marketplaceRoot(), "plugins", "harness-offload");
function packageRoot() {
  if (process.env.OFFLOAD_PACKAGE_DIR)
    return process.env.OFFLOAD_PACKAGE_DIR;
  for (const c of [join(here(), ".."), join(here(), "..", "..")])
    if (existsSync(join(c, "package.json")) && existsSync(join(c, "dist")))
      return resolve(c);
  return resolve(here(), "..");
}
var distFile = (name) => join(packageRoot(), "dist", name);
function checkoutRoot() {
  for (const c of [resolve(packageRoot(), "..", ".."), resolve(here(), "..", "..", "..")]) {
    if (existsSync(join(c, ".git")) && existsSync(join(c, ".claude-plugin", "marketplace.json")) && existsSync(join(c, "plugins", "harness-offload")))
      return c;
  }
  return;
}
var ownCopyDir = () => join(process.env.XDG_DATA_HOME || join(process.env.OFFLOAD_HOME || homedir(), ".local", "share"), "harness-offload");
function useOwnCopy() {
  if (checkoutRoot() || process.env.OFFLOAD_MARKETPLACE_DIR)
    return;
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

export { marketplaceRoot, pluginDir, packageRoot, distFile, checkoutRoot, ownCopyDir, useOwnCopy };
