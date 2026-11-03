import"./chunk-tned9mwv.js";
import {
  setProjectDir2,
  cfgBool2
} from "./chunk-ef4mr3b8.js";
import"./chunk-cmz9w18w.js";
import {
  seenForget2
} from "./chunk-6m0yhkpr.js";
import"./chunk-e2041jj4.js";
import"./chunk-vds884vc.js";
import"./chunk-p5yk4pzb.js";
import {
  PAUSED_MESSAGE2,
  welcomeMessage2,
  firstSession2,
  available2,
  readGuard2,
  autowrap2,
  bashGuard2,
  postBash2,
  sessionGuide2
} from "./chunk-bsnx1p0e.js";
import"./chunk-g3ebay9r.js";

// src/commands/hook.ts
import { readFileSync } from "node:fs";
async function readStdin() {
  if (process.platform !== "win32") {
    try {
      return readFileSync(0, "utf8");
    } catch {}
  }
  const chunks = [];
  for await (const c of process.stdin)
    chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
var text = (v) => typeof v === "string" ? v : Array.isArray(v) ? v.map((p) => typeof p === "string" ? p : p?.text ?? "").join("") : v == null ? "" : JSON.stringify(v);
function preToolOut(host, v) {
  switch (host) {
    case "crush":
      return v.action === "deny" ? { decision: "deny", reason: v.message } : { context: v.message };
    case "cursor":
      if (v.action === "note")
        return { agent_message: v.message };
      return v.action === "ask" ? { permission: "ask", agent_message: v.message, user_message: "offload suggests keeping this large read out of the agent's context." } : { permission: "deny", agent_message: v.message, user_message: "offload kept a large read out of the agent's context (see its options)." };
    case "gemini":
      if (v.action === "deny")
        return { decision: "deny", reason: v.message };
      return v.action === "ask" ? { decision: "ask", systemMessage: v.message } : undefined;
    case "codex":
      return v.action === "deny" ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: v.message } } : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: v.message } };
    default:
      return v.action === "note" ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: v.message } } : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: v.action, permissionDecisionReason: v.message } };
  }
}
async function handle(host, event, input) {
  const cwd = input.cwd || input.workspace_roots?.[0] || process.cwd();
  if (cwd)
    setProjectDir2(process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || cwd);
  if (input.agent_id && !cfgBool2("hooks.subagents", true))
    return;
  const ti = input.tool_input ?? {};
  const tool = input.tool_name ?? "";
  if (event === "session-start" && (input.source === "compact" || input.source === "clear"))
    seenForget2(input.session_id);
  if (event === "session-start" && host === "crush")
    return;
  if (event === "session-start") {
    const guide = sessionGuide2(host);
    const userFacing = host === "claude" && input.source === "startup";
    if (!await available2())
      return userFacing ? { systemMessage: PAUSED_MESSAGE2 } : undefined;
    if (host === "cursor")
      return { additional_context: guide };
    if (host === "gemini")
      return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: guide } };
    const out = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: guide } };
    if (userFacing && firstSession2())
      out.systemMessage = welcomeMessage2();
    return out;
  }
  if (["pre-read", "pre-bash", "pre-tool", "before-tool"].includes(event)) {
    if (!await available2())
      return;
    let v;
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
      if (host === "crush" && offset !== undefined)
        offset += 1;
      v = readGuard2(host, cwd, file, offset, limit, typeof input.transcript_path === "string" ? input.transcript_path : undefined);
    } else if (isShell) {
      v = bashGuard2(host, ti.dir_path || ti.working_directory || cwd, ti.command);
      if (!v && host === "claude") {
        const w = autowrap2(ti.command, ti.run_in_background === true);
        if (w)
          return { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...ti, command: w } } };
      }
    }
    return v ? preToolOut(host, v) : undefined;
  }
  if (["post-bash", "post-tool", "after-tool"].includes(event)) {
    if (host === "cursor")
      return;
    const resp = input.tool_response;
    const output = host === "gemini" ? text(resp?.llmContent ?? resp?.returnDisplay) : host === "codex" || host === "crush" ? text(resp) : [text(resp?.stdout), resp?.stderr ? `[stderr]
${text(resp.stderr)}` : ""].filter(Boolean).join(`
`);
    const d = await postBash2({ command: ti.command, output, persistedPath: resp?.persistedOutputPath, description: ti.description, background: ti.run_in_background === true || ti.is_background === true, interrupted: resp?.interrupted === true, session: typeof input.session_id === "string" ? input.session_id : undefined });
    if (!d)
      return;
    switch (host) {
      case "codex":
        return { continue: false, stopReason: "offload digested a long command output", reason: d };
      case "crush":
        return { updated_output: d };
      case "gemini":
        return { decision: "deny", reason: `offload: the command ran successfully; its long output was replaced by this digest.
${d}` };
      default:
        return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: { ...resp ?? {}, stdout: d, stderr: "" } } };
    }
  }
  return;
}
async function cmdHook(argv) {
  const [host = "claude", event = ""] = argv;
  process.env.OFFLOAD_HOST ||= host;
  try {
    const raw = await readStdin();
    if (!raw.trim())
      return 0;
    const out = await handle(host, event, JSON.parse(raw));
    if (out)
      process.stdout.write(JSON.stringify(out) + `
`);
  } catch (e) {
    if (process.env.OFFLOAD_DEBUG)
      process.stderr.write(`offload hook: ${e.stack}
`);
  }
  return 0;
}
export {
  cmdHook
};
