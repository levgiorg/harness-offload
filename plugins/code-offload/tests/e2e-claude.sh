#!/usr/bin/env bash
# End-to-end check inside the real Claude Code binary, with no real model:
# a scripted mock of the Anthropic API (mock_anthropic.py) asks Claude Code
# to make the tool calls in SCRIPT_JSON; the plugin's hooks run for real, and
# the tool results Claude Code would send back to the model are captured.
#
# Usage: tests/e2e-claude.sh SCRIPT_JSON WORKDIR [OUT_DIR]
# Env:   anything the plugin needs (OFFLOAD_*, OPENCODE_CONFIG_CONTENT, PATH
#        with opencode); CLAUDE_BIN overrides the claude binary.
# Prints the path of the capture log (JSON lines, kind=tool_result).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
script="$1"; workdir="$2"; out="${3:-$(mktemp -d "${TMPDIR:-/tmp}/offload-e2e.XXXXXX")}"
port="${MOCK_PORT:-18090}"
claude_bin="${CLAUDE_BIN:-$(command -v claude)}"
[ -x "$claude_bin" ] || { echo "claude binary not found" >&2; exit 2; }

mkdir -p "$out/home"
: > "$out/mock.log"
MOCK_PORT="$port" MOCK_SCRIPT="$script" MOCK_LOG="$out/mock.log" python3 "$HERE/mock_anthropic.py" > "$out/mock.out" 2>&1 &
mock_pid=$!
trap 'kill $mock_pid 2>/dev/null' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s --noproxy '*' -m 1 "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
  sleep 0.3
done

(
  cd "$workdir" || exit 1
  env -i HOME="$out/home" PATH="$PATH" TERM=dumb \
    ANTHROPIC_API_KEY=sk-ant-e2e ANTHROPIC_BASE_URL="http://127.0.0.1:$port" \
    NO_PROXY=127.0.0.1,localhost CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 \
    ${OFFLOAD_STATE_DIR:+OFFLOAD_STATE_DIR="$OFFLOAD_STATE_DIR"} \
    ${OFFLOAD_MODEL:+OFFLOAD_MODEL="$OFFLOAD_MODEL"} \
    ${OFFLOAD_OPENCODE_BIN:+OFFLOAD_OPENCODE_BIN="$OFFLOAD_OPENCODE_BIN"} \
    ${OFFLOAD_CONFIG:+OFFLOAD_CONFIG="$OFFLOAD_CONFIG"} \
    ${OFFLOAD_NO_MODEL:+OFFLOAD_NO_MODEL="$OFFLOAD_NO_MODEL"} \
    ${OFFLOAD_DEBUG_DIR:+OFFLOAD_DEBUG_DIR="$OFFLOAD_DEBUG_DIR"} \
    ${OPENCODE_CONFIG_CONTENT:+OPENCODE_CONFIG_CONTENT="$OPENCODE_CONFIG_CONTENT"} \
    "$claude_bin" -p "Run the scripted session" --plugin-dir "$PLUGIN" \
      --allowedTools "Read,Bash,Grep,Glob" --output-format json --model claude-opus-5-5 \
      > "$out/claude.json" 2> "$out/claude.err"
)
echo "$out/mock.log"
