import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { childProcess } from "./lazy.ts";
import { existsSync, statSync } from "node:fs";


/** offload's own config and state folders for a platform, environment and home folder (pure, so the
 *  Windows answers are tested anywhere): XDG variables first, then %APPDATA% / %LOCALAPPDATA%. */
export function configHomeFor(platform: string, env: NodeJS.ProcessEnv, h: string): string {
  if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME;
  if (platform === "win32" && env.APPDATA) return env.APPDATA;
  return (platform === "win32" ? win32 : posix).join(h, ".config");
}
export function stateHomeFor(platform: string, env: NodeJS.ProcessEnv, h: string): string {
  if (env.XDG_STATE_HOME) return env.XDG_STATE_HOME;
  if (platform === "win32" && env.LOCALAPPDATA) return env.LOCALAPPDATA;
  return (platform === "win32" ? win32 : posix).join(h, ".local", "state");
}
export const configHome = (): string => configHomeFor(process.platform, process.env, homedir());
export const stateHome = (): string => stateHomeFor(process.platform, process.env, homedir());

export function userConfigPath(): string {
  return process.env.OFFLOAD_CONFIG || join(configHome(), "harness-offload", "config.json");
}

let projectDirCache: string | undefined;
export function projectDir(): string {
  if (projectDirCache) return projectDirCache;
  const fromEnv = process.env.OFFLOAD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory()) return (projectDirCache = fromEnv);
  try {
    const top = childProcess().execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top) return (projectDirCache = top);
  } catch {
    /* not a git repo */
  }
  return (projectDirCache = process.cwd());
}

export function setProjectDir(dir: string): void {
  projectDirCache = dir;
}

export function projectConfigPath(): string {
  return join(projectDir(), ".harness-offload.json");
}
