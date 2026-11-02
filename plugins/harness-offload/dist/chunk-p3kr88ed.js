import {
  childProcess
} from "./chunk-z2qytrf7.js";

// src/proc.ts
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
var isWin = process.platform === "win32";
var live = new Set;
var exitHooked = false;
function killTree(child, sig = "SIGTERM") {
  if (!child.pid)
    return;
  if (isWin && child.exitCode !== null)
    return;
  try {
    if (isWin)
      childProcess().spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
    else
      process.kill(-child.pid, sig);
  } catch {
    if (child.exitCode !== null || child.signalCode !== null)
      return;
    try {
      child.kill(sig);
    } catch {}
  }
}
function track(child) {
  live.add(child);
  child.once("exit", () => live.delete(child));
  if (exitHooked)
    return;
  exitHooked = true;
  process.once("exit", () => {
    for (const c of live)
      killTree(c, "SIGKILL");
  });
}
function killChildrenOnSignals() {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(sig, () => {
      for (const c of live)
        killTree(c, "SIGTERM");
      process.exit(sig === "SIGINT" ? 130 : sig === "SIGTERM" ? 143 : 129);
    });
  }
}
function cmdQuote(arg) {
  let a = arg.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/, "$1$1");
  a = `"${a}"`;
  a = a.replace(/\r?\n/g, " ");
  return a.replace(/[()[\]%!^"`<>&|;, *?]/g, "^$&");
}
function shimTarget(cmdFile) {
  try {
    const text = readFileSync(cmdFile, "utf8");
    const m = text.match(/"%(?:~?dp0|dp0)%\\?([^"%]+\.(?:c|m)?js)"/i);
    if (!m)
      return;
    const js = resolvePath(dirname(cmdFile), m[1].replace(/\\/g, "/"));
    return existsSync(js) ? js : undefined;
  } catch {
    return;
  }
}
function plan(cmd, args) {
  if (!isWin)
    return { file: cmd, args, opts: {} };
  const found = whichSync(cmd) ?? cmd;
  const ext = extname(found).toLowerCase();
  if (ext === ".exe" || ext === ".com" || ext === "")
    return { file: found, args, opts: { windowsHide: true } };
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
    return { file: process.execPath, args: [found, ...args], opts: { windowsHide: true } };
  if (ext === ".cmd" || ext === ".bat") {
    const js = shimTarget(found);
    if (js)
      return { file: process.execPath, args: [js, ...args], opts: { windowsHide: true } };
    const line = [cmdQuote(found), ...args.map(cmdQuote)].join(" ");
    return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { windowsVerbatimArguments: true, windowsHide: true } };
  }
  return { file: found, args, opts: { windowsHide: true } };
}
function spawnSafe(cmd, args, opts) {
  const p = plan(cmd, args);
  return childProcess().spawn(p.file, p.args, { ...opts, ...p.opts, shell: false });
}
function runProcess(cmd, args, opts) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killedBy;
    let child;
    try {
      child = spawnSafe(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], detached: !isWin });
    } catch (e) {
      resolve({ code: 127, stdout: "", stderr: String(e), timedOut: false });
      return;
    }
    track(child);
    let done = false;
    const finish = (code) => {
      if (done)
        return;
      done = true;
      clearTimeout(timer);
      if (poll)
        clearInterval(poll);
      killTree(child, "SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code, stdout, stderr, timedOut, killedBy });
    };
    const kill = () => {
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 1000).unref();
      setTimeout(() => finish(null), 2500).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted)
        kill();
      else
        opts.signal.addEventListener("abort", () => {
          killedBy = "cancelled";
          kill();
        }, { once: true });
    }
    const poll = opts.watchdog ? setInterval(() => {
      const why = opts.watchdog(stdout, stderr);
      if (why) {
        killedBy = why;
        kill();
      }
    }, 300) : undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => stdout += d);
    child.stderr.on("data", (d) => stderr += d);
    child.on("error", (e) => {
      stderr += String(e);
      finish(127);
    });
    child.on("close", (code) => finish(code));
    child.on("exit", (code) => setTimeout(() => finish(code), 500).unref());
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
}
function spawnDetached(cmd, args, cwd) {
  try {
    const child = spawnSafe(cmd, args, { cwd, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
function whichSync(cmd) {
  if (isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\"))
    return existsSync(cmd) ? cmd : undefined;
  const exts = isWin ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (process.env.PATH || process.env.Path || "").split(delimiter)) {
    if (!dir)
      continue;
    for (const ext of exts) {
      for (const p of [join(dir, cmd + ext.toLowerCase()), join(dir, cmd + ext)])
        if (existsSync(p))
          return p;
    }
  }
  return;
}
async function which(cmd) {
  return whichSync(cmd);
}

export { killChildrenOnSignals, spawnSafe, runProcess, spawnDetached, which };
