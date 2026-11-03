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
