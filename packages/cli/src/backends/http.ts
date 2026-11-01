// OpenAI-compatible and Anthropic HTTP connectors. `explore` gets a small
// local tool loop (read_file/grep/glob/list_dir, read-only, sandboxed).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "../config.ts";
import { configHome } from "../paths.ts";
import { runTool, TOOL_SPECS } from "./tools.ts";
import { Backend, classify, E, WorkerError, WorkerRequest, WorkerResult } from "./types.ts";

export interface Endpoint {
  name: string;
  type: "openai" | "anthropic";
  base_url: string;
  api_key_env?: string;
  api_key?: string;
  headers?: Record<string, string>;
  label?: string;
  /** Ask the API for its model list at setup time. */
  list_models?: boolean;
}

/** Built-in presets; `endpoints.<name>` in the config overrides or adds. */
export const PRESETS: Record<string, Omit<Endpoint, "name">> = {
  openai: { type: "openai", base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY", label: "OpenAI API" },
  openrouter: { type: "openai", base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY", label: "OpenRouter" },
  anthropic: { type: "anthropic", base_url: "https://api.anthropic.com", api_key_env: "ANTHROPIC_API_KEY", label: "Anthropic API" },
  google: { type: "openai", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY", label: "Google AI Studio (Gemini API)" },
  groq: { type: "openai", base_url: "https://api.groq.com/openai/v1", api_key_env: "GROQ_API_KEY", label: "Groq" },
  deepseek: { type: "openai", base_url: "https://api.deepseek.com/v1", api_key_env: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  mistral: { type: "openai", base_url: "https://api.mistral.ai/v1", api_key_env: "MISTRAL_API_KEY", label: "Mistral" },
  together: { type: "openai", base_url: "https://api.together.xyz/v1", api_key_env: "TOGETHER_API_KEY", label: "Together AI" },
  fireworks: { type: "openai", base_url: "https://api.fireworks.ai/inference/v1", api_key_env: "FIREWORKS_API_KEY", label: "Fireworks" },
  cerebras: { type: "openai", base_url: "https://api.cerebras.ai/v1", api_key_env: "CEREBRAS_API_KEY", label: "Cerebras" },
  xai: { type: "openai", base_url: "https://api.x.ai/v1", api_key_env: "XAI_API_KEY", label: "xAI" },
  zai: { type: "openai", base_url: "https://api.z.ai/api/paas/v4", api_key_env: "ZAI_API_KEY", label: "Z.ai (GLM)" },
  moonshot: { type: "openai", base_url: "https://api.moonshot.ai/v1", api_key_env: "MOONSHOT_API_KEY", label: "Moonshot (Kimi)" },
  ollama: { type: "openai", base_url: "http://127.0.0.1:11434/v1", label: "Ollama (local)" },
  lmstudio: { type: "openai", base_url: "http://127.0.0.1:1234/v1", label: "LM Studio (local)" },
  vllm: { type: "openai", base_url: "http://127.0.0.1:8000/v1", label: "vLLM (local)" },
};

export function credentialsPath(): string {
  return process.env.OFFLOAD_CREDENTIALS || join(configHome(), "code-offload", "credentials.json");
}

function storedKey(name: string): string | undefined {
  try {
    const p = credentialsPath();
    if (!existsSync(p)) return undefined;
    const v = JSON.parse(readFileSync(p, "utf8"));
    return typeof v?.[name] === "string" ? v[name] : undefined;
  } catch {
    return undefined;
  }
}

export function endpoint(name: string): Endpoint | undefined {
  const fromCfg = cfg(`endpoints.${name}`) as Partial<Endpoint> | undefined;
  const preset = PRESETS[name];
  if (!fromCfg && !preset) return undefined;
  const merged = { ...(preset ?? {}), ...(fromCfg ?? {}) } as Endpoint;
  if (!merged.type || !merged.base_url) return undefined;
  return { ...merged, name };
}

export function endpointNames(): string[] {
  const own = Object.keys((cfg("endpoints") as Record<string, unknown>) ?? {});
  return [...new Set([...Object.keys(PRESETS), ...own])];
}

function apiKey(ep: Endpoint): string | undefined {
  return ep.api_key || storedKey(ep.name) || (ep.api_key_env ? process.env[ep.api_key_env] : undefined);
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    clearTimeout(t);
    if ((e as Error).name === "AbortError") throw new WorkerError(E.TIMEOUT, `timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw new WorkerError(E.WORKER, `cannot reach ${url}: ${(e as Error).message}`);
  }
  const text = await res.text();
  clearTimeout(t);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? text.slice(0, 300);
    const code = res.status === 401 || res.status === 403 ? E.AUTH : res.status === 429 || res.status === 402 ? E.QUOTA : res.status === 404 && /model/i.test(msg) ? E.MODEL : classify(`${res.status} ${msg}`);
    throw new WorkerError(code, `HTTP ${res.status}: ${msg}`);
  }
  return json;
}

export class HttpBackend implements Backend {
  readonly kind: string;
  readonly label: string;
  constructor(private ep: Endpoint) {
    this.kind = ep.name;
    this.label = ep.label ?? ep.name;
  }

  async available() {
    const local = /127\.0\.0\.1|localhost/.test(this.ep.base_url);
    if (!local && !apiKey(this.ep)) return { ok: false, detail: `no API key (${this.ep.api_key_env ?? "credentials"})` };
    return { ok: true, detail: this.ep.base_url };
  }

  async models(): Promise<string[]> {
    const key = apiKey(this.ep);
    const url = this.ep.type === "anthropic" ? `${this.ep.base_url}/v1/models` : `${this.ep.base_url}/models`;
    const headers: Record<string, string> = { ...(this.ep.headers ?? {}) };
    if (this.ep.type === "anthropic") {
      if (key) headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (key) headers.authorization = `Bearer ${key}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      const j: any = await res.json();
      return (j?.data ?? []).map((m: any) => String(m.id)).sort();
    } catch {
      return [];
    }
  }

  async run(req: WorkerRequest): Promise<WorkerResult> {
    const key = apiKey(this.ep);
    if (!key && !/127\.0\.0\.1|localhost/.test(this.ep.base_url)) {
      throw new WorkerError(E.AUTH, `no API key for ${this.ep.name}: set ${this.ep.api_key_env ?? "it"} or run \`offload setup\``);
    }
    if (!req.model) throw new WorkerError(E.MODEL, `endpoint ${this.ep.name} needs a model id, e.g. ${this.ep.name}:<model>`);
    return this.ep.type === "anthropic" ? this.anthropic(req, key) : this.openai(req, key);
  }

  private async openai(req: WorkerRequest, key: string | undefined): Promise<WorkerResult> {
    const headers: Record<string, string> = { ...(this.ep.headers ?? {}) };
    if (key) headers.authorization = `Bearer ${key}`;
    const tools = req.task === "explore" ? TOOL_SPECS.map((t) => ({ type: "function", function: t })) : undefined;
    const messages: any[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ];
    let tokensIn = 0;
    let tokensOut = 0;
    let ctxIn = 0;
    const deadline = Date.now() + req.timeoutSec * 1000;
    const steps = req.task === "explore" ? (req.maxSteps ?? 40) : 1;
    for (let step = 0; step < steps; step++) {
      const body: any = { model: req.model, messages };
      if (tools) body.tools = tools;
      if (req.variant) body.reasoning_effort = req.variant;
      const j = await post(`${this.ep.base_url}/chat/completions`, body, headers, Math.max(1000, deadline - Date.now()));
      tokensIn += j?.usage?.prompt_tokens ?? 0;
      tokensOut += j?.usage?.completion_tokens ?? 0;
      ctxIn = j?.usage?.prompt_tokens ?? ctxIn;
      const msg = j?.choices?.[0]?.message;
      if (!msg) throw new WorkerError(E.WORKER, "empty response");
      const calls = msg.tool_calls ?? [];
      if (!calls.length || !tools) {
        const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((p: any) => p.text ?? "").join("");
        if (!text.trim()) throw new WorkerError(E.WORKER, "worker returned an empty answer");
        return { text, tokensIn, tokensOut, ctxIn, cost: 0 };
      }
      messages.push(msg);
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function?.arguments || "{}");
        } catch {
          /* empty */
        }
        messages.push({ role: "tool", tool_call_id: c.id, content: runTool(c.function?.name, args, { root: req.cwd, secretGlobs: req.secretGlobs ?? [] }) });
      }
      if (step === steps - 2) messages.push({ role: "user", content: "Step budget almost used: answer now with what you found." });
    }
    throw new WorkerError(E.WORKER, `explore used all ${steps} steps without answering`);
  }

  private async anthropic(req: WorkerRequest, key: string | undefined): Promise<WorkerResult> {
    const headers: Record<string, string> = { "anthropic-version": "2023-06-01", ...(this.ep.headers ?? {}) };
    if (key) headers["x-api-key"] = key;
    const tools = req.task === "explore" ? TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) : undefined;
    const messages: any[] = [{ role: "user", content: req.prompt }];
    let tokensIn = 0;
    let tokensOut = 0;
    let ctxIn = 0;
    const deadline = Date.now() + req.timeoutSec * 1000;
    const steps = req.task === "explore" ? (req.maxSteps ?? 40) : 1;
    for (let step = 0; step < steps; step++) {
      const body: any = { model: req.model, max_tokens: 8192, system: req.system, messages };
      if (tools) body.tools = tools;
      const j = await post(`${this.ep.base_url}/v1/messages`, body, headers, Math.max(1000, deadline - Date.now()));
      tokensIn += j?.usage?.input_tokens ?? 0;
      tokensOut += j?.usage?.output_tokens ?? 0;
      ctxIn = (j?.usage?.input_tokens ?? 0) + (j?.usage?.cache_read_input_tokens ?? 0);
      const content: any[] = j?.content ?? [];
      const uses = content.filter((b) => b.type === "tool_use");
      if (!uses.length || !tools) {
        const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
        if (!text.trim()) throw new WorkerError(E.WORKER, "worker returned an empty answer");
        return { text, tokensIn, tokensOut, ctxIn, cost: 0 };
      }
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: runTool(u.name, u.input ?? {}, { root: req.cwd, secretGlobs: req.secretGlobs ?? [] }) })),
      });
    }
    throw new WorkerError(E.WORKER, `explore used all ${steps} steps without answering`);
  }
}
