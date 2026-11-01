#!/usr/bin/env bash
# Runs the host-neutral routing table (hooks.json) against a hook implementation.
#   evals/run.sh                 bash hooks of the Claude Code plugin
#   evals/run.sh --ts            TypeScript hook adapter (`offload hook claude <event>`)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PLUGIN="$ROOT/plugins/code-offload"
engine=bash
[ "${1:-}" = "--ts" ] && engine=ts

T=$(mktemp -d "${TMPDIR:-/tmp}/offload-evals.XXXXXX")
trap 'rm -rf "$T" 2>/dev/null' EXIT
D="$T/fx"
"$HERE/fixtures/generate.sh" "$D" >/dev/null
cp -r "$HERE/fixtures/warehouse" "$D/"
printf '\000\001\002binary' > "$D/blob.bin"
awk 'BEGIN { for (i = 1; i <= 1000; i++) print i }' > "$D/short-lines.txt"
awk 'BEGIN { for (i = 0; i < 900; i++) print "TOKEN_" i "=x" }' > "$D/.env"

export CLAUDE_PLUGIN_ROOT="$PLUGIN"
export OFFLOAD_OPENCODE_BIN="$PLUGIN/tests/stub-opencode" OFFLOAD_MODEL=stub/ok
export OFFLOAD_STATE_DIR="$T/state" OFFLOAD_CONFIG="$T/none.json"
unset OFFLOAD_DISABLE OFFLOAD_READ_GUARD OFFLOAD_MIN_LINES OPENCODE_CONFIG_CONTENT

run_hook() { # event json
  if [ "$engine" = ts ]; then
    node "$ROOT/packages/cli/dist/cli.js" hook claude "$1"
  else
    "$PLUGIN/hooks/$1"
  fi
}

pass=0 fail=0
check() { # suite index event input-json
  local suite="$1" i="$2" event="$3" input="$4" name expect env got out
  name=$(jq -r ".${suite}[$i].name" "$HERE/hooks.json")
  expect=$(jq -r ".${suite}[$i].expect" "$HERE/hooks.json")
  env=$(jq -r ".${suite}[$i].env // {} | to_entries | map(\"\(.key)=\(.value)\") | join(\" \")" "$HERE/hooks.json")
  # shellcheck disable=SC2086
  out=$(printf '%s' "$input" | env $env bash -c "$(declare -f run_hook); engine=$engine; ROOT='$ROOT'; PLUGIN='$PLUGIN'; run_hook $event")
  got=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
  [ -z "$got" ] && got=allow
  if [ "$got" = "$expect" ]; then pass=$((pass + 1)); printf '  ok    %-5s %s\n' "$suite" "$name"
  else fail=$((fail + 1)); printf '  FAIL  %-5s %s: expected %s, got %s\n' "$suite" "$name" "$expect" "$got"; fi
}

n=$(jq '.read | length' "$HERE/hooks.json"); i=0
while [ "$i" -lt "$n" ]; do
  input=$(jq -c --arg d "$D" --arg c "$D" ".read[$i].input | {cwd: \$c, tool_name: \"Read\", tool_input: (. | walk(if type == \"string\" then (split(\"{{DIR}}\") | join(\$d)) else . end))}" "$HERE/hooks.json")
  check read "$i" pre-read "$input"; i=$((i + 1))
done
n=$(jq '.bash | length' "$HERE/hooks.json"); i=0
while [ "$i" -lt "$n" ]; do
  input=$(jq -c --arg d "$D" --arg c "$D" ".bash[$i] | {cwd: \$c, tool_name: \"Bash\", tool_input: {command: (.command | split(\"{{DIR}}\") | join(\$d))}}" "$HERE/hooks.json")
  check bash "$i" pre-bash "$input"; i=$((i + 1))
done
printf '\n%d passed, %d failed (engine: %s)\n' "$pass" "$fail" "$engine"
[ "$fail" -eq 0 ]
