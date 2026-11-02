#!/usr/bin/env python3
"""Drive an interactive CLI in a real pseudo-terminal, the way a person would.

usage: pty-run.py STEPS_JSON -- CMD [ARGS...]
STEPS_JSON: [[regex, keys], ...] — wait until the (ANSI-stripped) output
matches regex, then type keys ("\\r" Enter, " " space, "\\u001b[B" down,
"\\u0003" Ctrl-C). Prints the stripped output; exits with the command's code,
or 99 when a prompt never appeared (and says which).
"""
import fcntl, json, os, pty, re, select, struct, sys, termios, time

steps = json.loads(sys.argv[1])
cmd = sys.argv[sys.argv.index("--") + 1:]
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|\x1b[=>]|\r")

pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 140, 0, 0))

raw = b""
def pump(deadline):
    global raw
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return False
            if not chunk:
                return False
            raw += chunk
        else:
            return True
    return True

def text():
    return ANSI.sub("", raw.decode("utf8", "replace"))

pos = 0
for pattern, keys in steps:
    end = time.time() + 25
    while True:
        alive = pump(time.time() + 0.2)
        m = re.compile(pattern).search(text(), pos)
        if m:
            pos = m.end()
            break
        if not alive or time.time() > end:
            sys.stdout.write(text())
            sys.stdout.write(f"\n[pty-run] TIMEOUT waiting for: {pattern}\n")
            try:
                os.kill(pid, 9)
            except OSError:
                pass
            sys.exit(99)
    time.sleep(0.15)  # let the prompt finish drawing before typing
    os.write(fd, keys.encode())

end = time.time() + 60
while time.time() < end and pump(time.time() + 0.5):
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        break
    if done:
        pump(time.time() + 0.3)
        sys.stdout.write(text())
        sys.exit(os.waitstatus_to_exitcode(status))
pump(time.time() + 0.3)
sys.stdout.write(text())
try:
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))
except ChildProcessError:
    sys.exit(0)
