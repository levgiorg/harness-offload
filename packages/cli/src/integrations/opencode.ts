// OpenCode plugin (works on v1 and v2 from one default export):
// v2 reads { id, setup }, v1 calls server(). Guards big reads/dumps, digests
// long shell output and adds a short guide to the system prompt.
// the harness's own subscription for @host models
process.env.OFFLOAD_HOST ||= "opencode";
import { available, bashGuard, postBash, readGuard, sessionGuide } from "../hooks/logic.ts";

const textOf = (v: any): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).join("") : v == null ? "" : JSON.stringify(v));

async function guardRead(cwd: string, file: string | undefined, offset?: number, limit?: number) {
  if (!(await available())) return;
  const v = readGuard("opencode", cwd, file, offset, limit);
  if (v && v.action !== "note") throw new Error(v.message);
}
async function guardShell(cwd: string, command: string | undefined) {
  if (!(await available())) return;
  const v = bashGuard("opencode", cwd, command);
  if (v && v.action !== "note") throw new Error(v.message);
}

const plugin = {
  id: "harness-offload",

  // ---- OpenCode v2
  async setup(ctx: any) {
    const cwd = () => ctx?.directory ?? ctx?.project?.directory ?? process.cwd();
    await ctx.tool.hook("execute.before", async (e: any) => {
      const i = e.input ?? {};
      if (e.tool === "read") await guardRead(cwd(), i.path ?? i.filePath, i.offset, i.limit);
      else if (e.tool === "shell" || e.tool === "bash") await guardShell(i.workdir ?? cwd(), i.command);
    });
    await ctx.tool.hook("execute.after", async (e: any) => {
      if (e.status !== "completed" || (e.tool !== "shell" && e.tool !== "bash")) return;
      const out = textOf(e.result?.content ?? e.result?.output);
      const d = await postBash({ command: e.input?.command, output: out });
      if (d) e.result = { ...e.result, content: d, output: d };
    });
    await ctx.session.hook("context", (e: any) => {
      e.system.push({ type: "text", text: sessionGuide("opencode") });
    });
    return () => {};
  },

  // ---- OpenCode v1
  async server(input: any) {
    const cwd = input?.directory ?? process.cwd();
    return {
      "tool.execute.before": async (i: any, output: any) => {
        const a = output?.args ?? {};
        if (i.tool === "read") await guardRead(cwd, a.filePath ?? a.path, a.offset, a.limit);
        else if (i.tool === "bash") await guardShell(a.workdir ?? cwd, a.command);
      },
      "tool.execute.after": async (i: any, output: any) => {
        if (i.tool !== "bash") return;
        const d = await postBash({ command: i.args?.command, output: textOf(output?.output) });
        if (d) output.output = d;
      },
      "experimental.chat.system.transform": async (_: unknown, out: any) => {
        out.system.push(sessionGuide("opencode"));
      },
    };
  },
};

export default plugin;
