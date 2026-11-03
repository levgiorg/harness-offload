import { describe, expect, test } from "bun:test";
import { cli, sandbox } from "./helpers";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posixToJs } from "../src/outline.ts";
import { verifyCitations } from "../src/verify.ts";
import { keyLines } from "../src/digest.ts";
import { globToRegExp } from "../src/secrets.ts";
import { stripWrappingFence, shquote } from "../src/text.ts";

describe("posixToJs", () => {
  test("classes and brackets", () => {
    expect(new RegExp(posixToJs("^[[:space:]]+foo")).test("   foo")).toBe(true);
    expect(new RegExp(posixToJs("[][A-Za-z_<>,.?[:space:]]+x")).test("a[] b]x")).toBe(true);
    expect(new RegExp(posixToJs("^[^[:space:]]")).test(" a")).toBe(false);
  });
});

describe("verifyCitations", () => {
  const d = mkdtempSync(join(tmpdir(), "offload-v-"));
  writeFileSync(join(d, "a.ts"), "line one\nconst answer = 42;\nline three\n");
  test("checks quotes after and before the citation", () => {
    const v = verifyCitations("- x — a.ts:L2 `const answer = 42`\n- `const answer = 42` at a.ts:L2\n- bad a.ts:L1 `nope nope`", d);
    expect([v.ok, v.bad]).toEqual([2, 1]);
    expect(v.text.split("\n")[2]).toContain("⚠unverified");
  });
});

describe("digest", () => {
  test("key lines fold repeats and skip zero counts", () => {
    const k = keyLines("ok\nERROR: boom\n0 errors found\nERROR: boom\nTests: 1 failed\n", 10);
    expect(k.lines[0]).toBe("L2: ERROR: boom  (x2)");
    expect(k.distinct).toBe(2);
  });
});

describe("misc", () => {
  test("globs", () => {
    expect(globToRegExp(".env.*").test(".env.local")).toBe(true);
    expect(globToRegExp("*.pem").test("a.pem")).toBe(true);
    expect(globToRegExp("id_rsa*").test("id_rsa.pub")).toBe(true);
  });
  test("fence stripping keeps inner fences", () => {
    expect(stripWrappingFence("```ts\nconst a = 1\n```\n")).toBe("const a = 1\n");
    expect(stripWrappingFence("# T\n\n```js\nx()\n```\n")).toContain("```js");
  });
  test("shquote", () => {
    expect(shquote("a b")).toBe("'a b'");
    expect(shquote("it's")).toBe(`'it'\\''s'`);
    expect(shquote("plain/path.ts")).toBe("plain/path.ts");
  });
});

describe("runProcess", () => {
  test("returns when the worker exits even if a descendant holds its stdout, and kills that descendant", async () => {
    const { runProcess } = await import("../src/proc.ts");
    const t0 = Date.now();
    const r = await runProcess("bash", ["-c", "echo done; (sleep 30; echo late) & echo $! > \"$PIDF\""], { timeoutMs: 20_000, env: { ...process.env, PIDF: join(tmpdir(), `offload-pid-${process.pid}`) } });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.stdout).toContain("done");
    expect(r.timedOut).toBe(false);
    const { readFileSync } = await import("node:fs");
    const pid = Number(readFileSync(join(tmpdir(), `offload-pid-${process.pid}`), "utf8"));
    await new Promise((res) => setTimeout(res, 300));
    // gone, or a zombie waiting for init to reap it
    const { spawnSync } = await import("node:child_process");
    const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    expect(stat === "" || stat.startsWith("Z")).toBe(true);
  });

  test("keeps multi-byte characters split across chunks intact", async () => {
    const { runProcess } = await import("../src/proc.ts");
    const r = await runProcess("node", ["-e", "const b=Buffer.from('ε'.repeat(100000));for(let i=0;i<b.length;i+=7)process.stdout.write(b.subarray(i,i+7))"], { timeoutMs: 20_000 });
    expect(r.stdout).toBe("ε".repeat(100000));
  });

  test("an abort signal stops the process", async () => {
    const { runProcess } = await import("../src/proc.ts");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    const r = await runProcess("sleep", ["30"], { timeoutMs: 20_000, signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.killedBy).toBe("cancelled");
  });
});

describe("redact (same vectors as the bash suite)", () => {
  test("masks credentials in their common shapes", async () => {
    const { redact } = await import("../src/secrets.ts");
    const input = [
      'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" -H "X-Api-Key: zyxwvutsrqponmlk"',
      "DATABASE_URL=postgres://admin:s3cr3tpass@db.example.com/app",
      "AWS=ASIAABCDEFGHIJKLMNOP",
      '{"token": "abc def ghi jkl"}',
      "password = 'correct horse battery'",
      "sk_live_abcdefghijklmnop npm_abcdefghijklmnopqrstuvwxyz0123456789 glpat-abcdefghijklmnopqrst",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAA",
    ].join("\n");
    const out = redact(input);
    for (const leak of ["abcdefghijklmnopqrstuvwxyz012345", "zyxwvutsrqponmlk", "s3cr3tpass", "ASIAABCDEFGHIJKLMNOP", "abc def ghi jkl", "correct horse battery", "sk_live_abcdefghijklmnop", "npm_abcdefghijklmnopqrstuvwxyz0123456789", "glpat-abcdefghijklmnopqrst", "b3BlbnNzaC1rZXktdjEAAAA"])
      expect(out).not.toContain(leak);
    expect(out).toContain("@db.example.com/app");
  });
});

describe("dashboard", () => {
  test("embeds the rows safely and renders the report shell", async () => {
    const { renderDashboard, sampleStats } = await import("../src/commands/dashboard.ts");
    const html = renderDashboard([{ ts: 1, kind: "digest", label: "</script><img src=x onerror=alert(1)>", saved_tokens: 10 }], { source: "/tmp/stats.jsonl" });
    expect(html).toContain("Harness Offload report");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script>");
    const rows = sampleStats(1_800_000_000);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => typeof r.ts === "number" && r.kind)).toBe(true);
  });
});

describe("dashboard cooldowns", () => {
  test("cooldown files are shown under their real model ids", async () => {
    const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { sandbox, cli } = await import("./helpers.ts");
    const s = sandbox();
    mkdirSync(join(s.dir, "state", "cooldowns"), { recursive: true });
    writeFileSync(join(s.dir, "state", "stats.jsonl"), JSON.stringify({ ts: Math.floor(Date.now() / 1000), kind: "read", model: "openrouter:qwen/qwen3-coder", saved_tokens: 5 }) + "\n");
    writeFileSync(join(s.dir, "state", "cooldowns", "openrouter_qwen_qwen3-coder"), `${Math.floor(Date.now() / 1000) + 300} rate-limit/quota\n`);
    const out = join(s.dir, "d.html");
    expect(cli(["dashboard", "--out", out], { env: s.env }).code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain('"cooldowns":[{"model":"openrouter:qwen/qwen3-coder"');
  });
});

describe("NO_COLOR", () => {
  test("FORCE_COLOR turns colour on; NO_COLOR wins over it, in every command that styles output", () => {
    const s = sandbox();
    const env: NodeJS.ProcessEnv = { ...s.env, FORCE_COLOR: "1" };
    delete env.NO_COLOR;
    expect(cli(["doctor"], { env }).stdout).toContain("\x1b[");
    for (const args of [["doctor"], ["stats"], ["model"], ["explain"], ["help"], ["install", "--dry-run", "--yes"]])
      expect(cli(args, { env: { ...env, NO_COLOR: "1" } }).stdout).not.toContain("\x1b[");
  });
});

describe("explore in a big repo", () => {
  test("a git file list over 1 MB is read in full (ignored files stay out, so a shortened citation is unique)", () => {
    const { mkdirSync, writeFileSync } = require("node:fs");
    const { execFileSync } = require("node:child_process");
    const s = sandbox();
    const repo = join(s.dir, "repo");
    const deep = "a-rather-long-folder-name-that-makes-the-git-listing-big/".repeat(3);
    for (let i = 0; i < 6000; i++) {
      if (i % 500 === 0) mkdirSync(join(repo, `p${i}`, deep), { recursive: true });
      writeFileSync(join(repo, `p${i - (i % 500)}`, deep, `m${i}.ts`), "x\n");
    }
    mkdirSync(join(repo, "src", "fx"), { recursive: true });
    writeFileSync(join(repo, "src", "fx", "ledger.ts"), "export const x = 1\nexport function post(e) { ledger.push(e) }\n");
    mkdirSync(join(repo, "generated"), { recursive: true });
    writeFileSync(join(repo, "generated", "ledger.ts"), "generated\n");
    writeFileSync(join(repo, ".gitignore"), "generated/\n");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const listing = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repo, maxBuffer: 1 << 26 }).length;
    expect(listing).toBeGreaterThan(1024 * 1024);
    const r = cli(["explore", "where is post?"], { env: { ...s.env, STUB_ANSWER: "post — ledger.ts:L2 `ledger.push(e)`" }, cwd: repo });
    expect(r.stdout).toContain("citations: 1 verified, 0 unverified");
    expect(r.stdout).toContain("src/fx/ledger.ts:L2");
  }, 60_000);
});
