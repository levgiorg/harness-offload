import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS } from "../assets.ts";
import { cfgBool, cfgInt, cfgList, cfgStr } from "../config.ts";
import { runProcess, spawnDetached, which } from "../proc.ts";
import { stateDir } from "../state.ts";
import { Backend, classify, E, WorkerError, WorkerRequest, WorkerResult } from "./types.ts";

const bin = () => cfgStr("opencode.bin", "opencode");

let majorCache: number | undefined;
/** Major version (1 or 2), cached for an hour per binary like the bash engine. */
export async function opencodeMajor(): Promise<number> {
  if (majorCache) return majorCache;
  const b = bin();
  const cache = join(stateDir(), "opencode-version");
  try {
    if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 3600_000) {
      const [maj, cbin] = readFileSync(cache, "utf8").trim().split(" ");
      if (cbin === b && /^\d+$/.test(maj)) return (majorCache = Number(maj));
    }
  } catch {
    /* ignore */
  }
  const r = await runProcess(b, ["--version"], { timeoutMs: 15_000 });
  const m = (r.stdout.trim().split("\n").pop() || "").match(/(\d+)\./);
  const major = m ? Number(m[1]) : 1;
  if (m) {
    try {
      writeFileSync(cache, `${major} ${b}\n`);
    } catch {
      /* ignore */
    }
  }
  return (majorCache = major);
}

export function resetOpencodeMajor(): void {
  majorCache = undefined;
}

/** OPENCODE_CONFIG_CONTENT with offload's deny-by-default worker agents. */
export function opencodeConfig(major: number, overrides: Partial<Record<string, string>> = {}): Record<string, unknown> {
  // a custom task replaces the instructions of the flow it runs through
  const P = { ...PROMPTS, ...overrides } as typeof PROMPTS;
  let user: Record<string, unknown> = {};
  try {
    const v = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) user = v;
  } catch {
    /* ignore */
  }
  const steps = cfgInt("explore.max_steps", 40);
  const secrets = cfgList("privacy.secret_globs").flatMap((g) => [g, "**/" + g]);
  const merge = (a: any, b: any): any => {
    if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) || Array.isArray(b)) return b;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  };
  if (major >= 2) {
    const v2 = (name: string, system: string) => ({
      mode: "primary", hidden: true, description: name, system,
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    });
    const explore: any = v2("offload read-only explorer", P.explore);
    explore.steps = steps;
    explore.permissions.push(...["read", "grep", "glob"].map((action) => ({ action, resource: "*", effect: "allow" })));
    explore.permissions.push(...secrets.map((resource) => ({ action: "read", resource, effect: "deny" })));
    return merge(user, {
      snapshots: false,
      agents: {
        "offload-read": v2("offload bulk reader", P.read),
        "offload-summarize": v2("offload output digester", P.summarize),
        "offload-write": v2("offload code writer", P.write),
        "offload-ask": v2("offload one-shot helper", P.ask),
        "offload-explore": explore,
      },
    });
  }
  const v1 = (name: string, prompt: string, temperature: number) => ({ mode: "primary", description: name, prompt, temperature, permission: { "*": "deny" } });
  const explore: any = v1("offload read-only explorer", P.explore, 0.1);
  explore.steps = steps;
  explore.permission = { "*": "deny", read: { "*": "allow", ...Object.fromEntries(secrets.map((g) => [g, "deny"])) }, grep: "allow", glob: "allow", list: "allow" };
  return merge(user, {
    snapshot: false,
    agent: {
      "offload-read": v1("offload bulk reader", P.read, 0.1),
      "offload-summarize": v1("offload output digester", P.summarize, 0.1),
      "offload-write": v1("offload code writer", P.write, 0.2),
      "offload-ask": v1("offload one-shot helper", P.ask, 0.3),
      "offload-explore": explore,
    },
  });
}

interface Ev {
  type?: string;
  sessionID?: string;
  part?: { text?: string; tokens?: { input?: number; output?: number; cache?: { read?: number } }; cost?: number };
  error?: { type?: string; name?: string; message?: string; data?: { message?: string } };
}

export function parseEvents(stdout: string): Ev[] {
  return stdout.split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l) as Ev];
    } catch {
      return [];
    }
  });
}

export function finalText(events: Ev[]): string {
  const steps: string[] = [];
  let cur = "";
  for (const e of events) {
    if (e.type === "step_start") {
      steps.push(cur);
      cur = "";
    } else if (e.type === "text") cur += e.part?.text ?? "";
  }
  steps.push(cur);
  return steps.filter((s) => /\S/.test(s)).pop() ?? "";
}

function retries(stdout: string, stderr: string): number {
  const v1 = (stderr.match(/stream error/g) || []).length;
  if (v1 > 0) return v1;
  let open = false;
  let r = 0;
  for (const m of stdout.matchAll(/^\{"type":"(step_start|step_finish)"/gm)) {
    if (m[1] === "step_start") {
      if (open) r++;
      open = true;
    } else open = false;
  }
  return r;
}

function forgetSession(sid: string | undefined, major: number): void {
  if (!sid || cfgBool("opencode.keep_sessions", false)) return;
  const args = major >= 2 ? ["session", "delete", "--standalone", sid] : ["session", "delete", sid];
  spawnDetached(bin(), args, stateDir());
}

export class OpencodeBackend implements Backend {
  readonly kind = "opencode";
  readonly label = "OpenCode CLI";

  async available() {
    const p = await which(bin());
    if (!p) return { ok: false, detail: `opencode not found (${bin()}) — https://opencode.ai` };
    return { ok: true, detail: `${p} (v${await opencodeMajor()})` };
  }

  async models(): Promise<string[]> {
    const r = await runProcess(bin(), ["models"], { timeoutMs: 60_000 });
    return r.stdout.split("\n").map((s) => s.trim()).filter((s) => /^[\w.-]+\/\S+$/.test(s));
  }

  async run(req: WorkerRequest): Promise<WorkerResult> {
    if (!(await which(bin()))) throw new WorkerError(E.MISSING, `opencode CLI not found (${bin()}). Install it from https://opencode.ai, or set opencode.bin in the config.`);
    const major = await opencodeMajor();
    const agent = `offload-${req.task}`;
    const args = ["run", "--format", "json", "--agent", agent, "--title", `offload:${req.task}`];
    if (major >= 2) {
      args.push("--standalone");
      if (req.model) args.push("-m", req.variant ? `${req.model}#${req.variant}` : req.model);
    } else {
      args.push("--print-logs", "--log-level", "ERROR");
      if (req.model) args.push("-m", req.model);
      if (req.variant) args.push("--variant", req.variant);
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(major, req.system !== PROMPTS[req.task] ? { [req.task]: req.system } : {})),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OFFLOAD_DISABLE: "1",
      PWD: req.cwd,
    };
    if (cfgBool("opencode.disable_claude_code_compat", true)) env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
    const maxErr = cfgInt("opencode.max_stream_errors", 2);
    const r = await runProcess(bin(), args, {
      input: req.prompt,
      cwd: req.cwd,
      env,
      timeoutMs: req.timeoutSec * 1000,
      watchdog: (out, err) => (retries(out, err) >= maxErr ? "retries" : undefined),
    });
    const events = parseEvents(r.stdout);
    const sid = events.find((e) => e.sessionID)?.sessionID || (r.stderr.match(/session\.id=(ses_[A-Za-z0-9]+)/) || [])[1];
    forgetSession(sid, major);

    if (r.timedOut) throw new WorkerError(E.TIMEOUT, `timed out after ${req.timeoutSec}s`);
    if (r.killedBy === "retries") {
      const msg = (r.stderr.match(/error\.error="([^"]*)"/g) || []).pop()?.replace(/^error\.error="|"$/g, "");
      const why = `provider kept failing and retrying (${retries(r.stdout, r.stderr)} retries): ${msg || "likely rate limit, quota or overload"}`;
      throw new WorkerError(classify(msg || "rate limit"), why);
    }
    const err = events.filter((e) => e.type === "error").pop();
    if (err || r.code !== 0) {
      let msg = err ? `${err.error?.type ?? err.error?.name ?? "error"}: ${err.error?.message ?? err.error?.data?.message ?? JSON.stringify(err.error)}` : "";
      if (!msg) msg = (r.stderr.match(/level=ERROR.*error="([^"]*)"/) || [])[1] || r.stderr.split("\n").filter((l) => !l.startsWith("timestamp=")).join("\n").slice(-400);
      if (/nknown argument|nknown option|nknown flag|nrecognized/.test(msg)) {
        resetOpencodeMajor();
        try {
          writeFileSync(join(stateDir(), "opencode-version"), "");
        } catch {
          /* ignore */
        }
        msg += " (opencode version changed? cleared the cache — run again)";
      }
      if (/Unexpected server error/.test(msg)) throw new WorkerError(E.MODEL, `${msg} (V1 reports unknown model ids this way — check \`opencode models\`)`);
      if (/Agent not found/.test(msg)) throw new WorkerError(E.WORKER, `${msg} (opencode ignored offload's agent config — run \`offload doctor\`)`);
      throw new WorkerError(classify(msg || `exit ${r.code}`), msg || `opencode exited with status ${r.code}`);
    }
    const text = finalText(events);
    if (!text) throw new WorkerError(E.WORKER, "worker returned an empty answer");
    const fin = events.filter((e) => e.type === "step_finish").map((e) => e.part ?? {});
    const last = fin[fin.length - 1];
    return {
      text,
      tokensIn: fin.reduce((s, p) => s + (p.tokens?.input ?? 0), 0),
      tokensOut: fin.reduce((s, p) => s + (p.tokens?.output ?? 0), 0),
      ctxIn: last ? (last.tokens?.input ?? 0) + (last.tokens?.cache?.read ?? 0) : 0,
      cost: fin.reduce((s, p) => s + (p.cost ?? 0), 0),
    };
  }
}
