// Pi extension: guards big reads/dumps, digests long bash output, adds
// offload_* tools and a short guide to the system prompt.
// Loaded by pi from this package ("pi": {"extensions": ["./dist/pi.js"]}).
import { Type } from "typebox";
import { available, bashGuard, postBash, readGuard, sessionGuide } from "../hooks/logic.ts";
import { runCli, TOOLS } from "./spawn-cli.ts";

const textOf = (content: any): string => (Array.isArray(content) ? content.map((c) => (c?.type === "text" ? c.text : "")).join("") : String(content ?? ""));

function schema(spec: Record<string, string>) {
  const props: Record<string, any> = {};
  for (const [k, t] of Object.entries(spec)) {
    const base = t.startsWith("string[]") ? Type.Array(Type.String()) : Type.String();
    props[k] = t.endsWith("?") ? Type.Optional(base) : base;
  }
  return Type.Object(props);
}

export default function codeOffload(pi: any): void {
  pi.on("before_agent_start", (event: any) => {
    const opts = event?.systemPromptOptions;
    if (!opts) return;
    opts.appendSystemPrompt = `${opts.appendSystemPrompt ?? ""}\n\n${sessionGuide("pi")}`.trim();
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    const cwd = ctx?.cwd ?? process.cwd();
    const input = event?.input ?? {};
    if (!(await available())) return undefined;
    const v = event.toolName === "read" ? readGuard("pi", cwd, input.path, input.offset, input.limit) : event.toolName === "bash" ? bashGuard("pi", cwd, input.command) : undefined;
    if (!v || v.action === "note") return undefined;
    return { block: true, reason: v.message };
  });

  pi.on("tool_result", async (event: any) => {
    if (event?.toolName !== "bash" || event.isError) return undefined;
    const sc = event.structuredContent ?? {};
    const output = typeof sc.output === "string" ? sc.output : textOf(event.content);
    const d = await postBash({ command: event.input?.command, output, persistedPath: sc.full_output_path });
    if (!d) return undefined;
    return { content: [{ type: "text", text: d }], structuredContent: { ...sc, output: d, truncated: false } };
  });

  for (const [name, t] of Object.entries(TOOLS)) {
    pi.registerTool({
      name,
      label: name.replace("offload_", "Offload "),
      description: t.description,
      parameters: schema(t.schema as Record<string, string>),
      async execute(_id: string, params: any, _signal: unknown, _onUpdate: unknown, ctx: any) {
        const r = await runCli(t.args(params), ctx?.cwd ?? process.cwd());
        if (r.code !== 0 && name !== "offload_run") throw new Error(r.out.trim() || `offload exited ${r.code}`);
        return { content: [{ type: "text", text: r.out.trim() + (name === "offload_run" ? `\n[exit code ${r.code}]` : "") }], details: undefined };
      },
    });
  }
}
