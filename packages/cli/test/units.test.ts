import { describe, expect, test } from "bun:test";
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
