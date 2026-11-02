#!/usr/bin/env bash
# End-to-end runs inside real agent harnesses, each in a throwaway HOME, driven
# by a scripted mock model (tests/mock_openai.py, mode "script"): the model
# reads a 3,000-line file, then runs `seq 1 400`, then answers. We check what
# the harness sent back to the model after Harness Offload's hooks ran, then
# use the same harness as the worker (`-m @host`) from both engines.
#
#   bash tests/e2e-hosts.sh [copilot] [crush] [qwen]     (default: every host found)
#
# Binaries: COPILOT_BIN, CRUSH_BIN, QWEN_CMD (e.g. "node …/cli-entry.js"), else PATH.
# Needs python3, node, jq. No accounts: every request goes to the local mock.

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
CLI_JS="$PLUGIN/dist/cli.js"
T=$(mktemp -d "${TMPDIR:-/tmp}/offload-e2e-hosts.XXXXXX")
trap 'kill "$MPID" 2>/dev/null; rm -rf "$T"' EXIT
PASS=0 FAIL=0 SKIP=0
ok()   { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  skip  %s\n' "$1"; }
has()  { grep -qF -- "$2" "$1" 2>/dev/null; }

hosts="$*"; [ -z "$hosts" ] && hosts="copilot crush qwen"
PORT=$(( 21000 + $$ % 20000 ))

# Worker: the stub agent CLI standing in for claude:haiku (the hosts are real, the model is not).
mkdir -p "$T/bin"
ln -s "$HERE/stub-agent" "$T/bin/claude"
awk 'BEGIN { for (i = 1; i <= 3000; i++) printf "export function fn%d(a: number) { return a + %d }\n", i, i }' > "$T/big.ts"

start_mock() { # start_mock SCRIPT_JSON LOG
  kill "$MPID" 2>/dev/null
  MOCK_PORT=$PORT MOCK_MODE=script MOCK_SCRIPT="$1" MOCK_LOG="$2" python3 "$HERE/mock_openai.py" >/dev/null 2>&1 &
  MPID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s --noproxy '*' -m 1 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1 && return 0; sleep 0.3; done
  return 1
}

# The last request's tool results (what the model saw after the hooks), one per line.
tool_results() { tail -n 1 "$1" | jq -r '.messages[] | select(.role == "tool") | .content | if type == "array" then map(.text // "") | join("") else . end' 2>/dev/null; }

# worker HOST ENV... — `offload ask -m @host` from both engines, the harness as the worker
worker() {
  local host="$1" eng out rc; shift
  printf '{"steps":[{"text":"WORKER-OK from %s"}]}' "$host" > "$T/worker-$host.json"
  start_mock "$T/worker-$host.json" "$T/worker-$host.log" || { bad "$host worker: mock did not start"; return; }
  for eng in bash ts; do
    if [ "$eng" = bash ]; then set -- "$PLUGIN/bin/offload"; else set -- node "$CLI_JS"; fi
    # shellcheck disable=SC2046
    out=$(cd "$T" && env -i $(common_env "$host-$eng") $WENV OFFLOAD_HOST="$host" OFFLOAD_MODEL= timeout 180 "$@" ask -m @host "Reply with one word." 2>&1); rc=$?
    case "$out" in
      *"WORKER-OK"*|*"ok"*) [ "$rc" = 0 ] && ok "$host worker ($eng engine): @host → $host CLI answered" || bad "$host worker ($eng engine): exit $rc" ;;
      *) bad "$host worker ($eng engine): $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-200)" ;;
    esac
  done
}

check() { # check HOST LOG [no-digest]
  local host="$1" log="$2" seen="$T/$1.seen"
  tool_results "$log" > "$seen"
  if has "$seen" "would put all of" && has "$seen" "Outline of"; then ok "$host: 3,000-line read held back with an outline"; else bad "$host: big read not held back"; fi
  if [ "${3:-}" = no-digest ]; then
    if has "$seen" "400"; then ok "$host: shell output passes through (host can't replace it)"; else bad "$host: shell output missing"; fi
  elif has "$seen" "[offload] \`seq 1 400\`"; then ok "$host: long output replaced by the digest"; else bad "$host: long output not digested"; fi
  if grep -q "offload is installed" "$log" 2>/dev/null; then ok "$host: guide reached the model"; else bad "$host: guide missing"; fi
}

common_env() {
  printf '%s\n' "PATH=$T/bin:/usr/local/bin:/usr/bin:/bin" "TERM=dumb" "OFFLOAD_MODEL=claude:haiku" \
    "OFFLOAD_STATE_DIR=$T/state-$1" "OFFLOAD_CONFIG=$T/none.json" "NO_PROXY=127.0.0.1,localhost"
}

run_copilot() {
  local bin="${COPILOT_BIN:-$(command -v copilot)}" h="$T/home-copilot" ws="$T/ws-copilot"
  [ -x "$bin" ] || { skip "copilot (set COPILOT_BIN)"; return; }
  mkdir -p "$h" "$ws"; cp "$T/big.ts" "$ws/"
  printf '{"steps":[{"tool":"view","args":{"path":"%s/big.ts"}},{"tool":"bash","args":{"command":"seq 1 400","description":"count"}},{"text":"done"}]}' "$ws" > "$T/copilot.json"
  start_mock "$T/copilot.json" "$T/copilot.log" || { bad "copilot: mock did not start"; return; }
  # shellcheck disable=SC2046
  env -i $(common_env copilot) HOME="$h" COPILOT_OFFLINE=true COPILOT_AUTO_UPDATE=false \
    "$bin" plugin marketplace add "$(cd "$PLUGIN/../.." && pwd)" >/dev/null 2>&1
  # shellcheck disable=SC2046
  env -i $(common_env copilot) HOME="$h" COPILOT_OFFLINE=true COPILOT_AUTO_UPDATE=false \
    "$bin" plugin install harness-offload@harness-offload >/dev/null 2>&1
  # shellcheck disable=SC2046
  (cd "$ws" && env -i $(common_env copilot) HOME="$h" COPILOT_OFFLINE=true COPILOT_AUTO_UPDATE=false CI=1 \
    COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:$PORT/v1" COPILOT_PROVIDER_TYPE=openai COPILOT_PROVIDER_API_KEY=x COPILOT_MODEL=mock-model \
    timeout 180 "$bin" -p "please test" --allow-all-tools --no-auto-update --trust-folder >/dev/null 2>&1)
  check copilot "$T/copilot.log"
  WENV="HOME=$h COPILOT_OFFLINE=true COPILOT_AUTO_UPDATE=false COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:$PORT/v1 COPILOT_PROVIDER_TYPE=openai COPILOT_PROVIDER_API_KEY=x COPILOT_MODEL=mock-model PATH_EXTRA=$(dirname "$bin")"
  ln -sf "$bin" "$T/bin/copilot"
  worker copilot
}

run_crush() {
  local bin="${CRUSH_BIN:-$(command -v crush)}" cfg="$T/cfg-crush" ws="$T/ws-crush"
  [ -x "$bin" ] || { skip "crush (set CRUSH_BIN)"; return; }
  mkdir -p "$cfg/crush" "$ws"; cp "$T/big.ts" "$ws/"; (cd "$ws" && git init -q . 2>/dev/null)
  cat > "$cfg/crush/crushrc" <<EOF
option provider-auto-update false
option metrics false
provider add mock --type completions --base-url "http://127.0.0.1:$PORT/v1" --api-key x
model add mock/mock-model --name Mock --context-window 128000 --default-max-tokens 1000
model large mock/mock-model
model small mock/mock-model
EOF
  printf '{"steps":[{"tool":"view","args":{"file_path":"%s/big.ts"}},{"tool":"bash","args":{"command":"seq 1 400","description":"count"}},{"text":"done"}]}' "$ws" > "$T/crush.json"
  start_mock "$T/crush.json" "$T/crush.log" || { bad "crush: mock did not start"; return; }
  PATH="$(dirname "$bin"):$PATH" XDG_CONFIG_HOME="$cfg" OFFLOAD_STATE_DIR="$T/state-crush" OFFLOAD_CONFIG="$T/none.json" \
    node "$CLI_JS" install crush >/dev/null 2>&1 || { bad "crush: offload install crush failed"; return; }
  # shellcheck disable=SC2046
  (cd "$ws" && env -i $(common_env crush) HOME="$T/home-crush" XDG_CONFIG_HOME="$cfg" XDG_DATA_HOME="$T/data-crush" \
    timeout 180 "$bin" run "please test" >/dev/null 2>&1)
  check crush "$T/crush.log"
  WENV="HOME=$T/home-crush XDG_CONFIG_HOME=$cfg XDG_DATA_HOME=$T/data-crush"
  ln -sf "$bin" "$T/bin/crush"
  worker crush
  # `crush run` approves every tool call: a model that tries a command must not get one
  printf '{"steps":[{"tool":"bash","args":{"command":"touch %s/PWNED","description":"x"}},{"text":"WORKER-OK"}]}' "$T" > "$T/crush-pwn.json"
  start_mock "$T/crush-pwn.json" "$T/crush-pwn.log" || { bad "crush lockdown: mock did not start"; return; }
  # shellcheck disable=SC2046
  (cd "$T" && env -i $(common_env crush-lock) $WENV OFFLOAD_HOST=crush timeout 180 "$PLUGIN/bin/offload" ask -m @host "do it" >/dev/null 2>&1)
  if [ ! -e "$T/PWNED" ] && [ "$(jq -sc 'map((.tools // []) | length) | add // 0' "$T/crush-pwn.log")" = 0 ]; then
    ok "crush worker: no tools offered, no command ran"
  else
    bad "crush worker: tools reached the model or a command ran"
  fi
}

run_qwen() {
  local cmd="${QWEN_CMD:-$(command -v qwen)}" h="$T/home-qwen" ws="$T/ws-qwen"
  [ -n "$cmd" ] || { skip "qwen (set QWEN_CMD)"; return; }
  mkdir -p "$h" "$ws"; cp "$T/big.ts" "$ws/"; (cd "$ws" && git init -q . 2>/dev/null)
  printf '{"steps":[{"tool":"read_file","args":{"file_path":"%s/big.ts"}},{"tool":"run_shell_command","args":{"command":"seq 1 400","description":"count"}},{"text":"done"}]}' "$ws" > "$T/qwen.json"
  start_mock "$T/qwen.json" "$T/qwen.log" || { bad "qwen: mock did not start"; return; }
  # shellcheck disable=SC2046,SC2086
  env -i $(common_env qwen) HOME="$h" $cmd extensions install "$PLUGIN" --consent >/dev/null 2>&1
  # shellcheck disable=SC2046,SC2086
  (cd "$ws" && env -i $(common_env qwen) HOME="$h" OPENAI_API_KEY=x OPENAI_BASE_URL="http://127.0.0.1:$PORT/v1" OPENAI_MODEL=mock-model \
    QWEN_CODE_SUPPRESS_YOLO_WARNING=1 timeout 180 $cmd --auth-type openai -m mock-model --approval-mode yolo -p "please test" >/dev/null 2>&1)
  check qwen "$T/qwen.log" no-digest
  # the worker uses the user's own Qwen auth: here, OpenAI-compatible settings pointing at the mock
  mkdir -p "$h/.qwen"
  printf '{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"mock-model"}}' > "$h/.qwen/settings.json"
  WENV="HOME=$h OPENAI_API_KEY=x OPENAI_BASE_URL=http://127.0.0.1:$PORT/v1 OPENAI_MODEL=mock-model"
  printf '#!/bin/sh\nexec %s "$@"\n' "$cmd" > "$T/bin/qwen"; chmod +x "$T/bin/qwen"
  worker qwen
}

for h in $hosts; do
  printf '\n%s\n' "$h"
  case "$h" in
    copilot) run_copilot ;;
    crush) run_crush ;;
    qwen) run_qwen ;;
    *) skip "$h (no e2e runner)" ;;
  esac
done
printf '\n%s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
