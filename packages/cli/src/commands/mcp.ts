// `offload mcp` — exposes offload as MCP tools over stdio, for hosts whose
// agent shell is sandboxed without network (Codex, Cursor) and for any other
// MCP client (Windsurf/Devin, Zed, VS Code, Goose, Gemini CLI, Claude Desktop…).
// Each call runs the offload CLI as a subprocess so state stays isolated.
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../assets.ts";

function self(): string[] {
  const a1 = process.argv[1] ?? "";
  return /\.(c|m)?js$/.test(a1) ? [process.execPath, a1] : [process.execPath];
}

function runSelf(args: string[], cwd?: string, input?: string): Promise<{ code: number; out: string; err: string }> {
  const [cmd, ...pre] = self();
  return new Promise((resolve) => {
    const child = spawn(cmd, [...pre, ...args], { cwd: cwd || process.cwd(), env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: 14, out, err: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? 14, out, err }));
    child.stdin.end(input ?? "");
  });
}

function result(r: { code: number; out: string; err: string }, okCodes: number[] = [0]) {
  const body = (r.out + (r.err.trim() ? `\n${r.err.trim()}` : "")).trim() || `(exit ${r.code})`;
  return { content: [{ type: "text" as const, text: body }], isError: !okCodes.includes(r.code) };
}

export async function cmdMcp(_argv: string[]): Promise<number> {
  const server = new McpServer(
    { name: "code-offload", version: VERSION },
    {
      instructions:
        "Code Offload delegates bulk I/O to cheap worker models so it never enters your context. Use offload_read for questions about large files, offload_explore to search a codebase, offload_run for noisy commands (tests, builds), offload_write for boilerplate that follows a reference file. Citations in answers are machine-checked; read the cited lines before editing.",
    },
  );
  const cwd = z.string().optional().describe("Working directory (default: the server's cwd, usually the project root)");
  const model = z.string().optional().describe("One-off model override, BACKEND:MODEL");

  server.registerTool(
    "offload_read",
    {
      title: "Ask a cheap model about large files",
      description: "Answer a question about one or more files (or directories, or file:START-END ranges) without loading them into your context. The answer cites path:Lx-Ly with quotes that are verified against the files.",
      inputSchema: { question: z.string().describe("A specific question"), paths: z.array(z.string()).min(1).describe("Files, directories or file:START-END"), cwd, model },
    },
    async ({ question, paths, cwd: dir, model: m }) => result(await runSelf(["read", "-q", question, ...(m ? ["-m", m] : []), "--", ...paths], dir)),
  );
  server.registerTool(
    "offload_explore",
    {
      title: "Explore the codebase with a read-only cheap agent",
      description: "A read-only worker searches the repository itself (read/grep/glob) and answers with verified path:line citations. Use for 'where/how is X done?' across many files.",
      inputSchema: { question: z.string(), cwd, model },
    },
    async ({ question, cwd: dir, model: m }) => result(await runSelf(["explore", ...(m ? ["-m", m] : []), "--", question], dir)),
  );
  server.registerTool(
    "offload_run",
    {
      title: "Run a noisy command and get a digest",
      description: "Runs a shell command (tests, builds, installs, linters). Short output is returned as is; long output becomes a digest: cheap-model summary + verbatim error lines + the tail + the path of the full log. The command's exit code is reported.",
      inputSchema: { command: z.string().describe("Shell command line"), focus: z.string().optional().describe("What to look for in the output"), cwd, model },
    },
    async ({ command, focus, cwd: dir, model: m }) => {
      const r = await runSelf(["run", ...(focus ? ["-q", focus] : []), ...(m ? ["-m", m] : []), "-c", command], dir);
      return { content: [{ type: "text" as const, text: `${r.out}${r.err ? `\n${r.err}` : ""}\n[exit code ${r.code}]`.trim() }], isError: false };
    },
  );
  server.registerTool(
    "offload_summarize",
    {
      title: "Digest long text or a log file",
      description: "Digest a long log/text (given inline or as a file path): summary + verbatim key lines + tail.",
      inputSchema: { path: z.string().optional(), text: z.string().optional(), focus: z.string().optional(), cwd, model },
    },
    async ({ path, text, focus, cwd: dir, model: m }) =>
      result(await runSelf(["summarize", ...(focus ? ["-q", focus] : []), ...(m ? ["-m", m] : []), ...(path ? [path] : ["-"])], dir, text)),
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
    async ({ spec, reference, context, out, check, force, cwd: dir, model: m }) =>
      result(
        await runSelf(
          ["write", "--spec", spec, ...reference.flatMap((r) => ["--ref", r]), ...(context ?? []).flatMap((c) => ["--context", c]), ...(out ? ["--out", out] : []), ...(check ? ["--check", check] : []), ...(force ? ["--force"] : []), ...(m ? ["-m", m] : [])],
          dir,
        ),
      ),
  );
  server.registerTool(
    "offload_ask",
    { title: "Ask the cheap model", description: "One-off question to the cheap worker model (optionally about a file).", inputSchema: { question: z.string(), file: z.string().optional(), cwd, model } },
    async ({ question, file, cwd: dir, model: m }) => result(await runSelf(["ask", ...(file ? ["-f", file] : []), ...(m ? ["-m", m] : []), "--", question], dir)),
  );
  server.registerTool(
    "offload_outline",
    { title: "Outline a file", description: "Symbol outline of a source file with line numbers (no model call) — find the slice to read.", inputSchema: { path: z.string(), cwd } },
    async ({ path, cwd: dir }) => result(await runSelf(["outline", path], dir)),
  );
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.on("close", () => resolve()));
  return 0;
}
