// Other coding-agent CLIs used as workers ("connectors"): each is run
// headless, prompt on stdin where supported, with tools off (or read-only for
// explore), and its JSON output parsed for the final answer.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfgStr } from "../config.ts";
import { workDir } from "../state.ts";
import { runProcess, which } from "../proc.ts";
import { Backend, classify, E, WorkerError, WorkerRequest, WorkerResult } from "./types.ts";

interface AgentSpec {
  label: string;
  /** Model ids to suggest in the setup wizard (or a way to list them). */
  models?: () => Promise<string[]>;
  bin: string;
  install: string;
  args(req: WorkerRequest): { args: string[]; input: string };
  parse(stdout: string, stderr: string): WorkerResult;
  /** Extra environment (may write files into dir, a scratch directory). */
  env?(req: WorkerRequest, dir: string): Record<string, string>;
  /** Maps a CLI's own exit codes to offload's. */
  exitCode?(code: number | null): number | undefined;
}

const jsonLines = (s: string): any[] =>
  s.split("\n").flatMap((l) => {
    const t = l.trim();
    if (!t.startsWith("{")) return [];
    try {
      return [JSON.parse(t)];
    } catch {
      return [];
    }
  });

const lastJson = (s: string): any => {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = jsonLines(t);
    if (lines.length) return lines[lines.length - 1];
    // pretty-printed JSON after some log lines: parse from the last line that opens an object
    const ls = t.split("\n");
    for (let i = ls.length - 1; i >= 0; i--) {
      if (!ls[i].startsWith("{")) continue;
      try {
        return JSON.parse(ls.slice(i).join("\n"));
      } catch {
        /* keep looking */
      }
    }
    return undefined;
  }
};

const empty = (text: string, extra: Partial<WorkerResult> = {}): WorkerResult => ({ text, tokensIn: 0, tokensOut: 0, ctxIn: 0, cost: 0, ...extra });

/** Combined system + user prompt for CLIs without a system-prompt flag. */
const merged = (req: WorkerRequest) => `<instructions>\n${req.system}\n</instructions>\n\n${req.prompt}`;

export const CLI_AGENTS: Record<string, AgentSpec> = {
  claude: {
    label: "Claude Code (claude -p) — your Claude plan (Haiku)",
    models: async () => ["haiku", "sonnet"],
    bin: "claude",
    install: "https://claude.com/claude-code",
    args: (req) => {
      // A lean headless Claude on the user's own plan: no settings/plugins/MCP/
      // slash commands, our system prompt instead of Claude Code's (~1.3K tokens
      // of overhead instead of ~20K). Not --bare: it never reads OAuth logins.
      const a = ["-p", "--output-format", "json", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", req.system];
      if (req.model) a.push("--model", req.model);
      if (req.task === "explore") {
        a.push("--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob");
        // secret files stay unreadable for the worker too (Read rules cover Grep/Glob)
        const deny = (req.secretGlobs ?? []).map((g) => `Read(**/${g})`).join(",");
        if (deny) a.push("--disallowedTools", deny);
      } else a.push("--tools", "");
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j) throw new WorkerError(E.WORKER, "claude: no JSON output");
      if (j.is_error) throw new WorkerError(classify(String(j.result ?? j.error ?? "error")), `claude: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      return empty(String(j.result ?? ""), {
        tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        tokensOut: u.output_tokens ?? 0,
        cost: j.total_cost_usd ?? 0,
      });
    },
  },
  codex: {
    label: "OpenAI Codex CLI (codex exec) — ChatGPT plan",
    models: async () => ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"],
    bin: "codex",
    install: "npm i -g @openai/codex  (then: codex login)",
    args: (req) => {
      // read-only sandbox, no hooks (no recursion into offload), nothing saved
      const a = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--disable", "hooks", "--ignore-rules", "-C", req.cwd];
      if (req.model) a.push("-m", req.model);
      if (req.variant) a.push("-c", `model_reasoning_effort="${req.variant}"`);
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
        if (e.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") text = item.text;
        if (e.type === "turn.completed" && e.usage) {
          tin += (e.usage.input_tokens ?? 0) + (e.usage.cached_input_tokens ?? 0);
          tout += e.usage.output_tokens ?? 0;
        }
        if (e.type === "turn.failed") failure = e.error?.message ?? JSON.stringify(e.error ?? e);
        // "Reconnecting... n/5" errors are transient; keep the last one in case the turn fails
        if (e.type === "error" && typeof e.message === "string" && !failure) failure = e.message;
      }
      if (!text.trim() && failure) throw new WorkerError(classify(failure), `codex: ${failure}`);
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    },
  },
  gemini: {
    label: "Gemini CLI (gemini -p) — Google account",
    models: async () => ["flash-lite", "flash", "pro"],
    bin: "gemini",
    install: "npm i -g @google/gemini-cli",
    args: (req) => {
      // stdin + the -p text form the prompt; plan mode is read-only; no extensions;
      // the system prompt is replaced through GEMINI_SYSTEM_MD (see env below).
      const a = ["-o", "json", "--approval-mode", "plan", "--skip-trust", "-e", "none"];
      if (req.model) a.push("-m", req.model);
      a.push("-p", "Answer as instructed above.");
      return { args: a, input: req.prompt };
    },
    env: (req, dir) => {
      const file = join(dir, `gemini-system-${req.task}.md`);
      writeFileSync(file, req.system);
      return { GEMINI_SYSTEM_MD: file, GEMINI_CLI_TRUST_WORKSPACE: "true" };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j) throw new WorkerError(E.WORKER, "gemini: no JSON output");
      if (j.error) {
        const code = j.error.code === 41 ? E.AUTH : classify(String(j.error.message ?? j.error.type ?? ""));
        throw new WorkerError(code, `gemini: ${j.error.message ?? JSON.stringify(j.error)}`);
      }
      let tin = 0;
      let tout = 0;
      for (const m of Object.values<any>(j.stats?.models ?? {})) {
        tin += m?.tokens?.prompt ?? m?.tokens?.input ?? 0;
        tout += m?.tokens?.candidates ?? m?.tokens?.output ?? 0;
      }
      return empty(String(j.response ?? ""), { tokensIn: tin, tokensOut: tout, ctxIn: tin });
    },
    exitCode: (code) => (code === 41 ? E.AUTH : code === 53 ? E.WORKER : undefined),
  },
  pi: {
    label: "Pi coding agent (pi -p) — its logins and API keys",
    models: async () => {
      const r = await runProcess(cfgStr("agents.pi.bin", "pi"), ["--list-models"], { timeoutMs: 30_000 });
      return r.stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && c[0] && c[1]).map((c) => `${c[0]}/${c[1]}`);
    },
    bin: "pi",
    install: "npm i -g @earendil-works/pi-coding-agent",
    args: (req) => {
      // piped stdin is prepended to the prompt argument
      const a = ["-p", "--mode", "json", "--no-session", "-na", "-ne", "-ns", "-nc", "--no-mcp", "--system-prompt", req.system];
      if (req.task === "explore") a.push("--tools", "read,grep,find,ls");
      else a.push("--no-tools");
      if (req.model) a.push("--model", req.variant ? `${req.model}:${req.variant}` : req.model);
      a.push("\n\nAnswer as instructed above.");
      return { args: a, input: req.prompt };
    },
    parse: (out) => {
      let text = "";
      let tin = 0;
      let tout = 0;
      let cost = 0;
      for (const e of jsonLines(out)) {
        const m = e.message ?? {};
        if (e.type !== "message_end" || m.role !== "assistant") continue;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          const msg = String(m.errorMessage ?? m.stopReason);
          throw new WorkerError(classify(msg), `pi: ${msg}`);
        }
        const t = (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
        if (t.trim()) text = t;
        const u = m.usage ?? {};
        tin = Math.max(tin, (u.input ?? 0) + (u.cacheRead ?? 0));
        tout += u.output ?? 0;
        cost += u.cost?.total ?? 0;
      }
      return empty(text, { tokensIn: tin, tokensOut: tout, ctxIn: tin, cost });
    },
  },
  cursor: {
    label: "Cursor CLI (cursor-agent -p) — Cursor plan",
    bin: "cursor-agent",
    install: "curl https://cursor.com/install -fsS | bash  (then: cursor-agent login)",
    args: (req) => {
      // ask mode is read-only; the prompt travels as an argument
      const a = ["-p", "--output-format", "json", "--mode", "ask", "--trust", "--workspace", req.cwd];
      if (req.model) a.push("--model", req.model);
      a.push(merged(req));
      return { args: a, input: "" };
    },
    parse: (out) => {
      const j = lastJson(out);
      if (!j) throw new WorkerError(E.WORKER, "cursor-agent: no JSON output");
      if (j.is_error) throw new WorkerError(classify(String(j.result ?? "error")), `cursor-agent: ${j.result ?? "error"}`);
      const u = j.usage ?? {};
      return empty(String(j.result ?? ""), { tokensIn: (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0), tokensOut: u.outputTokens ?? 0, ctxIn: u.inputTokens ?? 0 });
    },
  },
};

export function cliAgentBackend(name: string): Backend {
  const spec = CLI_AGENTS[name];
  const bin = () => cfgStr(`agents.${name}.bin`, spec.bin);
  return {
    kind: name,
    label: spec.label,
    models: spec.models,
    async available() {
      const p = await which(bin());
      return p ? { ok: true, detail: p } : { ok: false, detail: `${bin()} not found — ${spec.install}` };
    },
    async run(req: WorkerRequest): Promise<WorkerResult> {
      if (!(await which(bin()))) throw new WorkerError(E.MISSING, `${bin()} not found — install: ${spec.install}`);
      const { args, input } = spec.args(req);
      // OFFLOAD_DISABLE: a worker agent must not run offload's own hooks (recursion).
      const env = { ...process.env, OFFLOAD_DISABLE: "1", ...(spec.env ? spec.env(req, workDir()) : {}) };
      const r = await runProcess(bin(), args, { input, cwd: req.cwd, env, timeoutMs: req.timeoutSec * 1000 });
      if (r.timedOut) throw new WorkerError(E.TIMEOUT, `timed out after ${req.timeoutSec}s`);
      const mapped = spec.exitCode?.(r.code);
      let res: WorkerResult;
      try {
        res = spec.parse(r.stdout, r.stderr);
      } catch (e) {
        // the CLI's own exit code is more precise than our message heuristics
        if (e instanceof WorkerError) throw mapped !== undefined && e.code === E.WORKER ? new WorkerError(mapped, e.message) : e;
        throw new WorkerError(mapped ?? E.WORKER, `${name}: ${(e as Error).message}`);
      }
      if (!res.text.trim()) {
        const msg = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300);
        throw new WorkerError(mapped ?? (r.code !== 0 ? classify(msg) : E.WORKER), `${name}: ${msg || "empty answer"}`);
      }
      return res;
    },
  };
}
