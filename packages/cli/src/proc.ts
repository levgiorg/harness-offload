import { ChildProcess, spawn, SpawnOptions, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killedBy?: string;
}

const isWin = process.platform === "win32";

// ------------------------------------------------------------ child registry

/** Workers still running; killed (whole tree) when offload itself goes away. */
const live = new Set<ChildProcess>();
let exitHooked = false;

function killTree(child: ChildProcess, sig: NodeJS.Signals = "SIGTERM"): void {
  if (!child.pid) return;
  // POSIX: the group outlives its leader, so stray descendants are reached even
  // after the worker itself exited. Windows: only while the worker still runs.
  if (isWin && child.exitCode !== null) return;
  try {
    if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, sig);
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill(sig);
    } catch {
      /* gone */
    }
  }
}

function track(child: ChildProcess): void {
  live.add(child);
  child.once("exit", () => live.delete(child));
  if (exitHooked) return;
  exitHooked = true;
  // Synchronous cleanup is all an "exit" listener may do; it also runs inside
  // host processes (OpenCode, Pi) without changing their signal handling.
  process.once("exit", () => {
    for (const c of live) killTree(c, "SIGKILL");
  });
}

/** For the CLI process only (never in-process plugins): forward termination. */
export function killChildrenOnSignals(): void {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      for (const c of live) killTree(c, "SIGTERM");
      process.exit(sig === "SIGINT" ? 130 : sig === "SIGTERM" ? 143 : 129);
    });
  }
}

// ------------------------------------------------------- Windows resolution

/** Quotes one argument for cmd.exe /s /c "…" (cmd metacharacters escaped with ^). */
function cmdQuote(arg: string): string {
  // backslashes before a quote (or the end) are doubled, quotes escaped, all wrapped
  let a = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  a = `"${a}"`;
  // cmd.exe cannot carry newlines inside a command line
  a = a.replace(/\r?\n/g, " ");
  return a.replace(/[()[\]%!^"`<>&|;, *?]/g, "^$&");
}

/** For an npm-style .cmd shim, the JS file it runs with node (no cmd.exe needed). */
function shimTarget(cmdFile: string): string | undefined {
  try {
    const text = readFileSync(cmdFile, "utf8");
    const m = text.match(/"%(?:~?dp0|dp0)%\\?([^"%]+\.(?:c|m)?js)"/i);
    if (!m) return undefined;
    const js = resolvePath(dirname(cmdFile), m[1].replace(/\\/g, "/"));
    return existsSync(js) ? js : undefined;
  } catch {
    return undefined;
  }
}

/** How to start cmd on this platform without shell injection. */
function plan(cmd: string, args: string[]): { file: string; args: string[]; opts: SpawnOptions } {
  if (!isWin) return { file: cmd, args, opts: {} };
  const found = whichSync(cmd) ?? cmd;
  const ext = extname(found).toLowerCase();
  if (ext === ".exe" || ext === ".com" || ext === "") return { file: found, args, opts: { windowsHide: true } };
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { file: process.execPath, args: [found, ...args], opts: { windowsHide: true } };
  if (ext === ".cmd" || ext === ".bat") {
    const js = shimTarget(found);
    if (js) return { file: process.execPath, args: [js, ...args], opts: { windowsHide: true } };
    const line = [cmdQuote(found), ...args.map(cmdQuote)].join(" ");
    return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: found, args, opts: { windowsHide: true } };
}

/** Spawns without a shell on every platform (see plan()). */
export function spawnSafe(cmd: string, args: string[], opts: SpawnOptions): ChildProcess {
  const p = plan(cmd, args);
  return spawn(p.file, p.args, { ...opts, ...p.opts, shell: false });
}

// ------------------------------------------------------------------- runner

/**
 * Spawns a process with stdin text, a timeout, and an optional watchdog that
 * can abort early by inspecting the output so far (returns a reason to kill).
 * Resolves when the process exits (plus a short drain for its output), even if
 * a stray descendant keeps the pipes open; such descendants are killed.
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
    /** Abort (e.g. an MCP request cancelled by the client) kills the tree. */
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killedBy: string | undefined;
    let child: ChildProcess;
    try {
      // POSIX: own process group, so a timeout kills the whole tree.
      child = spawnSafe(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], detached: !isWin });
    } catch (e) {
      resolve({ code: 127, stdout: "", stderr: String(e), timedOut: false });
      return;
    }
    track(child);
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      // descendants that outlived the worker (LSP/MCP servers, flushers)
      killTree(child, "SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code, stdout, stderr, timedOut, killedBy });
    };
    const kill = () => {
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 1000).unref();
      // don't wait for pipes held open by stray descendants
      setTimeout(() => finish(null), 2500).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) kill();
      else
        opts.signal.addEventListener(
          "abort",
          () => {
            killedBy = "cancelled";
            kill();
          },
          { once: true },
        );
    }
    const poll = opts.watchdog
      ? setInterval(() => {
          const why = opts.watchdog!(stdout, stderr);
          if (why) {
            killedBy = why;
            kill();
          }
        }, 300)
      : undefined;
    // utf8 decoding at the stream level keeps characters split across chunks intact
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => (stdout += d));
    child.stderr!.on("data", (d: string) => (stderr += d));
    child.on("error", (e) => {
      stderr += String(e);
      finish(127);
    });
    child.on("close", (code) => finish(code));
    // the worker is done; give its last output a moment, then stop waiting
    child.on("exit", (code) => setTimeout(() => finish(code), 500).unref());
    child.stdin!.on("error", () => {
      /* child may exit before reading stdin */
    });
    child.stdin!.end(opts.input ?? "");
  });
}

/** Fire-and-forget (session cleanup and the like); never throws, never crashes. */
export function spawnDetached(cmd: string, args: string[], cwd: string): void {
  try {
    const child = spawnSafe(cmd, args, { cwd, detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* best-effort */
    });
    child.unref();
  } catch {
    /* best-effort */
  }
}

function whichSync(cmd: string): string | undefined {
  if (isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd) ? cmd : undefined;
  const exts = isWin ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (process.env.PATH || process.env.Path || "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      for (const p of [join(dir, cmd + ext.toLowerCase()), join(dir, cmd + ext)]) if (existsSync(p)) return p;
    }
  }
  return undefined;
}

/** Resolves a command on PATH (or an explicit path). */
export async function which(cmd: string): Promise<string | undefined> {
  return whichSync(cmd);
}
