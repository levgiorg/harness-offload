import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CLI, sandbox } from "./helpers";

describe("mcp server", () => {
  test("lists tools and runs them over stdio", async () => {
    const s = sandbox();
    const client = new Client({ name: "test", version: "1" });
    const env = Object.fromEntries(Object.entries({ ...s.env, STUB_ANSWER: "MAX is 42 — big.ts:L1 `export function f0(a: number)`" }).filter(([, v]) => v !== undefined)) as Record<string, string>;
    await client.connect(new StdioClientTransport({ command: "node", args: [CLI, "mcp"], env, cwd: s.dir }));
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["offload_ask", "offload_explore", "offload_outline", "offload_read", "offload_run", "offload_summarize", "offload_write"]);
    const r: any = await client.callTool({ name: "offload_read", arguments: { question: "what is MAX?", paths: ["big.ts"] } });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain("citations: 1 verified, 0 unverified");
    const o: any = await client.callTool({ name: "offload_outline", arguments: { path: "big.ts" } });
    expect(o.content[0].text).toContain("L1: export function f0");
    const run: any = await client.callTool({ name: "offload_run", arguments: { command: "echo hi; exit 3" } });
    expect(run.content[0].text).toContain("hi");
    expect(run.content[0].text).toContain("[exit code 3]");
    const bad: any = await client.callTool({ name: "offload_read", arguments: { question: "q", paths: ["nope.ts"] } });
    expect(bad.isError).toBe(true);
    await client.close();
  }, 60_000);
});
