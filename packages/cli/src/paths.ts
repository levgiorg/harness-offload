import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const isWin = process.platform === "win32";

export function configHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (isWin && process.env.APPDATA) return process.env.APPDATA;
  return join(homedir(), ".config");
}

export function stateHome(): string {
  if (process.env.XDG_STATE_HOME) return process.env.XDG_STATE_HOME;
  if (isWin && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return join(homedir(), ".local", "state");
}

export function userConfigPath(): string {
  return process.env.OFFLOAD_CONFIG || join(configHome(), "harness-offload", "config.json");
}

let projectDirCache: string | undefined;
export function projectDir(): string {
  if (projectDirCache) return projectDirCache;
  const fromEnv = process.env.OFFLOAD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory()) return (projectDirCache = fromEnv);
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
