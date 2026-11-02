// Amp plugin (experimental: written against Amp's published plugin API, not
// yet run against a live Amp). Guards big reads/dumps and digests long shell
// output. Amp loads plugins from ~/.config/amp/plugins/ with Bun.
// the harness's own subscription for @host models
process.env.OFFLOAD_HOST ||= "amp";
import { available, bashGuard, postBash, readGuard } from "../hooks/logic.ts";

const READ_TOOLS = new Set(["Read", "read", "read_file"]);

const textOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.output === "string") return o.output;
    if (typeof o.stdout === "string") return o.stdout + (typeof o.stderr === "string" && o.stderr ? `\n[stderr]\n${o.stderr}` : "");
  }
  return v == null ? "" : JSON.stringify(v);
};

/** Internal failures must never block the user's tools. */
async function failOpen<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (process.env.OFFLOAD_DEBUG) process.stderr.write(`offload: ignored internal error: ${(e as Error)?.message ?? e}\n`);
    return fallback;
  }
}

function shellCommand(amp: any, event: any): string | undefined {
  const viaHelper = amp?.helpers?.shellCommandFromToolCall?.(event)?.command;
  if (typeof viaHelper === "string") return viaHelper;
  const i = event?.input ?? {};
  return typeof i.cmd === "string" ? i.cmd : typeof i.command === "string" ? i.command : undefined;
}

export default function harnessOffload(amp: any): void {
  const cwd = () => process.cwd();

  amp.on("tool.call", (event: any) =>
    failOpen(async () => {
      if (!(await available())) return { action: "allow" };
      const input = event?.input ?? {};
      let v;
      if (READ_TOOLS.has(event?.tool)) {
        const range = Array.isArray(input.read_range) ? input.read_range : undefined;
        const offset = range ? Number(range[0]) : undefined;
        const limit = range && Number.isFinite(Number(range[1])) ? Number(range[1]) - Number(range[0]) + 1 : undefined;
        v = readGuard("amp", cwd(), input.path ?? input.file_path, offset, limit);
      } else {
        const cmd = shellCommand(amp, event);
        if (cmd) v = bashGuard("amp", input.cwd ?? cwd(), cmd);
      }
      // Amp can't ask on our behalf: only a deny blocks
      if (v && v.action === "deny") return { action: "reject-and-continue", message: v.message };
      return { action: "allow" };
    }, { action: "allow" }),
  );

  amp.on("tool.result", (event: any) =>
    failOpen(async () => {
      if (event?.status !== "done") return undefined;
      const cmd = shellCommand(amp, event);
      if (!cmd) return undefined;
      const d = await postBash({ command: cmd, output: textOf(event.output) });
      return d ? { status: "done", output: d } : undefined;
    }, undefined),
  );
}
