import { cfgStr } from "../config.ts";
import { endpoint, endpointNames, HttpBackend } from "./http.ts";
import { OpencodeBackend } from "./opencode.ts";
import { cliAgentBackend, CLI_AGENTS } from "./agents.ts";
import type { Backend } from "./types.ts";

export interface ModelRef {
  backend: string;
  model: string;
  /** The reference as written in the config, for logs and cooldown keys. */
  ref: string;
}

const LOCAL = new Set(["opencode", ...Object.keys(CLI_AGENTS)]);

/**
 * "opencode-go/glm-5" (no known prefix) → default backend (opencode).
 * "openrouter:qwen/qwen3-coder", "ollama:qwen3:8b", "pi:anthropic/claude-haiku" → that backend.
 * "@default" → the default backend's own default model.
 */
export function parseRef(ref: string): ModelRef {
  const def = cfgStr("backend", "opencode");
  if (!ref || ref === "@default") return { backend: def, model: "", ref: "@default" };
  const i = ref.indexOf(":");
  if (i > 0) {
    const prefix = ref.slice(0, i);
    if (LOCAL.has(prefix) || endpointNames().includes(prefix)) return { backend: prefix, model: ref.slice(i + 1), ref };
  }
  return { backend: def, model: ref, ref };
}

const cache = new Map<string, Backend>();
export function backendFor(name: string): Backend | undefined {
  if (cache.has(name)) return cache.get(name);
  let b: Backend | undefined;
  if (name === "opencode") b = new OpencodeBackend();
  else if (name in CLI_AGENTS) b = cliAgentBackend(name);
  else {
    const ep = endpoint(name);
    if (ep) b = new HttpBackend(ep);
  }
  if (b) cache.set(name, b);
  return b;
}

export function allBackendNames(): string[] {
  return ["opencode", ...Object.keys(CLI_AGENTS), ...endpointNames()];
}
