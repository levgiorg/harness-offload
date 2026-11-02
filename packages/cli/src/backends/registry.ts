import { CONNECTORS } from "../assets.ts";
import { cfg, cfgStr } from "../config.ts";
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

export const HOST_NAMES = ["claude", "codex", "gemini", "cursor", "pi", "opencode", "kilo", "devin", "copilot", "qwen", "crush", "amp"] as const;

/** Which harness is calling us: OFFLOAD_HOST (set by our hooks, MCP launchers and
 * in-process integrations), else the environment the harness gives its shell. */
export function detectHost(): string | undefined {
  const e = process.env;
  if (e.OFFLOAD_HOST) return e.OFFLOAD_HOST;
  // harnesses that also set Claude's variables come first
  if (e.COPILOT_CLI === "1") return "copilot";
  if (e.QWEN_CODE_SESSION_ID || e.QWEN_PROJECT_DIR) return "qwen";
  if (e.CRUSH === "1" || e.CRUSH_SESSION_ID) return "crush";
  if (e.CLAUDECODE === "1" || e.CLAUDE_CODE_ENTRYPOINT) return "claude";
  if (e.CODEX_THREAD_ID || e.CODEX_SANDBOX || e.CODEX_CI) return "codex";
  if (e.CURSOR_AGENT || e.CURSOR_CONVERSATION_ID) return "cursor";
  if (e.GEMINI_CLI === "1" || e.GEMINI_SESSION_ID) return "gemini";
  if (e.OPENCODE === "1" || e.OPENCODE_SESSION_ID) return "opencode";
  if (e.PI_CODING_AGENT === "1" || e.PI_SESSION_ID) return "pi";
  return undefined;
}

/** "@host" → the calling harness's own cheap model (same subscription). */
export function hostModel(host = detectHost()): string | undefined {
  if (!host) return undefined;
  const own = cfg(`host_models.${host}`);
  if (typeof own === "string") return own;
  return CONNECTORS.host_models[host];
}

/**
 * "@host" → the harness's own subscription (see hostModel).
 * "opencode-go/glm-5" (no known prefix) → default backend (opencode).
 * "openrouter:qwen/qwen3-coder", "ollama:qwen3:8b", "pi:anthropic/claude-haiku" → that backend.
 * "@default" → the default backend's own default model.
 */
export function parseRef(ref: string): ModelRef {
  const def = cfgStr("backend", "opencode");
  if (ref === "@host" || ref === "@self") {
    const m = hostModel();
    if (m === undefined) throw new Error("@host: cannot tell which agent harness is calling (set OFFLOAD_HOST=claude|codex|gemini|cursor|pi|opencode)");
    if (m === "@host" || m === "@self") return { backend: def, model: "", ref: "@default" };
    return parseRef(m);
  }
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
