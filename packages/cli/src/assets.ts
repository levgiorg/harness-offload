// Shared assets (worker prompts, default config, outline regexes) come from
// the Claude Code plugin directory via scripts/gen-assets.mjs.
import { DEFAULTS_JSON, OUTLINE_JSON, PROMPT_TEXT } from "./generated/assets.ts";

export const DEFAULTS: Record<string, unknown> = JSON.parse(JSON.stringify(DEFAULTS_JSON));
export const OUTLINE: { languages: { exts: string[]; regex: string }[]; default: string } = JSON.parse(JSON.stringify(OUTLINE_JSON));

export type Task = "read" | "summarize" | "explore" | "write" | "ask";
export const TASKS: Task[] = ["read", "explore", "summarize", "write", "ask"];

export const PROMPTS: Record<Task, string> = { ...PROMPT_TEXT };

export const VERSION = "0.2.0";
