// `offload mcp` — exposes offload as MCP tools over stdio, for hosts whose
// agent shell is sandboxed without network (Codex, Cursor) and for any other
// MCP client (Windsurf/Devin, Zed, VS Code, Goose, Gemini CLI, Claude Desktop…).
// Each call runs the offload CLI as a subprocess so state stays isolated.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../assets.ts";
import { cfgBool, cfgInt } from "../config.ts";
import { runProcess } from "../proc.ts";
import { taskSummary } from "../tasks.ts";

function self(): string[] {
  const a1 = process.argv[1] ?? "";
  return /\.(c|m)?js$/.test(a1) ? [process.execPath, a1] : [process.execPath];
}

/** Runs this CLI for one tool call: bounded in time, killed if the client cancels. */
async function runSelf(args: string[], cwd?: string, input?: string, signal?: AbortSignal, timeoutSec?: number): Promise<{ code: number; out: string; err: string }> {
  const [cmd, ...pre] = self();
  const limit = timeoutSec ?? cfgInt("opencode.timeout_seconds", 180) * 2 + 60;
  const r = await runProcess(cmd, [...pre, ...args], { input: input ?? "", cwd: cwd || process.cwd(), env: { ...process.env, NO_COLOR: "1" }, timeoutMs: limit * 1000, signal });
  if (r.killedBy === "cancelled") return { code: 130, out: r.stdout, err: "cancelled by the client" };
  if (r.timedOut) return { code: 12, out: r.stdout, err: `${r.stderr}\noffload: stopped after ${limit}s` };
  return { code: r.code ?? 14, out: r.stdout, err: r.stderr };
}

function result(r: { code: number; out: string; err: string }, okCodes: number[] = [0]) {
  const body = (r.out + (r.err.trim() ? `\n${r.err.trim()}` : "")).trim() || `(exit ${r.code})`;
  return { content: [{ type: "text" as const, text: body }], isError: !okCodes.includes(r.code) };
}

export async function cmdMcp(_argv: string[]): Promise<number> {
  const server = new McpServer(
    { name: "harness-offload", version: VERSION },
    {
      instructions:
        "Harness Offload delegates bulk I/O to cheap worker models so it never enters your context. Use offload_read for questions about large files, offload_explore to search a codebase, offload_run for noisy commands (tests, builds), offload_write for boilerplate that follows a reference file. Citations in answers are machine-checked; read the cited lines before editing.",
    },
  );
  const cwd = z.string().optional().describe("Working directory (default: the server's cwd, usually the project root)");
  const model = z.string().optional().describe("One-off model override, BACKEND:MODEL");

  server.registerTool(
    "offload_read",
    {
      title: "Ask a cheap model about large files",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "Answer a question about one or more files (or directories, or file:START-END ranges) without loading them into your context. The answer cites path:Lx-Ly with quotes that are verified against the files.",
      inputSchema: { question: z.string().describe("A specific question"), paths: z.array(z.string()).min(1).describe("Files, directories or file:START-END"), cwd, model },
    },
    async ({ question, paths, cwd: dir, model: m }, extra) => result(await runSelf(["read", "-q", question, ...(m ? ["-m", m] : []), "--", ...paths], dir, "", extra.signal)),
  );
  server.registerTool(
    "offload_explore",
    {
      title: "Explore the codebase with a read-only cheap agent",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "A read-only worker searches the repository itself (read/grep/glob) and answers with verified path:line citations. Use for 'where/how is X done?' across many files.",
      inputSchema: { question: z.string(), cwd, model },
    },
    async ({ question, cwd: dir, model: m }, extra) => result(await runSelf(["explore", ...(m ? ["-m", m] : []), "--", question], dir, "", extra.signal)),
  );
  // offload_run executes shell commands outside the host's own sandbox, so it is
  // annotated as open-world/destructive (hosts that honour annotations ask first)
  // and can be switched off with mcp.run_tool=false.
  if (cfgBool("mcp.run_tool", true)) server.registerTool(
    "offload_run",
    {
      title: "Run a noisy command and get a digest",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description: "Runs a shell command (tests, builds, installs, linters). Short output is returned as is; long output becomes a digest: cheap-model summary + verbatim error lines + the tail + the path of the full log. The command's exit code is reported.",
      inputSchema: { command: z.string().describe("Shell command line"), focus: z.string().optional().describe("What to look for in the output"), cwd, model },
    },
    async ({ command, focus, cwd: dir, model: m }, extra) => {
      const r = await runSelf(["run", ...(focus ? ["-q", focus] : []), ...(m ? ["-m", m] : []), "-c", command], dir, "", extra.signal, cfgInt("mcp.run_timeout_seconds", 1800));
      return { content: [{ type: "text" as const, text: `${r.out}${r.err ? `\n${r.err}` : ""}\n[exit code ${r.code}]`.trim() }], isError: false };
    },
  );
  server.registerTool(
    "offload_summarize",
    {
      title: "Digest long text or a log file",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: "Digest a long log/text (given inline or as a file path): summary + verbatim key lines + tail.",
      inputSchema: { path: z.string().optional(), text: z.string().optional(), focus: z.string().optional(), cwd, model },
    },
    async ({ path, text, focus, cwd: dir, model: m }, extra) =>
      result(await runSelf(["summarize", ...(focus ? ["-q", focus] : []), ...(m ? ["-m", m] : []), "--", ...(path ? [path] : ["-"])], dir, text, extra.signal)),
  );
  server.registerTool(
    "offload_write",
    {
      title: "Generate pattern-following code",
      description: "A cheap model writes a new file (tests, boilerplate, configs, stubs) following the conventions of reference files. Refuses to overwrite unless force is true. Review the result before relying on it.",
      inputSchema: {
        spec: z.string(),
        reference: z.array(z.string()).min(1).describe("Existing files whose patterns to follow"),
        context: z.array(z.string()).optional().describe("Files the code must work with (e.g. the code under test)"),
        out: z.string().optional().describe("Path to write; omit to get the code back"),
        check: z.string().optional().describe("Command to run after writing (e.g. the new tests)"),
        force: z.boolean().optional(),
        cwd,
        model,
      },
    },
    async ({ spec, reference, context, out, check, force, cwd: dir, model: m }, extra) =>
      result(
        await runSelf(
          ["write", "--spec", spec, ...reference.flatMap((r) => ["--ref", r]), ...(context ?? []).flatMap((c) => ["--context", c]), ...(out ? ["--out", out] : []), ...(check ? ["--check", check] : []), ...(force ? ["--force"] : []), ...(m ? ["-m", m] : [])],
          dir,
          "",
          extra.signal,
        ),
      ),
  );
  server.registerTool(
    "offload_ask",
    { title: "Ask the cheap model", description: "One-off question to the cheap worker model (optionally about a file).", inputSchema: { question: z.string(), file: z.string().optional(), cwd, model } },
    async ({ question, file, cwd: dir, model: m }, extra) => result(await runSelf(["ask", ...(file ? ["-f", file] : []), ...(m ? ["-m", m] : []), "--", question], dir, "", extra.signal)),
  );
  const tasks = taskSummary();
  if (tasks) server.registerTool(
    "offload_task",
    {
      title: "Run one of your own offload tasks",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: `Run one of the user's own tasks (custom instructions for the cheap worker) on files/dirs, or with no paths. Tasks: ${tasks}.`,
      inputSchema: { name: z.string().describe("Task name"), paths: z.array(z.string()).optional().describe("Files, directories or file:START-END"), question: z.string().optional(), cwd, model },
    },
    async ({ name, paths, question, cwd: dir, model: m }, extra) =>
      result(await runSelf(["task", name, ...(question ? ["-q", question] : []), ...(m ? ["-m", m] : []), "--", ...(paths ?? [])], dir, "", extra.signal)),
  );
  server.registerTool(
    "offload_outline",
    { title: "Outline a file", description: "Symbol outline of a source file with line numbers (no model call) — find the slice to read.", inputSchema: { path: z.string(), cwd } },
    async ({ path, cwd: dir }, extra) => result(await runSelf(["outline", "--", path], dir, "", extra.signal, 60)),
  );
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.on("close", () => resolve()));
  return 0;
}
