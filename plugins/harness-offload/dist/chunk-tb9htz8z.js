import {
  TASK_CONTRACT
} from "./chunk-25ca7170.js";
import {
  userConfigPath2,
  projectDir2,
  cfg,
  isSecretTarget
} from "./chunk-djerf2vs.js";

// src/tasks.ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
var TASK_NAME = /^[a-z0-9_][a-z0-9_-]{0,39}$/;
function taskNames() {
  const t = cfg("tasks");
  return t && typeof t === "object" && !Array.isArray(t) ? Object.keys(t).sort() : [];
}
function taskDef(name) {
  const t = cfg(`tasks.${name}`);
  if (!t || typeof t !== "object" || Array.isArray(t))
    return;
  const s = (k) => typeof t[k] === "string" ? t[k] : undefined;
  const tools = s("tools") ?? "none";
  return { name, description: s("description") ?? "", prompt: s("prompt"), prompt_file: s("prompt_file"), model: s("model"), tools };
}
var inside = (root, p) => {
  const rel = relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
function taskSystem(def) {
  if (def.tools !== "none" && def.tools !== "read")
    throw new Error(`task ${def.name}: tools must be "none" or "read" (got ${def.tools})`);
  let text = def.prompt;
  if (def.prompt_file) {
    let f = def.prompt_file;
    if (f.startsWith("~/"))
      f = join(homedir(), f.slice(2));
    else if (!isAbsolute(f))
      f = join(projectDir2(), f);
    if (!existsSync(f))
      throw new Error(`task ${def.name}: prompt_file not found: ${f}`);
    const real = realpathSync(f);
    const roots = [projectDir2(), dirname(userConfigPath2())].filter(existsSync).map((r) => realpathSync(r));
    if (!roots.some((r) => inside(r, real)))
      throw new Error(`task ${def.name}: prompt_file must be inside the project or ${dirname(userConfigPath2())}`);
    if (isSecretTarget(real))
      throw new Error(`task ${def.name}: prompt_file matches privacy.secret_globs`);
    const st = statSync(real);
    if (!st.isFile() || st.size > 65536)
      throw new Error(`task ${def.name}: prompt_file must be a regular file of at most 64 KB`);
    text = readFileSync(real, "utf8");
  }
  if (!text || !text.trim())
    throw new Error(`task ${def.name}: give it a prompt or a prompt_file`);
  return `${text.replace(/\n*$/, `
`)}
${TASK_CONTRACT}`;
}
function taskSummary(max = 12) {
  const names = taskNames().filter((n) => TASK_NAME.test(n));
  const parts = names.slice(0, max).map((n) => {
    const d = (taskDef(n)?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return d ? `${n} (${d})` : n;
  });
  return parts.join(", ") + (names.length > max ? `, … (${names.length - max} more: offload tasks)` : "");
}
var current;
var setTaskContext = (c) => current = c;
var taskContext = () => current;

export { TASK_NAME, taskNames, taskDef, taskSystem, taskSummary, setTaskContext, taskContext };
