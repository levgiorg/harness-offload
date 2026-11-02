import {
  childProcess
} from "./chunk-z2qytrf7.js";

// src/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
var isWin = process.platform === "win32";
function configHome() {
  if (process.env.XDG_CONFIG_HOME)
    return process.env.XDG_CONFIG_HOME;
  if (isWin && process.env.APPDATA)
    return process.env.APPDATA;
  return join(homedir(), ".config");
}
function stateHome() {
  if (process.env.XDG_STATE_HOME)
    return process.env.XDG_STATE_HOME;
  if (isWin && process.env.LOCALAPPDATA)
    return process.env.LOCALAPPDATA;
  return join(homedir(), ".local", "state");
}
function userConfigPath() {
  return process.env.OFFLOAD_CONFIG || join(configHome(), "harness-offload", "config.json");
}
var projectDirCache;
function projectDir() {
  if (projectDirCache)
    return projectDirCache;
  const fromEnv = process.env.OFFLOAD_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory())
    return projectDirCache = fromEnv;
  try {
    const top = childProcess().execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top)
      return projectDirCache = top;
  } catch {}
  return projectDirCache = process.cwd();
}
function setProjectDir(dir) {
  projectDirCache = dir;
}
function projectConfigPath() {
  return join(projectDir(), ".harness-offload.json");
}

export { configHome, stateHome, userConfigPath, projectDir, setProjectDir, projectConfigPath };
