import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CLI = resolve(import.meta.dir, "../dist/cli.js");
export const STUB = resolve(import.meta.dir, "../../../plugins/harness-offload/tests/stub-opencode");

export function sandbox(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "offload-test-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OFFLOAD_STATE_DIR: join(dir, "state"),
    OFFLOAD_CONFIG: join(dir, "config.json"),
    OFFLOAD_PROJECT_DIR: dir,
    OFFLOAD_OPENCODE_BIN: STUB,
    OFFLOAD_MODEL: "stub/ok",
    STUB_VERSION: "1.19.5",
    NO_COLOR: "1",
  };
  delete env.OFFLOAD_DISABLE;
  delete env.OFFLOAD_READ_GUARD;
  writeFileSync(join(dir, "big.ts"), Array.from({ length: 900 }, (_, i) => `export function f${i}(a: number): number { return a + ${i} }`).join("\n") + "\n");
  writeFileSync(join(dir, "small.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "build.log"), Array.from({ length: 400 }, (_, i) => `step ${i} ok`).join("\n") + "\nERROR: src/a.ts:3 boom\n");
  return { dir, env };
}

export function cli(args: string[], opts: { env: NodeJS.ProcessEnv; input?: string; cwd?: string }) {
  const r = spawnSync("node", [CLI, ...args], { env: opts.env, input: opts.input ?? "", cwd: opts.cwd, encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function hook(host: string, event: string, input: object, s: { dir: string; env: NodeJS.ProcessEnv }) {
  const r = cli(["hook", host, event], { env: s.env, input: JSON.stringify({ cwd: s.dir, ...input }), cwd: s.dir });
  return r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
}
