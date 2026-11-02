// Custom tasks: tasks.<name> = {description, prompt | prompt_file, model, tools}
// in the config. A task runs through the read flow (with files), the ask flow
// (no files) or the explore flow (tools: "read"), with its own instructions
// plus the shared worker rules (prompts/task-contract.md). Twin: cmd_task in
// the bash engine.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { TASK_CONTRACT } from "./assets.ts";
import { cfg } from "./config.ts";
import { projectDir, userConfigPath } from "./paths.ts";
import { isSecretTarget } from "./secrets.ts";

export interface TaskDef {
  name: string;
  description: string;
  prompt?: string;
  prompt_file?: string;
  model?: string;
  tools: "none" | "read";
}

/** Lowercase letters, digits, - and _, not starting with -, at most 40 characters. */
export const TASK_NAME = /^[a-z0-9_][a-z0-9_-]{0,39}$/;

export function taskNames(): string[] {
  const t = cfg("tasks");
  return t && typeof t === "object" && !Array.isArray(t) ? Object.keys(t).sort() : [];
}

export function taskDef(name: string): TaskDef | undefined {
  const t = cfg(`tasks.${name}`) as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object" || Array.isArray(t)) return undefined;
  const s = (k: string) => (typeof t[k] === "string" ? (t[k] as string) : undefined);
  const tools = s("tools") ?? "none";
  return { name, description: s("description") ?? "", prompt: s("prompt"), prompt_file: s("prompt_file"), model: s("model"), tools: tools as "none" | "read" };
}

const inside = (root: string, p: string) => {
  const rel = relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** The task's own instructions + the shared worker rules. Throws a readable error. */
export function taskSystem(def: TaskDef): string {
  if (def.tools !== "none" && def.tools !== "read") throw new Error(`task ${def.name}: tools must be "none" or "read" (got ${def.tools})`);
  let text = def.prompt;
  if (def.prompt_file) {
    let f = def.prompt_file;
    if (f.startsWith("~/")) f = join(homedir(), f.slice(2));
    else if (!isAbsolute(f)) f = join(projectDir(), f);
    if (!existsSync(f)) throw new Error(`task ${def.name}: prompt_file not found: ${f}`);
    // only regular, non-secret files of at most 64 KB in the project or the user config dir
    const real = realpathSync(f);
    const roots = [projectDir(), dirname(userConfigPath())].filter(existsSync).map((r) => realpathSync(r));
    if (!roots.some((r) => inside(r, real))) throw new Error(`task ${def.name}: prompt_file must be inside the project or ${dirname(userConfigPath())}`);
    if (isSecretTarget(real)) throw new Error(`task ${def.name}: prompt_file matches privacy.secret_globs`);
    const st = statSync(real);
    if (!st.isFile() || st.size > 65536) throw new Error(`task ${def.name}: prompt_file must be a regular file of at most 64 KB`);
    text = readFileSync(real, "utf8");
  }
  if (!text || !text.trim()) throw new Error(`task ${def.name}: give it a prompt or a prompt_file`);
  return `${text.replace(/\n*$/, "\n")}\n${TASK_CONTRACT}`;
}

/** "review-sql (Find N+1 queries), scan" — for session guides and tool descriptions. */
export function taskSummary(max = 12): string {
  const names = taskNames().filter((n) => TASK_NAME.test(n));
  const parts = names.slice(0, max).map((n) => {
    const d = (taskDef(n)?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return d ? `${n} (${d})` : n;
  });
  return parts.join(", ") + (names.length > max ? `, … (${names.length - max} more: offload tasks)` : "");
}

/** Set while a custom task runs: the engine uses its instructions and model. */
export interface TaskContext {
  name: string;
  system: string;
  model?: string;
}
let current: TaskContext | undefined;
export const setTaskContext = (c: TaskContext | undefined) => (current = c);
export const taskContext = () => current;
