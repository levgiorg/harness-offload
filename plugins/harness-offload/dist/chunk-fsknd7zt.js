import {
  CONNECTORS,
  runProcess2,
  which2
} from "./chunk-31bdmre5.js";
import {
  cfg2,
  cfgStr2
} from "./chunk-t2kssrkb.js";
import {
  endpoint2,
  endpointNames2,
  apiKey2,
  HttpBackend2
} from "./chunk-ay6k04v0.js";
import {
  E,
  WorkerError,
  classify,
  workDir2,
  OpencodeBackend
} from "./chunk-9wbe25j8.js";

// src/backends/agents.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var jsonLines = (s) => s.split(`
`).flatMap((l) => {
  const t = l.trim();
  if (!t.startsWith("{"))
    return [];
  try {
    return [JSON.parse(t)];
  } catch {
    return [];
  }
});
function errSummary(text) {
  const lines = text.split(`
`).map((l) => l.trim()).filter(Boolean);
  if (!lines.length)
    return "";
  const first = lines[0];
  const last = lines[lines.length - 1];
  return (last !== first ? `${first} … ${last}` : first).slice(0, 400);
}
var lastJson = (s) => {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = jsonLines(t);
    if (lines.length)
      return lines[lines.length - 1];
    const ls = t.split(`
`);
    for (let i = ls.length - 1;i >= 0; i--) {
      if (!ls[i].startsWith("{"))
        continue;
      try {
        return JSON.parse(ls.slice(i).join(`
`));
      } catch {}
    }
    return;
  }
};
var empty = (text, extra = {}) => ({ text, tokensIn: 0, tokensOut: 0, ctxIn: 0, cost: 0, ...extra });
var CRUSH_TOOLS = ["agent", "bash", "crush_info", "crush_logs", "job_output", "job_kill", "download", "edit", "multiedit", "lsp_diagnostics", "lsp_references", "lsp_restart", "lsp_symbols", "lsp_definition", "lsp_call_hierarchy", "lsp_rename", "lsp_replace_symbol", "fetch", "agentic_fetch", "glob", "grep", "ls", "question", "sourcegraph", "todos", "view", "write", "list_mcp_resources", "read_mcp_resource"];
function crushLockdown() {
  const dir = process.env.CRUSH_GLOBAL_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "crush");
  const mcp = {};
  try {
    for (const name of Object.keys(JSON.parse(readFileSync(join(dir, "crush.json"), "utf8")).mcp ?? {}))
      mcp[name] = { disabled: true };
  } catch {}
  return { options: { disabled_tools: CRUSH_TOOLS }, ...Object.keys(mcp).length ? { mcp } : {} };
}
var merged = (req) => `<instructions>
${req.system}
</instructions>

${req.prompt}`;
var CLI_AGENTS = {
  claude: {
    label: "Claude Code (claude -p) — your Claude plan (Haiku)",
    models: async () => ["haiku", "sonnet"],
    bin: "claude",
    install: "https://claude.com/claude-code",
    args: (req) => {
      const a = ["-p", "--output-format", "json", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", req.system];
      if (req.model)
        a.push("--model", req.model);
      if (req.task === "explore") {
        a.push("--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob");
        const deny = (req.secretGlobs ?? []).map((g) => `Read(**/${g})`).join(",");
        if (deny)
          a.push("--disallowedTools", deny);
      } else
        a.push("--tools", "");
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j)
        throw new WorkerError(E.WORKER, "claude: no JSON output");
      if (j.is_error)
        throw new WorkerError(classify(String(j.result ?? j.error ?? "error")), `claude: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      const tin = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      return empty(String(j.result ?? ""), { tokensIn: tin, tokensOut: u.output_tokens ?? 0, ctxIn: tin, cost: j.total_cost_usd ?? 0 });
    }
  },
  codex: {
    label: "OpenAI Codex CLI (codex exec) — ChatGPT plan",
    models: async () => ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"],
    bin: "codex",
    install: "npm i -g @openai/codex  (then: codex login)",
    args: (req) => {
      const a = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--disable", "hooks", "--ignore-rules", "-C", req.cwd];
      if (req.model)
        a.push("-m", req.model);
      if (req.variant)
        a.push("-c", `model_reasoning_effort="${req.variant}"`);
      a.push("-");
      return { args: a, input: merged(req) };
    },
    parse: (out) => {
      let text = "";
      let tin = 0;
      let tout = 0;
      let failure = "";
      for (const e of jsonLines(out)) {
        const item = e.item ?? {};
        if (e.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string")
          text = item.text;
        if (e.type === "turn.completed" && e.usage) {
          tin += (e.usage.input_tokens ?? 0) + (e.usage.cached_input_tokens ?? 0);
          tout += e.usage.output_tokens ?? 0;
        }
        if (e.type === "turn.failed")
          failure = e.error?.message ?? JSON.stringify(e.error ?? e);
        if (e.type === "error" && typeof e.message === "string" && !failure)
          failure = e.message;
      }
      if (!text.trim() && failure)
        throw new WorkerError(classify(failure), `codex: ${failure}`);
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    }
  },
  gemini: {
    label: "Gemini CLI (gemini -p) — Google account",
    models: async () => ["flash-lite", "flash", "pro"],
    bin: "gemini",
    install: "npm i -g @google/gemini-cli",
    args: (req) => {
      const a = ["-o", "json", "--approval-mode", "plan", "--skip-trust", "-e", "none"];
      if (req.model)
        a.push("-m", req.model);
      a.push("-p", "Answer as instructed above.");
      return { args: a, input: req.prompt };
    },
    env: (req, dir) => {
      const file = join(dir, `gemini-system-${req.task}.md`);
      writeFileSync(file, req.system);
      return { GEMINI_SYSTEM_MD: file, GEMINI_CLI_TRUST_WORKSPACE: "true" };
    },
    parse: (out, err) => {
      const j = lastJson(out) ?? lastJson(err);
      if (!j)
        throw new WorkerError(E.WORKER, "gemini: no JSON output");
      if (j.error) {
        const code = j.error.code === 41 ? E.AUTH : classify(String(j.error.message ?? j.error.type ?? ""));
        throw new WorkerError(code, `gemini: ${j.error.message ?? JSON.stringify(j.error)}`);
      }
      let tin = 0;
      let tout = 0;
      for (const m of Object.values(j.stats?.models ?? {})) {
        tin += m?.tokens?.prompt ?? m?.tokens?.input ?? 0;
        tout += m?.tokens?.candidates ?? m?.tokens?.output ?? 0;
      }
      return empty(String(j.response ?? ""), { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    },
    exitCode: (code) => code === 41 ? E.AUTH : code === 53 ? E.WORKER : undefined
  },
  pi: {
    label: "Pi coding agent (pi -p) — its logins and API keys",
    models: async () => {
      const r = await runProcess2(cfgStr2("agents.pi.bin", "pi"), ["--list-models"], { timeoutMs: 30000 });
      return r.stdout.split(`
`).slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && c[0] && c[1]).map((c) => `${c[0]}/${c[1]}`);
    },
    bin: "pi",
    install: "npm i -g @earendil-works/pi-coding-agent",
    args: (req) => {
      const a = ["-p", "--mode", "json", "--no-session", "-na", "-ne", "-ns", "-nc", "--no-mcp", "--system-prompt", req.system];
      if (req.task === "explore")
        a.push("--tools", "read,grep,find,ls");
      else
        a.push("--no-tools");
      if (req.model)
        a.push("--model", req.variant ? `${req.model}:${req.variant}` : req.model);
      a.push(`

Answer as instructed above.`);
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      let text = "";
      let tin = 0;
      let tout = 0;
      let cost = 0;
      for (const e of jsonLines(out)) {
        const m = e.message ?? {};
        if (e.type !== "message_end" || m.role !== "assistant")
          continue;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          const msg = String(m.errorMessage ?? m.stopReason);
          throw new WorkerError(classify(msg), `pi: ${msg}`);
        }
        const t = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (t.trim())
          text = t;
        const u = m.usage ?? {};
        tin = Math.max(tin, (u.input ?? 0) + (u.cacheRead ?? 0));
        tout += u.output ?? 0;
        cost += u.cost?.total ?? 0;
      }
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin, cost });
    }
  },
  copilot: {
    label: "GitHub Copilot CLI (copilot) — your Copilot plan",
    bin: "copilot",
    install: "npm i -g @github/copilot  (then run copilot once and /login)",
    args: (req) => {
      const a = ["--output-format", "json", "-s", "--no-custom-instructions", "--no-ask-user", "--disable-builtin-mcps", "--no-auto-update"];
      if (req.model)
        a.push("--model", req.model);
      if (req.variant)
        a.push("--reasoning-effort", req.variant);
      if (req.task === "explore")
        a.push("--allow-all-tools", "--available-tools", "view", "grep", "glob");
      else
        a.push("--available-tools", "none");
      return { args: a, input: merged(req) };
    },
    parse: (out) => {
      let text = "";
      let failure = "";
      for (const e of jsonLines(out)) {
        if (e.type === "assistant.message" && typeof e.data?.content === "string" && e.data.content.trim())
          text = e.data.content;
        if (e.type === "session.error")
          failure = `${e.data?.errorType ?? ""} ${e.data?.message ?? ""}`.trim();
      }
      if (!text.trim() && failure)
        throw new WorkerError(classify(failure), `copilot: ${failure}`);
      return empty(text);
    }
  },
  qwen: {
    label: "Qwen Code (qwen) — your Qwen account or keys",
    bin: "qwen",
    install: "npm i -g @qwen-code/qwen-code  (then run qwen once and /auth)",
    args: (req) => {
      const a = ["--output-format", "json", "--system-prompt", req.system, "--approval-mode", "plan", "--chat-recording", "false", "-e", "none"];
      if (req.model)
        a.push("-m", req.model);
      a.push("--core-tools", ...req.task === "explore" ? ["read_file", "grep_search", "glob"] : ["none"]);
      a.push("--", "Answer as instructed above.");
      return { args: a, input: req.prompt };
    },
    env: (req, dir) => {
      const file = join(dir, "qwen-worker-settings.json");
      writeFileSync(file, JSON.stringify({ memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false } }));
      return { QWEN_CODE_SYSTEM_SETTINGS_PATH: file };
    },
    parse: (out) => {
      let events = [];
      try {
        const j = JSON.parse(out.trim());
        events = Array.isArray(j) ? j : [j];
      } catch {
        events = jsonLines(out);
      }
      const r = [...events].reverse().find((e) => e?.type === "result");
      if (!r)
        throw new WorkerError(E.WORKER, "qwen: no result in its output");
      if (r.is_error) {
        const msg = String(r.result ?? r.error?.message ?? r.error ?? "error");
        throw new WorkerError(classify(msg), `qwen: ${msg}`);
      }
      const u = r.usage ?? {};
      const tin = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      return empty(String(r.result ?? ""), { tokensIn: tin, tokensOut: u.output_tokens ?? 0, ctxIn: tin });
    }
  },
  crush: {
    label: "Crush (crush run) — your Crush providers",
    bin: "crush",
    install: "brew install charmbracelet/tap/crush  or  npm i -g @charmland/crush",
    args: (req) => {
      if (req.task === "explore")
        throw new WorkerError(E.USAGE, "crush: `crush run` approves every tool call, so it is not used as a read-only explorer; the next model in the chain takes over");
      const a = ["run", "-q"];
      if (req.model)
        a.push("-m", req.model);
      if (req.variant)
        a.push("--reasoning-effort", req.variant);
      a.push("Answer as instructed above.");
      return { args: a, input: merged(req) };
    },
    env: (req) => {
      writeFileSync(join(req.cwd, ".crush.json"), JSON.stringify(crushLockdown()));
      return {};
    },
    parse: (out) => empty(out.trim())
  },
  cursor: {
    label: "Cursor CLI (cursor-agent -p) — Cursor plan",
    bin: "cursor-agent",
    install: "curl https://cursor.com/install -fsS | bash  (then: cursor-agent login)",
    args: (req) => {
      const a = ["-p", "--output-format", "json", "--mode", "ask", "--trust", "--workspace", req.cwd];
      if (req.model)
        a.push("--model", req.model);
      a.push(merged(req));
      return { args: a, input: "" };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j)
        throw new WorkerError(E.WORKER, "cursor-agent: no JSON output");
      if (j.is_error)
        throw new WorkerError(classify(String(j.result ?? "error")), `cursor-agent: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      const tin = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0);
      return empty(String(j.result ?? ""), { tokensIn: tin, tokensOut: u.outputTokens ?? 0, ctxIn: tin });
    }
  }
};
function cliAgentBackend(name) {
  const spec = CLI_AGENTS[name];
  const bin = () => cfgStr2(`agents.${name}.bin`, spec.bin);
  return {
    kind: name,
    label: spec.label,
    models: spec.models,
    async available() {
      const p = await which2(bin());
      return p ? { ok: true, detail: p } : { ok: false, detail: `${bin()} not found — ${spec.install}` };
    },
    async run(req) {
      if (!await which2(bin()))
        throw new WorkerError(E.MISSING, `${bin()} not found — install: ${spec.install}`);
      const { args, input } = spec.args(req);
      const env = { ...process.env, OFFLOAD_DISABLE: "1", ...spec.env ? spec.env(req, workDir2()) : {} };
      const r = await runProcess2(bin(), args, { input, cwd: req.cwd, env, timeoutMs: req.timeoutSec * 1000 });
      if (r.timedOut)
        throw new WorkerError(E.TIMEOUT, `timed out after ${req.timeoutSec}s`);
      const mapped = spec.exitCode?.(r.code);
      let res;
      try {
        res = spec.parse(r.stdout, r.stderr);
      } catch (e) {
        if (e instanceof WorkerError && e.code === E.WORKER && r.code !== 0 && /no (json|result)/i.test(e.message)) {
          const tail = errSummary(r.stderr);
          if (tail)
            throw new WorkerError(mapped ?? classify(tail), `${name}: ${tail}`);
        }
        if (e instanceof WorkerError)
          throw mapped !== undefined && e.code === E.WORKER ? new WorkerError(mapped, e.message) : e;
        throw new WorkerError(mapped ?? E.WORKER, `${name}: ${e.message}`);
      }
      if (!res.text.trim()) {
        const msg = errSummary(r.stderr || r.stdout);
        throw new WorkerError(mapped ?? (r.code !== 0 ? classify(msg) : E.WORKER), `${name}: ${msg || "empty answer"}`);
      }
      return res;
    }
  };
}

// src/backends/registry.ts
var LOCAL = new Set(["opencode", ...Object.keys(CLI_AGENTS)]);
function detectHost() {
  const e = process.env;
  if (e.OFFLOAD_HOST)
    return e.OFFLOAD_HOST;
  if (e.COPILOT_CLI === "1")
    return "copilot";
  if (e.QWEN_CODE_SESSION_ID || e.QWEN_PROJECT_DIR)
    return "qwen";
  if (e.CRUSH === "1" || e.CRUSH_SESSION_ID)
    return "crush";
  if (e.CLAUDECODE === "1" || e.CLAUDE_CODE_ENTRYPOINT)
    return "claude";
  if (e.CODEX_THREAD_ID || e.CODEX_SANDBOX || e.CODEX_CI)
    return "codex";
  if (e.CURSOR_AGENT || e.CURSOR_CONVERSATION_ID)
    return "cursor";
  if (e.GEMINI_CLI === "1" || e.GEMINI_SESSION_ID)
    return "gemini";
  if (e.OPENCODE === "1" || e.OPENCODE_SESSION_ID)
    return "opencode";
  if (e.PI_CODING_AGENT === "1" || e.PI_SESSION_ID)
    return "pi";
  return;
}
function hostModel(host = detectHost()) {
  if (!host)
    return;
  const own = cfg2(`host_models.${host}`);
  if (typeof own === "string")
    return own;
  return CONNECTORS.host_models[host];
}
function hostApiModel(host = detectHost()) {
  if (!host)
    return;
  const own = cfg2(`host_api_models.${host}`);
  if (typeof own === "string")
    return own || undefined;
  return CONNECTORS.host_api_models?.[host];
}
function parseRef(ref) {
  const def = cfgStr2("backend", "opencode");
  if (ref === "@host" || ref === "@self") {
    const m = hostModel();
    if (m === undefined)
      throw new Error("@host: cannot tell which agent harness is calling (set OFFLOAD_HOST=claude|codex|gemini|cursor|pi|opencode)");
    if (m === "@host" || m === "@self")
      return { backend: def, model: "", ref: "@default" };
    return parseRef(m);
  }
  if (ref === "@host-api") {
    const h = detectHost();
    if (!h)
      throw new Error("@host-api: cannot tell which agent harness is calling (set OFFLOAD_HOST)");
    const m = hostApiModel(h);
    if (!m || m.startsWith("@"))
      throw new Error(`@host-api: ${h} has no API-key backup (set host_api_models.${h} to a BACKEND:MODEL)`);
    const name = m.slice(0, m.indexOf(":"));
    const ep = endpoint2(name);
    if (ep && !/127\.0\.0\.1|localhost/.test(ep.base_url) && !apiKey2(ep)) {
      throw new Error(`@host-api: no API key for ${name} yet (offload key ${name}, or export ${ep.api_key_env ?? "its key"})`);
    }
    return parseRef(m);
  }
  if (!ref || ref === "@default")
    return { backend: def, model: "", ref: "@default" };
  const i = ref.indexOf(":");
  if (i > 0) {
    const prefix = ref.slice(0, i);
    if (LOCAL.has(prefix) || endpointNames2().includes(prefix))
      return { backend: prefix, model: ref.slice(i + 1), ref };
  }
  return { backend: def, model: ref, ref };
}
var cache = new Map;
function backendFor(name) {
  if (cache.has(name))
    return cache.get(name);
  let b;
  if (name === "opencode")
    b = new OpencodeBackend;
  else if (name in CLI_AGENTS)
    b = cliAgentBackend(name);
  else {
    const ep = endpoint2(name);
    if (ep)
      b = new HttpBackend2(ep);
  }
  if (b)
    cache.set(name, b);
  return b;
}
function allBackendNames() {
  return ["opencode", ...Object.keys(CLI_AGENTS), ...endpointNames2()];
}

export { CLI_AGENTS, detectHost, hostModel, hostApiModel, parseRef, backendFor, allBackendNames };
