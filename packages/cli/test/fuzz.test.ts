// Property tests for the citation verifier: random answers, fixed seed, both engines compared.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyCitations } from "../src/verify.ts";

const AWK = join(import.meta.dir, "..", "..", "..", "plugins", "harness-offload", "lib", "verify.awk");

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "offload-fuzz-"));
  mkdirSync(join(dir, "src", "fx"), { recursive: true });
  const files: Record<string, string[]> = {};
  const r = rng(7);
  for (const f of ["src/a.ts", "src/fx/b.ts", "notes.md"]) {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1} ${["const total = sum(items)", "return x + 1;", "export function post(entry) {", "if (a < b) { swap(a, b) }", "// TODO: ...", ""][Math.floor(r() * 6)]}`);
    files[f] = lines;
    writeFileSync(join(dir, f), lines.join("\n") + "\n");
  }
  return { dir, files };
}

function answer(r: () => number, files: Record<string, string[]>): string {
  const names = [...Object.keys(files), "fx/b.ts", "b.ts", "missing.ts", "../etc/passwd", "/etc/hosts", "host"];
  const parts: string[] = [];
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const name = names[Math.floor(r() * names.length)];
    const line = 1 + Math.floor(r() * 70);
    const real = files[name] ?? files["src/fx/b.ts"];
    const quote =
      r() < 0.5 ? (real[Math.min(line, real.length) - 1] ?? "").slice(r() < 0.5 ? 0 : 5) : ["no such text", "x", "`", "a ... b", "const total … items", "", "line 1"][Math.floor(r() * 7)];
    const range = r() < 0.3 ? `L${line}-L${line + Math.floor(r() * 4)}` : r() < 0.2 ? `${line}` : `L${line}`;
    const tick = r() < 0.4 ? "`" : "";
    parts.push(`${["claim", "- see", "and"][Math.floor(r() * 3)]} ${tick}${name}:${range}${tick} \`${quote}\``);
  }
  return parts.join(r() < 0.5 ? "; " : "\n");
}

function awkCounts(text: string, root: string, sent: string[]): [number, number] {
  const sentFile = join(root, ".sent");
  writeFileSync(sentFile, sent.join("\n") + "\n");
  const rep = join(root, ".rep");
  spawnSync("awk", ["-v", `root=${root}`, "-v", `report=${rep}`, "-v", `sent=${sentFile}`, "-f", AWK], { input: text, env: { ...process.env, LC_ALL: "C" } });
  const out = require("node:fs").readFileSync(rep, "utf8").trim().split(" ").map(Number);
  return [out[0], out[1]];
}

describe("citation verifier (property tests)", () => {
  const { dir, files } = project();
  const sent = Object.keys(files);

  test("10,000 random answers: never throws, counts are sane", () => {
    const r = rng(42);
    for (let i = 0; i < 10_000; i++) {
      const a = answer(r, files);
      const v = verifyCitations(a, dir, 3, sent);
      expect(v.ok + v.bad).toBeLessThanOrEqual((a.match(/:L?\d/g) ?? []).length);
      expect(v.ok).toBeGreaterThanOrEqual(0);
    }
  });

  test("a quote that is in no file is never verified", () => {
    const r = rng(9);
    for (let i = 0; i < 2_000; i++) {
      const f = sent[Math.floor(r() * sent.length)];
      const line = 1 + Math.floor(r() * 60);
      const junk = Array.from({ length: 8 }, () => "qwzxjvkp"[Math.floor(r() * 8)]).join("");
      const v = verifyCitations(`claim — ${f}:L${line} \`${junk}\``, dir, 3, sent);
      expect(v.ok).toBe(0);
    }
  });

  test("adversarial lines stay fast", () => {
    const evil = ["a".repeat(3999) + ":L1 `x`", ("x/".repeat(1900) + ":L1 `y`").slice(0, 3999), "`".repeat(3999), ("src/a.ts:L1 `" + "b".repeat(80) + "` ").repeat(40)];
    for (const e of evil) {
      const t0 = performance.now();
      verifyCitations(e, dir, 3, sent);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });

  test("awk and TypeScript give the same counts on 300 random answers", () => {
    const r = rng(1234);
    const diffs: string[] = [];
    let okSum = 0, badSum = 0;
    for (let i = 0; i < 300; i++) {
      const a = answer(r, files);
      const ts = verifyCitations(a, dir, 3, sent);
      const [ok, bad] = awkCounts(a, dir, sent);
      okSum += ok; badSum += bad;
      if (ok !== ts.ok || bad !== ts.bad) diffs.push(`awk ${ok}/${bad} vs ts ${ts.ok}/${ts.bad}: ${a}`);
    }
    expect(diffs.slice(0, 5)).toEqual([]);
    // the random answers really exercise both outcomes
    expect(okSum).toBeGreaterThan(50);
    expect(badSum).toBeGreaterThan(50);
  }, 60_000);
});

describe("redaction stays linear", () => {
  test("200 KB of one unbroken run of letters, digits or URL-ish text: well under a second", async () => {
    const { redact } = await import("../src/secrets.ts");
    for (const s of ["a".repeat(200_000), "a1+".repeat(70_000), "x://".repeat(50_000), "https://u:p@h ".repeat(10_000)]) {
      const t0 = performance.now();
      redact(s);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});

describe("JSON structure of a big file (property test)", () => {
  test("bash (jq + awk) and TypeScript describe 60 random JSON files the same way", async () => {
    const { jsonStructure } = await import("../src/hooks/logic.ts");
    const { sandbox } = await import("./helpers");
    const s = sandbox();
    const r = rng(11);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const keys = ["id", "name", "my-key", "it's", "a\"b", "back\\slash", "ü", "0", "2", "10", "01", "-0", "1.0", "1e2", "4294967294", "4294967295", "", " sp", "x".repeat(40)];
    const scalar = () => pick<unknown>([1, -2.5, "s", true, false, null, 1e21]);
    const value = (depth: number): unknown => {
      const k = r();
      if (depth > 1 || k < 0.4) return scalar();
      if (k < 0.7) return Array.from({ length: Math.floor(r() * 1200) }, () => (r() < 0.8 ? { v: 1 } : scalar()));
      return Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, () => [pick(keys), value(depth + 1)]));
    };
    const pad = "\n".repeat(700);
    for (let i = 0; i < 60; i++) {
      const top = i % 10 === 0 ? value(1) : Object.fromEntries(Array.from({ length: 1 + Math.floor(r() * 40) }, (_, j) => [r() < 0.5 ? pick(keys) : `k${j}`, value(1)]));
      const f = `d${i}.json`;
      writeFileSync(join(s.dir, f), JSON.stringify(top, null, r() < 0.5 ? 2 : 0) + pad);
      const out = spawnSync(join(import.meta.dir, "../../../plugins/harness-offload/hooks/pre-read"), {
        input: JSON.stringify({ cwd: s.dir, tool_name: "Read", tool_input: { file_path: f } }),
        cwd: s.dir,
        env: { ...s.env, OFFLOAD_HOST: "opencode" },
        encoding: "utf8",
      });
      const reason: string = JSON.parse(out.stdout || "{}").hookSpecificOutput?.permissionDecisionReason ?? "";
      const bashBlock = reason.match(/Structure of .*\n((?:  .*\n?)*)/)?.[1]?.trimEnd() ?? "";
      const bashHint = reason.match(/- Need values\? Bash: (.*)/)?.[1] ?? "";
      const ts = jsonStructure(join(s.dir, f), statSync(join(s.dir, f)).size, f);
      expect(bashBlock.length).toBeGreaterThan(0);
      expect(`${f}\n${bashBlock}\n${bashHint}`).toBe(`${f}\n${ts?.lines.join("\n") ?? ""}\n${ts?.hint ?? ""}`);
    }
  }, 120_000);
});

describe("failure blocks (property test)", () => {
  test("bash (awk) and TypeScript cut the same blocks from 80 random test logs", async () => {
    const { failBlocks, textSrc } = await import("../src/digest.ts");
    const r = rng(23);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const frag = (i: number): string[] => {
      const long = "x".repeat(Math.floor(r() * 400));
      return pick([
        () => [`FAIL src/a${i}.test.ts`, `  ● suite › case ${i}`, "", "    Expected: 1", `    Received: ${i}`, "", `      at Object.<anonymous> (src/a${i}.test.ts:${i}:3)`, ""],
        () => [` FAIL  src/v${i}.test.ts > s > t${i}`, `AssertionError: expected ${i} to be 1`, ` ❯ src/v${i}.test.ts:${i}:9`, pick(["", " Test Files  1 failed | 3 passed (4)"])],
        () => [`${"_".repeat(10)} test_${i} ${"_".repeat(10)}`, "    def test():", ">       assert 1 == 2", "E       assert 1 == 2", "", `tests/t${i}.py:${i}: AssertionError`, pick(["=".repeat(20) + " short test summary " + "=".repeat(20), "_".repeat(5) + " test_next " + "_".repeat(5)])],
        () => ["--- FAIL: TestA (0.00s)", `    --- FAIL: TestA/sub${i} (0.00s)`, `        a_test.go:${i}: got ${i}`, "FAIL"],
        () => [`---- m::t${i} stdout ----`, `thread 'm::t${i}' panicked at src/m.rs:${i}:1:`, "  left: 1", " right: 2", "", "failures:"],
        () => [`PASS src/p${i}.test.ts`, `ok  	pkg/${i}	0.01s`, `\x1b[31mFAIL\x1b[0m  src/c${i}.test.ts > colour > red\r`, `boom ${long}`, ""],
        () => Array.from({ length: Math.floor(r() * 30) }, (_, j) => `    detail ${j} ${pick(["", long, "\t tabbed"])}`),
        () => [`  ● same block`, "    again", ""],
      ])();
    };
    const dir = mkdtempSync(join(tmpdir(), "offload-fail-"));
    const lib = join(import.meta.dir, "..", "..", "..", "plugins", "harness-offload", "lib");
    let found = 0;
    for (let i = 0; i < 80; i++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 25) }, (_, j) => frag(i * 100 + j)).flat();
      const text = lines.join("\n") + (r() < 0.5 ? "\n" : "");
      const f = join(dir, `t${i}.log`);
      writeFileSync(f, text);
      const [mb, ml, w] = r() < 0.5 ? [5, 12, 300] : [3, 6, 150];
      const sh = spawnSync("bash", ["-c", `. "$1/common.sh" && . "$1/digest.sh" && co_fail_blocks "$2" ${mb} ${ml} ${w}`, "_", lib, f], { encoding: "utf8" });
      const ts = failBlocks(textSrc(text), f, mb, ml, w);
      if (ts.length) found++;
      expect(`t${i}\n${sh.stdout}`).toBe(`t${i}\n${ts.length ? ts.join("\n") + "\n" : ""}`);
    }
    expect(found).toBeGreaterThan(60);
  }, 120_000);
});

describe("intent windows (property test)", () => {
  test("bash (awk) and TypeScript pick the same windows for 80 random logs and questions", async () => {
    const { intentWindows, textSrc } = await import("../src/digest.ts");
    const r = rng(31);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const words = ["cache", "lodash", "Failed", "failing", "build", "Step", "layer", "42", "6", "16", "0.6s", "ERROR", "error:", "warn", "the", "Case", "case_6", "über", "naïve", "\t", "\\n42", "x"];
    const dir = mkdtempSync(join(tmpdir(), "offload-intent-"));
    const lib = join(import.meta.dir, "..", "..", "..", "plugins", "harness-offload", "lib");
    let found = 0;
    for (let i = 0; i < 80; i++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 120) }, () => Array.from({ length: 1 + Math.floor(r() * 8) }, () => pick(words)).join(pick([" ", "/", "(", ": ", "-"])) + (r() < 0.05 ? "\r" : ""));
      const text = lines.join("\n") + (r() < 0.5 ? "\n" : "");
      const q = Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(words)).join(" ");
      const f = join(dir, `i${i}.log`);
      writeFileSync(f, text);
      const sh = spawnSync("bash", ["-c", `. "$1/common.sh" && . "$1/digest.sh" && co_intent_windows "$2" "$3" 120`, "_", lib, f, q], { encoding: "utf8" });
      const ts = intentWindows(textSrc(text), q, 120);
      if (ts.length) found++;
      expect(`i${i} [${q}]\n${sh.stdout}`).toBe(`i${i} [${q}]\n${ts.length ? ts.join("\n") + "\n" : ""}`);
    }
    expect(found).toBeGreaterThan(50);
  }, 120_000);
});

describe("token estimate (property test)", () => {
  test("bash (awk) and TypeScript estimate the same tokens for 60 random texts", async () => {
    const { estTokensText } = await import("../src/text.ts");
    const r = rng(41);
    const parts = ["abc", "12", "3.14", "2026-01-02", "über", "日本語", " ", "\n", "\t", "{}", "x9y", "007", "\r\n", "--", ""];
    const dir = mkdtempSync(join(tmpdir(), "offload-tok-"));
    const lib = join(import.meta.dir, "..", "..", "..", "plugins", "harness-offload", "lib");
    for (let i = 0; i < 60; i++) {
      const text = Array.from({ length: Math.floor(r() * 400) }, () => parts[Math.floor(r() * parts.length)]).join("");
      const f = join(dir, `t${i}.txt`);
      writeFileSync(f, text);
      const sh = spawnSync("bash", ["-c", `. "$1/common.sh" && co_tokens "$2" "$(wc -c < "$2" | tr -d ' ')"`, "_", lib, f], { encoding: "utf8" });
      expect(`t${i} ${sh.stdout.trim()}`).toBe(`t${i} ${estTokensText(text)}`);
    }
  }, 60_000);
});
