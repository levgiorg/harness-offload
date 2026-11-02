// The read-only explore tools given to HTTP models: containment, secrets,
// bounded time and size, redaction.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "../src/backends/tools.ts";

const SECRETS = [".env", ".env.*", "*.pem", "id_rsa*"];

function project() {
  const base = mkdtempSync(join(tmpdir(), "offload-tools-"));
  const root = join(base, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(base, "outside", "secret.txt"), "OUTSIDE-SECRET\n");
  writeFileSync(join(root, ".env"), "API_KEY=abcdefghijklmnop\nAWS=AKIAABCDEFGHIJKLMNOP\n");
  writeFileSync(join(root, ".git", "config"), "url = https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r\n");
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n// token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n");
  writeFileSync(join(root, "aaaa.txt"), "a".repeat(40) + "!\n");
  writeFileSync(join(root, "bundle.min.js"), "x".repeat(300_000) + "\n");
  symlinkSync(join(base, "outside", "secret.txt"), join(root, "notes.md"));
  symlinkSync(join(root, ".env"), join(root, "innocent.txt"));
  symlinkSync("/etc", join(root, "etcdir"));
  symlinkSync(".", join(root, "loop-a"));
  symlinkSync(".", join(root, "loop-b"));
  return { root, ctx: { root, secretGlobs: SECRETS, allowGlobs: ["*.example"] } };
}

describe("explore tools", () => {
  test("a symlink cannot read outside the project", async () => {
    const { ctx } = project();
    expect(await runTool("read_file", { path: "notes.md" }, ctx)).toContain("outside the project");
    expect(await runTool("read_file", { path: "etcdir/passwd" }, ctx)).toContain("outside the project");
    expect(await runTool("read_file", { path: "../outside/secret.txt" }, ctx)).toContain("outside the project");
  });

  test("secrets are refused by name, by link target and case-insensitively", async () => {
    const { ctx } = project();
    expect(await runTool("read_file", { path: ".env" }, ctx)).toContain("secret-file rules");
    expect(await runTool("read_file", { path: "innocent.txt" }, ctx)).toContain("secret-file rules");
    expect(await runTool("read_file", { path: ".ENV" }, ctx)).toMatch(/secret-file rules|no such file/);
  });

  test(".git is never readable", async () => {
    const { ctx } = project();
    expect(await runTool("read_file", { path: ".git/config" }, ctx)).toContain("refused");
  });

  test("grep skips links and secrets and redacts what it returns", async () => {
    const { ctx } = project();
    const out = await runTool("grep", { pattern: "AKIA|SECRET|ghp_" }, ctx);
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(out).not.toContain("OUTSIDE-SECRET");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).toContain("src/a.ts:2:");
  });

  test("glob terminates on symlink loops", async () => {
    const { ctx } = project();
    const t0 = Date.now();
    const out = await runTool("glob", { pattern: "**/*.ts" }, ctx);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(out).toBe("src/a.ts");
  });

  test("a catastrophic regex is stopped by the deadline", async () => {
    const { ctx } = project();
    const t0 = Date.now();
    const out = await runTool("grep", { pattern: "^(a+)+$" }, ctx);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(out).toMatch(/grep stopped|no matches/);
  }, 20_000);

  test("huge lines are cut", async () => {
    const { ctx } = project();
    const out = await runTool("read_file", { path: "bundle.min.js" }, ctx);
    expect(out.length).toBeLessThan(10_000);
    expect(out).toContain("more characters");
  });

  test("list_dir marks links and hides secrets", async () => {
    const { ctx } = project();
    const out = await runTool("list_dir", {}, ctx);
    expect(out).toContain("notes.md@");
    expect(out).not.toContain(".env");
    expect(out).not.toContain(".git");
  });
});
