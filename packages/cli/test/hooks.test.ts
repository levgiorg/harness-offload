import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { hook, sandbox } from "./helpers";

const s = sandbox();

describe("claude adapter", () => {
  test("denies a big full read with outline", () => {
    const o = hook("claude", "pre-read", { tool_name: "Read", tool_input: { file_path: join(s.dir, "big.ts") } }, s);
    expect(o.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(o.hookSpecificOutput.permissionDecisionReason).toContain("L1: export function f0");
    expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/Bash: (offload|node .*cli\.js.?) read -q/);
  });
  test("allows small files and slices", () => {
    expect(hook("claude", "pre-read", { tool_input: { file_path: join(s.dir, "small.ts") } }, s)).toBeUndefined();
    expect(hook("claude", "pre-read", { tool_input: { file_path: join(s.dir, "big.ts"), offset: 10, limit: 50 } }, s)).toBeUndefined();
  });
  test("post-bash replaces long output keeping the shape", () => {
    const out = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\nERROR: x.ts:1 boom";
    const o = hook("claude", "post-bash", { tool_input: { command: "make" }, tool_response: { stdout: out, stderr: "", interrupted: false, isImage: false } }, s);
    expect(Object.keys(o.hookSpecificOutput.updatedToolOutput).sort()).toEqual(["interrupted", "isImage", "stderr", "stdout"]);
    expect(o.hookSpecificOutput.updatedToolOutput.stdout).toContain("ERROR: x.ts:1 boom");
  });
  test("session-start guide", () => {
    const o = hook("claude", "session-start", { source: "startup" }, s);
    expect(o.hookSpecificOutput.additionalContext).toMatch(/(offload|cli\.js.?) read -q/);
  });
});

describe("codex adapter", () => {
  test("blocks `cat` of a big file and points at the MCP tool", () => {
    const o = hook("codex", "pre-tool", { hook_event_name: "PreToolUse", tool_name: "Bash", turn_id: "t", tool_input: { command: `cat ${join(s.dir, "big.ts")}` } }, s);
    expect(o.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(o.hookSpecificOutput.permissionDecisionReason).toContain("offload_read tool");
    expect(Object.keys(o)).toEqual(["hookSpecificOutput"]);
  });
  test("replaces long output with continue:false + reason (non-error)", () => {
    const out = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const o = hook("codex", "post-tool", { tool_name: "Bash", tool_input: { command: "npm run build" }, tool_response: out }, s);
    expect(o.continue).toBe(false);
    expect(o.reason).toContain("[offload]");
    expect(Object.keys(o).sort()).toEqual(["continue", "reason", "stopReason"]);
  });
  test("session guide uses MCP tools", () => {
    const o = hook("codex", "session-start", { source: "startup" }, s);
    expect(o.hookSpecificOutput.additionalContext).toContain("offload_read(question, paths[])");
  });
});

describe("cursor adapter", () => {
  test("Read deny uses agent_message", () => {
    const o = hook("cursor", "pre-tool", { hook_event_name: "preToolUse", tool_name: "Read", tool_input: { file_path: join(s.dir, "big.ts") } }, s);
    expect(o.permission).toBe("deny");
    expect(o.agent_message).toContain("offload_read tool");
  });
  test("Shell guard", () => {
    const o = hook("cursor", "pre-tool", { tool_name: "Shell", tool_input: { command: `nl ${join(s.dir, "big.ts")}`, working_directory: s.dir } }, s);
    expect(o.permission).toBe("deny");
  });
  test("no output replacement (unsupported) and session context", () => {
    expect(hook("cursor", "post-tool", { tool_name: "Shell", tool_input: { command: "make" }, tool_output: "x" }, s)).toBeUndefined();
    expect(hook("cursor", "session-start", {}, s).additional_context).toContain("offload_explore");
  });
});

describe("gemini adapter", () => {
  test("read_file with start/end lines", () => {
    expect(hook("gemini", "before-tool", { tool_name: "read_file", tool_input: { file_path: join(s.dir, "big.ts"), start_line: 1, end_line: 100 } }, s)).toBeUndefined();
    const o = hook("gemini", "before-tool", { tool_name: "read_file", tool_input: { file_path: join(s.dir, "big.ts") } }, s);
    expect(o.decision).toBe("deny");
  });
  test("after-tool digest", () => {
    const out = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const o = hook("gemini", "after-tool", { tool_name: "run_shell_command", tool_input: { command: "npm test" }, tool_response: { llmContent: out } }, s);
    expect(o.decision).toBe("deny");
    expect(o.reason).toContain("ran successfully");
  });
});

describe("fail open", () => {
  test("disabled → no output", () => {
    const o = hook("claude", "pre-read", { tool_input: { file_path: join(s.dir, "big.ts") } }, { ...s, env: { ...s.env, OFFLOAD_DISABLE: "1" } });
    expect(o).toBeUndefined();
  });
  test("no backend → no output", () => {
    const o = hook("codex", "pre-tool", { tool_name: "Bash", tool_input: { command: `cat ${join(s.dir, "big.ts")}` } }, { ...s, env: { ...s.env, OFFLOAD_OPENCODE_BIN: "/nonexistent" } });
    expect(o).toBeUndefined();
  });
  test("garbage input → no output", () => {
    const { cli } = require("./helpers");
    expect(cli(["hook", "claude", "pre-read"], { env: s.env, input: "{not json" }).stdout).toBe("");
  });
});

describe("amp plugin (simulated Amp API)", () => {
  test("rejects a huge read and digests long shell output", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "offload-amp-"));
    writeFileSync(join(dir, "big.ts"), Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n");
    process.env.OFFLOAD_STATE_DIR = join(dir, "state");
    process.env.OFFLOAD_CONFIG = join(dir, "none.json");
    process.env.OFFLOAD_PROJECT_DIR = dir;
    process.env.OFFLOAD_OPENCODE_BIN = (await import("./helpers.ts")).STUB;
    process.env.OFFLOAD_MODEL = "stub/ok";
    process.env.STUB_VERSION = "1.19.5";
    const handlers: Record<string, (e: any, ctx?: any) => Promise<any>> = {};
    const amp = { on: (ev: string, fn: any) => (handlers[ev] = fn), helpers: { shellCommandFromToolCall: (e: any) => (e.tool === "Bash" ? { command: e.input.cmd } : undefined) } };
    const { resetConfig } = await import("../src/config.ts");
    resetConfig();
    const plugin = (await import("../src/integrations/amp.ts")).default;
    plugin(amp);
    const r1 = await handlers["tool.call"]({ tool: "Read", input: { path: join(dir, "big.ts") }, thread: { id: "t" } });
    expect(r1.action).toBe("reject-and-continue");
    expect(r1.message).toContain("3,000 lines");
    const r2 = await handlers["tool.call"]({ tool: "Read", input: { path: join(dir, "big.ts"), read_range: [10, 60] }, thread: { id: "t" } });
    expect(r2.action).toBe("allow");
    const out = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
    const r3 = await handlers["tool.result"]({ tool: "Bash", input: { cmd: "seq 1 900" }, status: "done", output: { output: out, exitCode: 0 }, thread: { id: "t" } });
    expect(r3.status).toBe("done");
    expect(String(r3.output)).toContain("[offload] `seq 1 900`");
  }, 30_000);
});
