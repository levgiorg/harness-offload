#!/usr/bin/env bash
# Real Claude Code, with and without the offload plugin, on the same scripted
# session: a mock Anthropic API (plugins/harness-offload/tests/mock_anthropic.py)
# answers instantly and asks for the same tool calls every run, so the time
# difference is what the plugin's hooks add, and the tool results show what
# the model would have had to read. No real model, no tokens; the offload
# worker is the offline stub.
#
#   bash bench/claude-e2e.sh [RUNS]        (default 5 runs each, alternating)
#   CLAUDE_BIN=/path/to/claude bash bench/claude-e2e.sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN="$ROOT/plugins/harness-offload"
RUNS="${1:-5}"
claude_bin="${CLAUDE_BIN:-$(command -v claude)}"
[ -x "$claude_bin" ] || { echo "claude binary not found (set CLAUDE_BIN)" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is needed for the mock API" >&2; exit 2; }

W=$(mktemp -d "${TMPDIR:-/tmp}/offload-claude-bench.XXXXXX")
trap 'kill "$mock_pid" 2>/dev/null; rm -rf "${W:?}"' EXIT
P="$W/project"
mkdir -p "$P" "$W/home" "$W/state"
awk 'BEGIN { for (i = 1; i <= 80; i++) printf "export const v%d = %d;\n", i, i }' > "$P/small.ts"
awk 'BEGIN { for (i = 1; i <= 5000; i++) print (i % 50 == 1 ? "export function s" i "(a: number): number {" : (i % 50 == 0 ? "}" : "  const x" i " = a + " i "; // padding")) }' > "$P/big.ts"

# 17 tool calls, the mix of a short coding session: mostly small reads and
# commands that pass straight through, one big read (blocked with an outline
# and options), one slice of it, one long test-style output (digested).
cat > "$W/script.json" <<EOF
[
 {"name": "Read", "input": {"file_path": "$P/small.ts"}},
 {"name": "Bash", "input": {"command": "ls -la", "description": "list"}},
 {"name": "Read", "input": {"file_path": "$P/small.ts", "offset": 10, "limit": 20}},
 {"name": "Bash", "input": {"command": "git status 2>/dev/null || echo no-git", "description": "status"}},
 {"name": "Read", "input": {"file_path": "$P/big.ts"}},
 {"name": "Read", "input": {"file_path": "$P/big.ts", "offset": 100, "limit": 200}},
 {"name": "Bash", "input": {"command": "grep -n 'export function' big.ts", "description": "find"}},
 {"name": "Bash", "input": {"command": "cat small.ts", "description": "show"}},
 {"name": "Read", "input": {"file_path": "$P/small.ts"}},
 {"name": "Bash", "input": {"command": "awk 'BEGIN { for (i = 1; i <= 4000; i++) print (i % 500 == 0 ? \"FAIL test_\" i \" expected 1 got 2\" : \"ok test_\" i) }'", "description": "run the tests"}},
 {"name": "Bash", "input": {"command": "ls", "description": "list"}},
 {"name": "Read", "input": {"file_path": "$P/small.ts", "offset": 1, "limit": 40}},
 {"name": "Bash", "input": {"command": "wc -l big.ts small.ts", "description": "count"}},
 {"name": "Read", "input": {"file_path": "$P/small.ts"}},
 {"name": "Bash", "input": {"command": "echo done", "description": "echo"}},
 {"name": "Read", "input": {"file_path": "$P/small.ts", "offset": 50, "limit": 10}},
 {"name": "Bash", "input": {"command": "pwd", "description": "where"}}
]
EOF
calls=$(grep -c '"name"' "$W/script.json")

port="${MOCK_PORT:-18091}"
: > "$W/mock.log"
MOCK_PORT="$port" MOCK_SCRIPT="$W/script.json" MOCK_LOG="$W/mock.log" python3 "$PLUGIN/tests/mock_anthropic.py" > "$W/mock.out" 2>&1 &
mock_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s --noproxy '*' -m 1 "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
  sleep 0.3
done

now_ms() { if [ -n "${EPOCHREALTIME:-}" ]; then local t=${EPOCHREALTIME/./}; echo $(( t / 1000 )); else echo $(( $(date +%s) * 1000 )); fi; }

# one Claude Code session; $1 = on|off
run() {
  local mode="$1" t0 t1 plugin_args=()
  [ "$mode" = on ] && plugin_args=(--plugin-dir "$PLUGIN")
  : > "$W/mock.log"
  t0=$(now_ms)
  (
    cd "$P" || exit 1
    env -i HOME="$W/home" PATH="$PATH" TERM=dumb \
      ANTHROPIC_API_KEY=sk-ant-bench ANTHROPIC_BASE_URL="http://127.0.0.1:$port" \
      NO_PROXY=127.0.0.1,localhost CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 \
      OFFLOAD_STATE_DIR="$W/state" OFFLOAD_CONFIG="$W/config.json" OFFLOAD_MODEL=stub/ok \
      OFFLOAD_OPENCODE_BIN="$PLUGIN/tests/stub-opencode" STUB_VERSION=1.19.5 \
      "$claude_bin" -p "Run the scripted session" "${plugin_args[@]}" \
        --allowedTools "Read,Bash,Grep,Glob" --output-format json --model claude-opus-5-5 \
        > "$W/claude-$mode.json" 2> "$W/claude-$mode.err"
  )
  t1=$(now_ms)
  local results bytes
  results=$(grep -c '"kind": "tool_result"' "$W/mock.log" 2>/dev/null || echo 0)
  bytes=$(python3 -c '
import json, sys
n = 0
for line in open(sys.argv[1]):
    o = json.loads(line)
    if o.get("kind") == "tool_result": n += len(o.get("text", "").encode())
print(n)' "$W/mock.log" 2>/dev/null || echo 0)
  echo "$mode $((t1 - t0)) $results $bytes"
}

echo "Claude Code $("$claude_bin" --version 2>/dev/null | head -1) · $calls tool calls per session · $RUNS runs each (alternating) · mock model answers instantly"
run off > /dev/null; run on > /dev/null   # warm-up (caches, first-run setup)
: > "$W/runs.txt"
for _ in $(seq "$RUNS"); do run off >> "$W/runs.txt"; run on >> "$W/runs.txt"; done
python3 - "$W/runs.txt" "$calls" <<'EOF'
import sys, statistics as st
rows = [l.split() for l in open(sys.argv[1]) if l.strip()]
calls = int(sys.argv[2])
by = {m: [r for r in rows if r[0] == m] for m in ("off", "on")}
def med(m, i): return st.median(int(r[i]) for r in by[m])
off, on = med("off", 1), med("on", 1)
print(f"| | plugin off | plugin on |\n|---|---:|---:|")
print(f"| session wall time, median | {off:.0f} ms | {on:.0f} ms |")
print(f"| tool results seen by the model | {med('off', 2):.0f} | {med('on', 2):.0f} |")
print(f"| bytes of tool results sent to the model | {med('off', 3):,.0f} | {med('on', 3):,.0f} |")
print(f"\nadded per session: {on - off:+.0f} ms ({(on - off) / max(calls, 1):+.1f} ms per tool call); "
      f"the model reads {med('off', 3) - med('on', 3):,.0f} fewer bytes (~{(med('off', 3) - med('on', 3)) / 4:,.0f} tokens) per session")
EOF
