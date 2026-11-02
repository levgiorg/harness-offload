// Shared assets (worker prompts, default config, outline regexes) come from
// the Claude Code plugin directory via scripts/gen-assets.mjs.
import { CONNECTORS_JSON, DEFAULTS_JSON, OUTLINE_JSON, PLUGIN_VERSION, PROMPT_TEXT, TASK_CONTRACT as TASK_CONTRACT_TEXT } from "./generated/assets.ts";

export const DEFAULTS: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULTS_JSON));
export const OUTLINE: { languages: { exts: string[]; regex: string }[]; default: string } = JSON.parse(JSON.stringify(OUTLINE_JSON));

export const CONNECTORS: {
  endpoints: Record<string, Record<string, string>>;
  host_models: Record<string, string>;
  host_api_models: Record<string, string>;
  worker_names?: { plans?: Record<string, string>; models?: Record<string, string> };
} = JSON.parse(JSON.stringify(CONNECTORS_JSON));

export type Task = "read" | "summarize" | "explore" | "write" | "ask";
export const TASKS: Task[] = ["read", "explore", "summarize", "write", "ask"];

export const PROMPTS: Record<Task, string> = { ...PROMPT_TEXT };

export const VERSION: string = PLUGIN_VERSION;
/** Worker rules appended to every custom task's instructions. */
export const TASK_CONTRACT: string = TASK_CONTRACT_TEXT;
