import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killedBy?: string;
}

/**
 * Spawns a process with stdin text, a timeout, and an optional watchdog that
 * can abort early by inspecting the output so far (returns a reason to kill).
 */
export function runProcess(
  cmd: string,
  args: string[],
  opts: {
    input?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    watchdog?: (stdout: string, stderr: string) => string | undefined;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killedBy: string | undefined;
    let child;
    try {
      // POSIX: own process group, so a timeout kills the whole tree (a stuck
      // grandchild holding our pipes would otherwise keep us waiting).
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        shell: process.platform === "win32" && !cmd.includes("/") && !cmd.includes("\\"),
      });
    } catch (e) {
      resolve({ code: 127, stdout: "", stderr: String(e), timedOut: false });
      return;
    }
    let done = false;
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* gone */
        }
      }
    };
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      resolve({ code, stdout, stderr, timedOut, killedBy });
    };
    const kill = () => {
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), 1000).unref();
      // don't wait for pipes held open by stray descendants
      setTimeout(() => finish(null), 2500).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const poll = opts.watchdog
      ? setInterval(() => {
          const why = opts.watchdog!(stdout, stderr);
          if (why) {
            killedBy = why;
            kill();
          }
        }, 300)
      : undefined;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      stderr += String(e);
    });
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {
      /* child may exit before reading stdin */
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** Resolves a command on PATH (or an explicit path). */
export async function which(cmd: string): Promise<string | undefined> {
  const { existsSync } = await import("node:fs");
  const { delimiter, join } = await import("node:path");
  if (cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd) ? cmd : undefined;
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext.toLowerCase());
      if (existsSync(p)) return p;
      const p2 = join(dir, cmd + ext);
      if (existsSync(p2)) return p2;
    }
  }
  return undefined;
}
