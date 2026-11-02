// `offload hook <host> <event>` — reads the host's hook JSON on stdin and
// answers in that host's dialect. Every failure path prints nothing and exits
// 0, which every host treats as "no opinion" (fail open).
import { bashGuard, available, Host, postBash, readGuard, sessionGuide, Verdict } from "../hooks/logic.ts";
import { readFileSync } from "node:fs";
import { setProjectDir } from "../paths.ts";
import { cfgBool } from "../config.ts";

type J = Record<string, any>;

// One blocking read of the piped payload: the stream API would load Node's
// whole stream/readline machinery (~10 ms) before every tool call. Windows
// pipes and a non-blocking stdin (EAGAIN) use the stream instead.
async function readStdin(): Promise<string> {
  if (process.platform !== "win32") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      // fall through
    }
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const text = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("") : v == null ? "" : JSON.stringify(v));

function preToolOut(host: Host, v: Verdict): J {
  switch (host) {
    // Crush: flat decision; no "ask" — advice is appended to the tool result instead
    case "crush":
      return v.action === "deny" ? { decision: "deny", reason: v.message } : { context: v.message };
    case "cursor":
      // advisory notes must not turn into an approval of the tool call
      if (v.action === "note") return { agent_message: v.message };
      return v.action === "ask"
        ? { permission: "ask", agent_message: v.message, user_message: "offload suggests keeping this large read out of the agent's context." }
        : { permission: "deny", agent_message: v.message, user_message: "offload kept a large read out of the agent's context (see its options)." };
    // Gemini and Codex hooks cannot ask the user: "ask" degrades to advice, not a block
    case "gemini":
      return v.action === "deny" ? { decision: "deny", reason: v.message } : { hookSpecificOutput: { hookEventName: "BeforeTool", additionalContext: v.message } };
    case "codex":
      return v.action === "deny"
        ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: v.message } }
        : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: v.message } };
    default:
      return v.action === "note"
        ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: v.message } }
        : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: v.action, permissionDecisionReason: v.message } };
  }
}

async function handle(host: Host, event: string, input: J): Promise<J | undefined> {
  const cwd: string = input.cwd || input.workspace_roots?.[0] || process.cwd();
  if (cwd) setProjectDir(process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || cwd);
  if (input.agent_id && !cfgBool("hooks.subagents", true)) return undefined;
  const ti: J = input.tool_input ?? {};
  const tool: string = input.tool_name ?? "";

  // Crush's SessionStart output is ignored (the guide goes in via context paths)
  if (event === "session-start" && host === "crush") return undefined;
  if (event === "session-start") {
    const guide = sessionGuide(host);
    if (!(await available())) return undefined;
    if (host === "cursor") return { additional_context: guide };
    if (host === "gemini") return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: guide } };
    return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: guide } };
  }

  if (["pre-read", "pre-bash", "pre-tool", "before-tool"].includes(event)) {
    if (!(await available())) return undefined;
    let v: Verdict | undefined;
    const isRead = event === "pre-read" || /^(Read|read_file|read|view)$/.test(tool);
    const isShell = event === "pre-bash" || /^(Bash|Shell|run_shell_command|shell|exec|bash)$/.test(tool);
    if (isRead) {
      const file = ti.file_path ?? ti.path ?? ti.filePath;
      let offset = num(ti.offset);
      let limit = num(ti.limit);
      if (host === "gemini") {
        offset = num(ti.start_line);
        const end = num(ti.end_line);
        limit = end !== undefined ? end - (offset ?? 1) + 1 : undefined;
      }
      // Crush's view takes a 0-based offset (default limit 200 lines)
      if (host === "crush" && offset !== undefined) offset += 1;
      v = readGuard(host, cwd, file, offset, limit);
    } else if (isShell) {
      v = bashGuard(host, ti.working_directory || cwd, ti.command);
    }
    return v ? preToolOut(host, v) : undefined;
  }

  if (["post-bash", "post-tool", "after-tool"].includes(event)) {
    if (host === "cursor") return undefined; // Cursor cannot replace shell output
    const resp = input.tool_response;
    const output = host === "gemini" ? text(resp?.llmContent ?? resp?.returnDisplay) : host === "codex" || host === "crush" ? text(resp) : [text(resp?.stdout), resp?.stderr ? `[stderr]\n${text(resp.stderr)}` : ""].filter(Boolean).join("\n");
    const d = await postBash({ command: ti.command, output, persistedPath: resp?.persistedOutputPath, description: ti.description, background: ti.run_in_background === true || ti.is_background === true, interrupted: resp?.interrupted === true });
    if (!d) return undefined;
    switch (host) {
      case "codex":
        return { continue: false, stopReason: "offload digested a long command output", reason: d };
      case "crush":
        return { updated_output: d };
      case "gemini":
        return { decision: "deny", reason: `offload: the command ran successfully; its long output was replaced by this digest.\n${d}` };
      default:
        return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: { ...(resp ?? {}), stdout: d, stderr: "" } } };
    }
  }
  return undefined;
}

export async function cmdHook(argv: string[]): Promise<number> {
  const [host = "claude", event = ""] = argv;
  process.env.OFFLOAD_HOST ||= host; // lets @host models resolve to this harness's subscription
  try {
    const raw = await readStdin();
    if (!raw.trim()) return 0;
    const out = await handle(host as Host, event, JSON.parse(raw));
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  } catch (e) {
    if (process.env.OFFLOAD_DEBUG) process.stderr.write(`offload hook: ${(e as Error).stack}\n`);
  }
  return 0;
}
