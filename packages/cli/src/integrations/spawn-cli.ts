import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cfgInt } from "../config.ts";
import { runProcess } from "../proc.ts";

/** Runs this package's CLI (dist/cli.js next to the integration bundle). */
export async function runCli(args: string[], cwd: string, input = "", signal?: AbortSignal): Promise<{ code: number; out: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = [join(here, "cli.js"), join(here, "..", "dist", "cli.js")].find((p) => existsSync(p));
  const [cmd, pre] = js ? ["node", [js]] : ["offload", []];
  const limit = (cfgInt("opencode.timeout_seconds", 180) * 2 + 60) * 1000;
  const r = await runProcess(cmd, [...pre, ...args], { input, cwd, env: { ...process.env, NO_COLOR: "1" }, timeoutMs: args[0] === "run" ? cfgInt("mcp.run_timeout_seconds", 1800) * 1000 : limit, signal });
  if (r.code === 127 && !r.stdout) return { code: 15, out: r.stderr };
  return { code: r.code ?? (r.timedOut ? 12 : 14), out: r.stdout + r.stderr };
}

export const TOOLS = {
  offload_read: {
    description: "Answer a question about large files (or dirs, or file:START-END) without loading them into your context; citations are checked against the files.",
    schema: { question: "string", paths: "string[]" },
    args: (p: any) => ["read", "-q", String(p.question), "--", ...((p.paths as string[]) ?? [])],
  },
  offload_explore: {
    description: "A read-only cheap agent searches the repository and answers with verified path:line citations ('where/how is X done?').",
    schema: { question: "string" },
    args: (p: any) => ["explore", "--", String(p.question)],
  },
  offload_run: {
    description: "Run a noisy command (tests, builds, installs, linters); long output comes back as a digest + verbatim error lines + full-log path.",
    schema: { command: "string", focus: "string?" },
    args: (p: any) => ["run", ...(p.focus ? ["-q", String(p.focus)] : []), "-c", String(p.command)],
  },
  offload_write: {
    description: "A cheap model writes a new file following reference files' patterns (tests, boilerplate, configs). Review it afterwards.",
    schema: { spec: "string", reference: "string[]", out: "string?" },
    args: (p: any) => ["write", "--spec", String(p.spec), ...((p.reference as string[]) ?? []).flatMap((r) => ["--ref", r]), ...(p.out ? ["--out", String(p.out)] : [])],
  },
  offload_task: {
    description: "Run one of the user's own offload tasks (custom instructions for the cheap worker): name, plus files/dirs to work on and an optional question.",
    schema: { name: "string", paths: "string[]?", question: "string?" },
    args: (p: any) => ["task", String(p.name), ...(p.question ? ["-q", String(p.question)] : []), "--", ...((p.paths as string[]) ?? [])],
  },
  offload_outline: {
    description: "Symbol outline of a file with line numbers (no model) — find the slice to read.",
    schema: { path: "string" },
    args: (p: any) => ["outline", String(p.path)],
  },
} as const;
