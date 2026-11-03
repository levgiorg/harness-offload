// Property tests for the citation verifier: random answers, fixed seed, both engines compared.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
