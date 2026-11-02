#!/usr/bin/env bash
# Backend matrix: every worker backend, one by one, in both engines.
#
#   bash tests/e2e-backends.sh           every HTTP preset (16) + a custom endpoint against a local mock:
#                                        URL path, auth header, model id passed intact, explore tools,
#                                        error codes (401/429/404), model listing, `offload model`
#   bash tests/e2e-backends.sh --live    + each cloud preset's real URL with a fake key: expects a clean
#                                        auth error (no tokens are spent); local presets with no server
#                                        running fail fast and clearly
#   bash tests/e2e-backends.sh --agents  + each agent CLI that is installed, logged out (isolated HOME):
#                                        its flags are accepted and "not logged in" maps to exit 11;
#                                        with --claude-live, one real tiny call per engine through claude
#
# Agent binaries: CODEX_BIN GEMINI_BIN PI_BIN COPILOT_BIN QWEN_BIN CRUSH_BIN CURSOR_BIN, else PATH.
# Engines: the bash CLI, and the TypeScript CLI (OFFLOAD_TS, default: the built dist/cli.js).

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$PLUGIN/../.." && pwd)"
LIVE=false AGENTS=false CLAUDE_LIVE=false
for a in "$@"; do
  case "$a" in
    --live) LIVE=true ;;
    --agents) AGENTS=true ;;
    --claude-live) AGENTS=true CLAUDE_LIVE=true ;;
    *) echo "usage: $0 [--live] [--agents] [--claude-live]" >&2; exit 2 ;;
  esac
done

TS_JS="${OFFLOAD_TS:-$PLUGIN/dist/cli.js}"
[ -f "$TS_JS" ] || TS_JS="$ROOT/packages/cli/dist/cli.js"
command -v node >/dev/null 2>&1 && [ -f "$TS_JS" ] || { echo "needs Node.js and the built TypeScript CLI" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "needs python3 (mock server)" >&2; exit 2; }

T=$(mktemp -d "${TMPDIR:-/tmp}/offload-backends.XXXXXX")
MPID=""
cleanup() { [ -n "$MPID" ] && kill "$MPID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

PASS=0 FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | head -6 | sed 's/^/        /'; }
section() { printf '\n%s\n' "$1"; }
has() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }
expect_has() { if has "$2" "$3"; then ok "$1"; else bad "$1" "expected: $3
got: $(printf '%s' "$2" | head -c 400)"; fi; }
expect_not() { if has "$2" "$3"; then bad "$1" "did not expect: $3"; else ok "$1"; fi; }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# one environment for both engines: private config/state, no harness, no keys
export OFFLOAD_CONFIG="$T/config.json" OFFLOAD_STATE_DIR="$T/state" OFFLOAD_CREDENTIALS="$T/credentials.json"
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
unset OFFLOAD_MODEL OFFLOAD_HOST CLAUDECODE CLAUDE_CODE_ENTRYPOINT CODEX_THREAD_ID CODEX_SANDBOX CODEX_CI CURSOR_AGENT \
  CURSOR_CONVERSATION_ID GEMINI_CLI GEMINI_SESSION_ID OPENCODE OPENCODE_SESSION_ID PI_CODING_AGENT PI_SESSION_ID \
  COPILOT_CLI QWEN_CODE_SESSION_ID QWEN_PROJECT_DIR CRUSH CRUSH_SESSION_ID OFFLOAD_DISABLE OPENCODE_CONFIG_CONTENT
CONNECTORS="$PLUGIN/config/connectors.json"
PRESETS=$(jq -r '.endpoints | keys[]' "$CONNECTORS")
for p in $PRESETS; do
  env=$(jq -r --arg p "$p" '.endpoints[$p].api_key_env // empty' "$CONNECTORS")
  [ -n "$env" ] && unset "$env"
done
P="$T/proj"; mkdir -p "$P"; cd "$P" || exit 1
seq 1 40 > small.txt

engine() { # engine NAME ARGS... — run one engine
  local e="$1"; shift
  if [ "$e" = bash ]; then "$PLUGIN/bin/offload" "$@"; else node "$TS_JS" "$@"; fi
}

# ----------------------------------------------------------------- mock
cat > "$T/mock.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = os.environ["MATRIX_LOG"]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def rec(self, model, tools):
        with open(LOG, "a") as f:
            f.write(json.dumps({"method": self.command, "path": self.path, "auth": self.headers.get("authorization", ""),
                                "xkey": self.headers.get("x-api-key", ""), "aver": self.headers.get("anthropic-version", ""),
                                "team": self.headers.get("x-team", ""), "model": model, "tools": tools}) + "\n")
    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self.rec("", False)
        if self.path.endswith("/models"):
            return self.send(200, {"data": [{"id": "zeta-model"}, {"id": "alpha/model:1"}]})
        self.send(404, {"error": {"message": "no route " + self.path}})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        model = body.get("model", ""); tools = bool(body.get("tools"))
        self.rec(model, tools)
        anth = self.path.endswith("/v1/messages")
        if not anth and not self.path.endswith("/chat/completions"):
            return self.send(404, {"error": {"message": "no route " + self.path}})
        err = lambda code, kind, msg: self.send(code, {"type": "error", "error": {"type": kind, "message": msg}} if anth else {"error": {"message": msg, "type": kind}})
        if model.endswith("-auth"): return err(401, "authentication_error", "invalid api key")
        if model.endswith("-quota"): return err(429, "rate_limit_error", "rate limit exceeded")
        if model.endswith("-nomodel"): return err(404, "not_found_error", "model not found: " + model)
        text = "MATRIX-OK model=" + model + (" tools=yes" if tools else "")
        if anth:
            return self.send(200, {"content": [{"type": "text", "text": text}], "usage": {"input_tokens": 11, "output_tokens": 3}})
        self.send(200, {"choices": [{"message": {"role": "assistant", "content": text}}], "usage": {"prompt_tokens": 11, "completion_tokens": 3}})
ThreadingHTTPServer(("127.0.0.1", int(os.environ["MATRIX_PORT"])), H).serve_forever()
PY
PORT=$(( 30000 + $$ % 20000 ))
LOG="$T/requests.jsonl"; : > "$LOG"
MATRIX_PORT=$PORT MATRIX_LOG="$LOG" python3 "$T/mock.py" > "$T/mock.out" 2>&1 &
MPID=$!
for _ in $(seq 1 30); do curl -s -m 1 "http://127.0.0.1:$PORT/x/models" >/dev/null 2>&1 && break; sleep 0.2; done
MOCK="http://127.0.0.1:$PORT"
last() { tail -1 "$LOG" | jq -r "$1"; }
pathof() { printf '%s' "$1" | sed -E 's#^[a-z]+://[^/]+##'; }

# every preset's base_url → the mock, keeping the real URL's path; a fake key per preset
CFG=$(jq -n '{}')
for p in $PRESETS; do
  base=$(jq -r --arg p "$p" '.endpoints[$p].base_url' "$CONNECTORS")
  CFG=$(printf '%s' "$CFG" | jq --arg p "$p" --arg u "$MOCK$(pathof "$base")" '.endpoints[$p].base_url = $u')
  env=$(jq -r --arg p "$p" '.endpoints[$p].api_key_env // empty' "$CONNECTORS")
  [ -n "$env" ] && export "$env=key-$p"
done
CFG=$(printf '%s' "$CFG" | jq --arg u "$MOCK/corp/v1" '.endpoints.mycorp = {type: "openai", base_url: $u, api_key_env: "MYCORP_KEY", headers: {"X-Team": "core"}, label: "My corp gateway"}')
export MYCORP_KEY=key-mycorp
printf '%s\n' "$CFG" > "$OFFLOAD_CONFIG"

MODEL_ID="org/m-1:tag"
for E in bash ts; do
  section "HTTP presets against the mock ($E engine)"
  for p in $PRESETS mycorp; do
    type=$(jq -r --arg p "$p" '.endpoints[$p].type // "openai"' "$CONNECTORS")
    base=$(jq -r --arg p "$p" '.endpoints[$p].base_url' "$OFFLOAD_CONFIG")
    env=$(jq -r --arg p "$p" '(.endpoints[$p].api_key_env // empty)' "$CONNECTORS"); [ "$p" = mycorp ] && env=MYCORP_KEY
    out=$(engine "$E" ask -m "$p:$MODEL_ID" "hello" 2>&1); rc=$?
    if [ "$rc" = 0 ] && has "$out" "MATRIX-OK model=$MODEL_ID" && has "$out" "[offload ask · $p:$MODEL_ID"; then ok "$p: answers, model id intact, footer"
    else bad "$p: answers, model id intact, footer (exit $rc)" "$out"; continue; fi
    if [ "$type" = anthropic ]; then want_path="$(pathof "$base")/v1/messages"; else want_path="$(pathof "$base")/chat/completions"; fi
    expect_eq "$p: POST $want_path" "$(last .path)" "$want_path"
    if [ "$type" = anthropic ]; then
      expect_eq "$p: x-api-key + anthropic-version" "$(last '.xkey + " " + .aver')" "key-$p 2023-06-01"
    elif [ -n "$env" ]; then
      expect_eq "$p: Bearer key from \$$env" "$(last .auth)" "Bearer key-$p"
    else
      expect_eq "$p: local server, no auth header" "$(last .auth)" ""
    fi
    [ "$p" = mycorp ] && expect_eq "mycorp: custom headers sent" "$(last .team)" "core"
    out=$(engine "$E" read -m "$p:$MODEL_ID" -q "what?" small.txt 2>&1)
    expect_has "$p: read (no tools)" "$out" "[offload read · $p:$MODEL_ID"
    expect_eq "$p: read sends no tools" "$(last .tools)" "false"
    out=$(engine "$E" explore -m "$p:$MODEL_ID" "where is x?" 2>&1)
    expect_has "$p: explore gets read-only tools" "$out" "tools=yes"
    engine "$E" ask -m "$p:x-auth" "hi" >/dev/null 2>&1; expect_eq "$p: 401 → exit 11" "$?" 11
    engine "$E" ask -m "$p:x-quota" "hi" >/dev/null 2>&1; expect_eq "$p: 429 → exit 10" "$?" 10
    engine "$E" ask -m "$p:x-nomodel" "hi" >/dev/null 2>&1; expect_eq "$p: unknown model → exit 13" "$?" 13
    out=$(engine "$E" models "$p" 2>&1)
    if [ "$type" = anthropic ]; then want_path="$(pathof "$base")/v1/models"; else want_path="$(pathof "$base")/models"; fi
    expect_has "$p: offload models lists the endpoint's models" "$out" "$p:alpha/model:1"
    expect_eq "$p: GET $want_path" "$(last .path)" "$want_path"
    out=$(engine "$E" model "$p:$MODEL_ID" 2>&1)
    expect_not "$p: offload model accepts it, no warning" "$out" "warning"
    printf '%s\n' "$CFG" > "$OFFLOAD_CONFIG"
  done
  # keys from offload setup's credentials file, and a missing key
  saved=$GROQ_API_KEY; unset GROQ_API_KEY
  printf '{"groq":"stored-key"}' > "$OFFLOAD_CREDENTIALS"
  engine "$E" ask -m groq:x "hi" >/dev/null 2>&1
  expect_eq "groq: key from the credentials file" "$(last .auth)" "Bearer stored-key"
  rm -f "$OFFLOAD_CREDENTIALS"
  jq 'del(.endpoints.groq)' "$OFFLOAD_CONFIG" > "$T/c" && mv "$T/c" "$OFFLOAD_CONFIG"
  out=$(engine "$E" ask -m groq:x "hi" 2>&1); rc=$?
  expect_eq "groq (real URL) without a key → exit 11, no request" "$rc" 11
  expect_has "groq without a key → says which variable" "$out" "GROQ_API_KEY"
  export GROQ_API_KEY=$saved
  printf '%s\n' "$CFG" > "$OFFLOAD_CONFIG"
done

# ------------------------------------------------------------------ live
if $LIVE; then
  rm -f "$OFFLOAD_CONFIG"
  for E in bash ts; do
    section "real provider URLs with a fake key ($E engine; no tokens spent)"
    for p in $PRESETS; do
      env=$(jq -r --arg p "$p" '.endpoints[$p].api_key_env // empty' "$CONNECTORS")
      if [ -z "$env" ]; then
        s=$(date +%s); out=$(OFFLOAD_TIMEOUT=20 engine "$E" ask -m "$p:any-model" "hi" 2>&1); rc=$?; d=$(( $(date +%s) - s ))
        if [ "$rc" != 0 ] && [ "$d" -le 25 ] && has "$out" "failed (exit"; then ok "$p: no local server → clean failure in ${d}s (exit $rc)"
        else bad "$p: no local server → clean failure" "exit $rc after ${d}s: $out"; fi
        continue
      fi
      base=$(jq -r --arg p "$p" '.endpoints[$p].base_url' "$CONNECTORS")
      if [ "$(curl -s -m 10 -X POST "$base/chat/completions" -H 'content-type: application/json' -d '{}' 2>/dev/null | tr -d '\r')" = OK ]; then
        printf '  skip  %s: this network answers %s with a stub, not the real API\n' "$p" "$base"; continue
      fi
      out=$(export "$env=invalid-key-offload-test"; engine "$E" ask -m "$p:test-model" "hi" 2>&1); rc=$?
      if [ "$rc" = 11 ]; then ok "$p: fake key → exit 11 (auth)"
      elif [ "$rc" = 13 ] && [ "$p" = fireworks ]; then ok "$p: fake key → exit 13 (the API answers 'model not found' for unknown keys)"
      else bad "$p: fake key → exit 11" "exit $rc: $(printf '%s' "$out" | head -3)"; fi
      expect_not "$p: real URL resolves (no 404 route error)" "$out" "no route"
    done
  done
fi

# ---------------------------------------------------------------- agents
if $AGENTS; then
  H="$T/home"; mkdir -p "$H"
  agent_bin() {
    local v
    case "$1" in
      codex) v=${CODEX_BIN:-} ;; gemini) v=${GEMINI_BIN:-} ;; pi) v=${PI_BIN:-} ;; copilot) v=${COPILOT_BIN:-} ;;
      qwen) v=${QWEN_BIN:-} ;; crush) v=${CRUSH_BIN:-} ;; cursor) v=${CURSOR_BIN:-} ;; claude) v=${CLAUDE_BIN:-} ;;
    esac
    [ -z "$v" ] && v=$(command -v "$([ "$1" = cursor ] && echo cursor-agent || echo "$1")" 2>/dev/null)
    printf '%s' "$v"
  }
  for E in bash ts; do
    section "agent CLIs as workers, logged out ($E engine)"
    for a in codex gemini pi copilot qwen crush cursor; do
      bin=$(agent_bin "$a")
      if [ -z "$bin" ] || [ ! -x "$bin" ]; then printf '  skip  %s (set %s_BIN)\n' "$a" "$(printf '%s' "$a" | tr '[:lower:]' '[:upper:]')"; continue; fi
      jq -n --arg a "$a" --arg b "$bin" '{agents: {($a): {bin: $b}}}' > "$OFFLOAD_CONFIG"
      if [ "$E" = bash ]; then cli=("$PLUGIN/bin/offload"); else cli=(node "$TS_JS"); fi
      # a clean environment and an empty HOME: the CLI is logged out
      out=$(cd "$P" && env -i PATH="$PATH" HOME="$H" TMPDIR="$T" OFFLOAD_CONFIG="$OFFLOAD_CONFIG" OFFLOAD_STATE_DIR="$OFFLOAD_STATE_DIR" \
              OFFLOAD_TIMEOUT=90 "${cli[@]}" ask -m "$a:" "Reply with exactly: pong" 2>&1); rc=$?
      if [ "$rc" = 11 ]; then ok "$a: flags accepted, logged out → exit 11"
      else bad "$a: flags accepted, logged out → exit 11" "exit $rc: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; fi
      expect_not "$a: no flag/usage error from the CLI" "$out" "unknown option"
    done
    if $CLAUDE_LIVE; then
      bin=$(agent_bin claude)
      if [ -n "$bin" ]; then
        jq -n --arg b "$bin" '{agents: {claude: {bin: $b}}}' > "$OFFLOAD_CONFIG"
        out=$(engine "$E" ask -m claude:haiku "Reply with exactly the word: pong" 2>&1); rc=$?
        expect_eq "claude (real, your plan): exit 0" "$rc" 0
        expect_has "claude (real): answers" "$(printf '%s' "$out" | tr '[:upper:]' '[:lower:]')" "pong"
      fi
    fi
  done
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
