#!/usr/bin/env bash
# offload test suite.
#
#   bash tests/run.sh                 offline suite (stub opencode; needs bash, jq, awk)
#   bash tests/run.sh --integration   + real `opencode` against a local mock model (needs python3)
#   bash tests/run.sh --e2e           + real Claude Code against a mock Anthropic API (needs claude)
#
# Integration/e2e use whatever `opencode` is on PATH (or $OFFLOAD_OPENCODE_BIN).

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
OFFLOAD="${OFFLOAD_CLI:-$PLUGIN/bin/offload}"
INTEGRATION=false E2E=false
for a in "$@"; do
  case "$a" in
    --integration) INTEGRATION=true ;;
    --e2e) E2E=true; INTEGRATION=true ;;
  esac
done

T=$(mktemp -d "${TMPDIR:-/tmp}/offload-tests.XXXXXX")
trap 'rm -rf "$T" 2>/dev/null' EXIT
REAL_OPENCODE="${OFFLOAD_OPENCODE_BIN:-$(command -v opencode 2>/dev/null)}"

PASS=0 FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | head -8 | sed 's/^/        /'; }
section() { printf '\n%s\n' "$1"; }
has() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }
expect_has() { if has "$2" "$3"; then ok "$1"; else bad "$1" "expected to contain: $3
got: $(printf '%s' "$2" | head -c 600)"; fi; }
expect_not() { if has "$2" "$3"; then bad "$1" "did not expect: $3"; else ok "$1"; fi; }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Offline environment: stub opencode, private state/config.
export OFFLOAD_OPENCODE_BIN="$HERE/stub-opencode"
export OFFLOAD_STATE_DIR="$T/state"
export OFFLOAD_CONFIG="$T/config.json"
export OFFLOAD_MODEL=stub/ok
export STUB_VERSION=1.19.5
unset OPENCODE_CONFIG_CONTENT OFFLOAD_DISABLE OFFLOAD_READ_GUARD OFFLOAD_TIMEOUT OFFLOAD_NO_MODEL CLAUDE_PROJECT_DIR
# no harness detected unless a test says so (@host)
unset OFFLOAD_HOST CLAUDECODE CLAUDE_CODE_ENTRYPOINT CODEX_THREAD_ID CODEX_SANDBOX CODEX_CI CURSOR_AGENT \
  CURSOR_CONVERSATION_ID GEMINI_CLI GEMINI_SESSION_ID OPENCODE OPENCODE_SESSION_ID PI_CODING_AGENT PI_SESSION_ID
export CLAUDE_PLUGIN_ROOT="$PLUGIN"
chmod +x "$HERE/stub-opencode" "$OFFLOAD" "$PLUGIN"/hooks/* 2>/dev/null
P="$T/proj"; mkdir -p "$P"; cd "$P" || exit 1
export CO_PROJECT_DIR="$P"

# Fixtures
awk 'BEGIN { for (i = 1; i <= 1200; i++) printf "export function fn%d(a: number): number { return a + %d }\n", i, i }' > big.ts
seq 1 40 > small.txt
printf 'SECRET=abc\n' > .env
printf 'A=1\n' > .env.example
printf '\000\001binary' > blob.bin
awk 'BEGIN { for (i = 1; i <= 900; i++) print "data line " i }' > big.log

hook() { # hook NAME JSON
  printf '%s' "$2" | "$PLUGIN/hooks/$1"
}
decision() { [ -z "$1" ] && { echo none; return; }; printf '%s' "$1" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null; }
pre_read() { hook pre-read "$(jq -nc --arg c "$P" --argjson ti "$1" '{cwd: $c, tool_name: "Read", tool_input: $ti}')"; }
pre_bash() { hook pre-bash "$(jq -nc --arg c "$P" --arg k "$1" '{cwd: $c, tool_name: "Bash", tool_input: {command: $k}}')"; }

# ------------------------------------------------------------------ static
section "static checks"
for f in "$OFFLOAD" "$PLUGIN"/hooks/pre-read "$PLUGIN"/hooks/pre-bash "$PLUGIN"/hooks/post-bash "$PLUGIN"/hooks/session-start "$PLUGIN"/lib/*.sh "$HERE"/stub-opencode; do
  if bash -n "$f" 2>/dev/null; then ok "syntax $(basename "$f")"; else bad "syntax $(basename "$f")" "$(bash -n "$f" 2>&1)"; fi
done
for f in "$PLUGIN/.claude-plugin/plugin.json" "$PLUGIN/hooks/hooks.json" "$PLUGIN/config/defaults.json" "$PLUGIN/../../.claude-plugin/marketplace.json"; do
  [ -f "$f" ] || continue
  if jq -e . "$f" >/dev/null 2>&1; then ok "json $(basename "$f")"; else bad "json $f"; fi
done
b4=$(grep -nE 'declare -A|mapfile|readarray|\$\{[A-Za-z_]+(,,|\^\^)\}|&>>|\|&[[:space:]]|local -n ' "$OFFLOAD" "$PLUGIN"/lib/*.sh "$PLUGIN"/hooks/pre-* "$PLUGIN"/hooks/post-* "$PLUGIN"/hooks/session-start | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#')
if [ -n "$b4" ]; then
  bad "no bash-4-only syntax (macOS ships bash 3.2)" "$b4"
else ok "no bash-4-only syntax (macOS ships bash 3.2)"; fi

jqre=$(grep -nE '(test|match|capture|scan|splits|gsub)\(' "$PLUGIN"/lib/*.sh "$OFFLOAD" "$PLUGIN"/hooks/pre-* "$PLUGIN"/hooks/post-* "$PLUGIN"/hooks/session-start | grep -vE 'awk|^[^:]+:[0-9]+:[[:space:]]*#|match\(line|match\(rest|sub\(/')
if [ -n "$jqre" ]; then bad "no jq regex builtins (Apple's jq may lack Oniguruma)" "$jqre"; else ok "no jq regex builtins (Apple's jq may lack Oniguruma)"; fi

# ------------------------------------------------------------------ portability regressions
section "portability regressions"
mkdir -p "$T/lnbin"; ln -s "$OFFLOAD" "$T/lnbin/offload"
expect_eq "symlinked CLI finds its libraries" "$("$T/lnbin/offload" config show 2>&1 | sed 1,3d | jq -r '.hooks.read_guard' 2>&1)" "block"
s=$(date +%s); "$OFFLOAD" read -q >/dev/null 2>&1; rc=$?
expect_eq "missing option value → usage error, no hang" "$rc:$(( $(date +%s) - s < 5 ))" "2:1"
printf 'caf\351 cr\350me\nline two\n' > latin1.txt
( . "$PLUGIN/lib/common.sh"; CO_CONFIG=""; co_config_load; co_is_text latin1.txt ) && ok "Latin-1 text counts as text" || bad "Latin-1 text counts as text"
( . "$PLUGIN/lib/common.sh"; co_tmp a; printf keep > "$a"; x=$(co_tmp b; echo "$b"); [ -f "$a" ] && [ "$(cat "$a")" = keep ] ) &&
  ok "temp files survive a subshell that also used co_tmp" || bad "temp files survive a subshell that also used co_tmp"
cat > Svc.java <<'JEOF'
public class Svc {
    private final Repo repo;
    public List<String> names(int limit) {
        return repo.all();
    }
    protected static Map<String, Integer> counts() {
        return null;
    }
}
JEOF
( . "$PLUGIN/lib/common.sh"; . "$PLUGIN/lib/outline.sh"; co_outline Svc.java ) > "$T/ol.txt" 2>&1
expect_has "outline: java methods" "$(cat "$T/ol.txt")" "L3: public List<String> names(int limit)"

# ------------------------------------------------------------------ config
section "config"
out=$("$OFFLOAD" config show | sed 1,3d | jq -r '.hooks.read_guard')
expect_eq "defaults load" "$out" "block"
echo '{"hooks":{"summarize_bash_output":false,"read_threshold_lines":100}}' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" config show | sed 1,3d | jq -c '[.hooks.summarize_bash_output, .hooks.read_threshold_lines, .hooks.read_guard]')
expect_eq "user config merges over defaults" "$out" '[false,100,"block"]'
( . "$PLUGIN/lib/common.sh"; co_config_load; if co_cfg_bool '.hooks.summarize_bash_output' true; then exit 1; fi ) &&
  ok "explicit false is not replaced by the default" || bad "explicit false is not replaced by the default"
echo '{broken' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" config show 2>&1)
expect_has "invalid config is reported, not fatal" "$out" "ignoring invalid JSON config"
rm -f "$OFFLOAD_CONFIG"
"$OFFLOAD" config set models.read stub/multistep >/dev/null
"$OFFLOAD" config set models.fallback '["stub/ok"]' >/dev/null
out=$(jq -c '.models' "$OFFLOAD_CONFIG")
expect_eq "config set writes nested keys and JSON values" "$out" '{"read":"stub/multistep","fallback":["stub/ok"]}'
rm -f "$OFFLOAD_CONFIG"
out=$(OFFLOAD_READ_GUARD=off "$OFFLOAD" config show | sed 1,3d | jq -r '.hooks.read_guard')
expect_eq "env override" "$out" "off"

# ------------------------------------------------------------------ helpers
section "helpers"
. "$PLUGIN/lib/common.sh"; . "$PLUGIN/lib/outline.sh"; . "$PLUGIN/lib/digest.sh"; . "$PLUGIN/lib/opencode.sh"
CO_CONFIG=""; co_config_load
co_is_secret_path ".env" && ok "secret: .env" || bad "secret: .env"
co_is_secret_path "config/prod.pem" && ok "secret: *.pem" || bad "secret: *.pem"
co_is_secret_path ".env.example" && bad "secret: .env.example is allowed" || ok "secret: .env.example is allowed"
co_is_secret_path "src/secret_manager.ts" && bad "secret: ordinary source file" || ok "secret: ordinary source file"
red=$(printf 'key=AKIAABCDEFGHIJKLMNOP\ntoken: ghp_abcdefghijklmnopqrstuvwxyz0123456789\npassword = "hunter2hunter2"\nnormal line\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n' | co_redact)
expect_not "redact: AWS key" "$red" "AKIAABCDEFGHIJKLMNOP"
expect_not "redact: GitHub token" "$red" "ghp_abcdefghij"
expect_not "redact: password value" "$red" "hunter2hunter2"
expect_not "redact: private key body" "$red" "MIIabc"
expect_has "redact: leaves normal text" "$red" "normal line"
co_is_text blob.bin && bad "binary detection" || ok "binary detection"
out=$(co_outline big.ts 10)
expect_has "outline: finds functions with line numbers" "$out" "L1: export function fn1"
expect_has "outline: caps entries" "$out" "more symbols not shown"
printf 'class A:\n    def f(self):\n        pass\ndef g():\n    pass\n' > t.py
expect_has "outline: python" "$(co_outline t.py)" "L4: def g()"
printf 'ok 1\nok 2\nERROR: boom at src/a.ts:3:1\n0 errors found\nERROR: boom at src/a.ts:3:1\nTests: 1 failed, 2 passed\n' > k.log
kl=$(co_key_lines k.log 10 "$T/kc")
expect_has "key lines: error with repeat count" "$kl" "L3: ERROR: boom at src/a.ts:3:1  (x2)"
expect_not "key lines: ignores '0 errors'" "$kl" "0 errors found"
expect_has "key lines: test summary" "$kl" "Tests: 1 failed"
expect_eq "key lines: distinct count" "$(cat "$T/kc")" "2"
cat > ans.txt <<'EOF'
- good — big.ts:L3 `export function fn3(a: number)`
- range — `big.ts:L9-L11` `return a + 10`
- wrong — big.ts:L100 `does not exist`
- elsewhere — big.ts:L900 `fn3(a: number)`
EOF
v=$(awk -v root="$P" -v report="$T/rep" -f "$PLUGIN/lib/verify.awk" ans.txt)
expect_eq "verify: counts" "$(cat "$T/rep")" "2 2"
expect_has "verify: marks bad quotes" "$v" "does not exist\` ⚠unverified"
expect_not "verify: keeps good ones unmarked" "$(printf '%s\n' "$v" | sed -n 1p)" "unverified"
for A in mawk original-awk gawk busybox; do
  command -v "$A" >/dev/null 2>&1 || continue
  [ "$A" = busybox ] && A="busybox awk"
  r=$($A -v root="$P" -v report="$T/rep2" -f "$PLUGIN/lib/verify.awk" ans.txt >/dev/null 2>&1; cat "$T/rep2" 2>/dev/null)
  expect_eq "verify works under $A" "$r" "2 2"
done

# ------------------------------------------------------------------ transport
section "transport (stub opencode)"
for V in 1.19.5 2.2.5; do
  export STUB_VERSION=$V
  CO_OC_MAJOR=""
  rm -rf "$OFFLOAD_STATE_DIR"
  out=$(STUB_ANSWER="final answer" "$OFFLOAD" ask "hi" 2>&1); rc=$?
  expect_has "v$V ask returns the answer" "$out" "final answer"
  expect_eq "v$V ask exit 0" "$rc" 0
  out=$(STUB_ANSWER="the real answer" "$OFFLOAD" ask -m stub/multistep "hi" 2>&1)
  expect_has "v$V final step text only" "$out" "the real answer"
  expect_not "v$V drops tool-step chatter" "$out" "Let me look around"
  out=$("$OFFLOAD" ask -m stub/auth "hi" 2>&1); rc=$?
  expect_eq "v$V auth error → exit 11" "$rc" 11
  out=$("$OFFLOAD" ask -m stub/nomodel "hi" 2>&1); rc=$?
  expect_eq "v$V unknown model → exit 13" "$rc" 13
  s=$(date +%s); out=$("$OFFLOAD" ask -m stub/retry "hi" 2>&1); rc=$?; took=$(( $(date +%s) - s ))
  expect_eq "v$V endless retries → exit 10" "$rc" 10
  [ "$took" -le 8 ] && ok "v$V retries cut short (${took}s)" || bad "v$V retries cut short" "took ${took}s"
  out=$(OFFLOAD_TIMEOUT=2 "$OFFLOAD" ask -m stub/hang "hi" 2>&1); rc=$?
  expect_eq "v$V hang → timeout exit 12" "$rc" 12
  out=$("$OFFLOAD" ask -m stub/empty "hi" 2>&1); rc=$?
  expect_eq "v$V empty answer → exit 14" "$rc" 14
  # fallback chain + cooldown
  rm -rf "$OFFLOAD_STATE_DIR"; : > "$T/stub.log"
  echo '{"models":{"default":"stub/auth","fallback":["stub/retry","stub/ok"]}}' > "$OFFLOAD_CONFIG"
  out=$(OFFLOAD_MODEL= STUB_LOG="$T/stub.log" STUB_ANSWER="from fallback" "$OFFLOAD" ask "hi" 2>&1)
  expect_has "v$V fallback reaches a working model" "$out" "from fallback"
  : > "$T/stub.log"
  out=$(OFFLOAD_MODEL= STUB_LOG="$T/stub.log" "$OFFLOAD" ask "hi" 2>&1)
  expect_eq "v$V failed models cool down (skipped next time)" "$(awk '{print $1}' "$T/stub.log" | tr '\n' ' ')" "stub/ok "
  rm -f "$OFFLOAD_CONFIG"
done
export STUB_VERSION=1.19.5; CO_OC_MAJOR=""
out=$(OFFLOAD_OPENCODE_BIN=/nonexistent/opencode "$OFFLOAD" ask "hi" 2>&1); rc=$?
expect_eq "missing opencode → exit 15" "$rc" 15
cfg=$(STUB_VERSION=2.2.5; CO_OC_MAJOR=""; co_oc_config)
expect_eq "v2 config uses agents/system/permissions" "$(printf '%s' "$cfg" | jq -r '.agents["offload-read"].permissions[0].effect')" "deny"
expect_eq "v2 explorer denies secret reads last" "$(printf '%s' "$cfg" | jq -r '.agents["offload-explore"].permissions[-1] | "\(.action) \(.effect)"')" "read deny"
cfg=$(CO_OC_MAJOR=1; co_oc_config)
expect_eq "v1 config uses agent/prompt/permission" "$(printf '%s' "$cfg" | jq -r '.agent["offload-read"].permission["*"]')" "deny"
cfg=$(OPENCODE_CONFIG_CONTENT='{"provider":{"x":{}}}'; CO_OC_MAJOR=1; co_oc_config)
expect_eq "user OPENCODE_CONFIG_CONTENT is preserved" "$(printf '%s' "$cfg" | jq -c '.provider')" '{"x":{}}'

# ------------------------------------------------------------------ commands
section "commands"
out=$(STUB_PROMPT="$T/prompt" STUB_ANSWER='fn3 adds 3 — big.ts:L3 `export function fn3(a: number)`' "$OFFLOAD" read -q "what does fn3 do?" big.ts 2>&1)
expect_has "read: answer + verified citation footer" "$out" "citations: 1 verified, 0 unverified"
expect_has "read: line-numbered file in prompt" "$(cat "$T/prompt")" "     3	export function fn3"
expect_has "read: question last" "$(tail -n 1 "$T/prompt")" "<question>what does fn3 do?</question>"
out=$(STUB_PROMPT="$T/prompt" "$OFFLOAD" read -q "q" big.ts:10-12 2>&1)
expect_has "read: file:START-END range" "$(cat "$T/prompt")" 'lines="10-12" total_lines="1200"'
expect_not "read: range excludes other lines" "$(cat "$T/prompt")" "fn13("
out=$("$OFFLOAD" read -q "q" .env 2>&1); rc=$?
expect_eq "read: refuses secrets (exit 16)" "$rc" 16
out=$("$OFFLOAD" read -q "q" nope.txt 2>&1); rc=$?
expect_eq "read: missing file → exit 2" "$rc" 2
mkdir -p d/sub; echo 'a' > d/one.txt; echo 'b' > d/sub/two.txt; cp .env d/.env
out=$(STUB_PROMPT="$T/prompt" "$OFFLOAD" read -q "q" d 2>&1)
expect_has "read: directory expands to files" "$(cat "$T/prompt")" 'path="d/sub/two.txt"'
expect_not "read: directory skips secrets" "$(cat "$T/prompt")" 'd/.env'
out=$(STUB_PROMPT="$T/prompt" STUB_ANSWER='done' "$OFFLOAD" explore "where is fn3?" 2>&1)
expect_has "explore: answer" "$out" "[offload explore"
out=$(STUB_ANSWER='```ts
const a = 1
```' "$OFFLOAD" write --spec "make a" --ref small.txt --out gen/a.ts 2>&1)
expect_eq "write: strips the wrapping fence" "$(cat gen/a.ts)" "const a = 1"
out=$("$OFFLOAD" write --spec "x" --ref small.txt --out gen/a.ts 2>&1); rc=$?
expect_eq "write: refuses to overwrite without --force" "$rc" 2
out=$("$OFFLOAD" write --spec "x" 2>&1); rc=$?
expect_eq "write: --ref is required" "$rc" 2
printf '# T\n\n```js\nx()\n```\n' > "$T/md.txt"
out=$(STUB_ANSWER_FILE="$T/md.txt" "$OFFLOAD" write --spec "doc" --ref small.txt 2>&1)
expect_has "write: keeps inner fences" "$out" '```js'
out=$("$OFFLOAD" run -- sh -c 'echo hi; exit 3'); rc=$?
expect_eq "run: small output passes through" "$out" "hi"
expect_eq "run: exit code preserved" "$rc" 3
out=$(STUB_ANSWER="STATUS: failure — 1 failed" "$OFFLOAD" run -- sh -c 'i=0; while [ $i -lt 400 ]; do echo "test $i ok"; i=$((i+1)); done; echo "FAIL: test_x at src/x.test.ts:9"; exit 1'); rc=$?
expect_eq "run: exit code preserved on digest" "$rc" 1
expect_has "run: digest has summary" "$out" "STATUS: failure"
expect_has "run: digest has verbatim failure" "$out" "L401: FAIL: test_x at src/x.test.ts:9"
expect_has "run: digest points to full log" "$out" "full log: "
out=$(OFFLOAD_MODEL=stub/auth "$OFFLOAD" run -- sh -c 'i=0; while [ $i -lt 400 ]; do echo "line $i"; i=$((i+1)); done; echo "Error: nope"')
expect_has "run: model failure still gives a deterministic digest" "$out" "L401: Error: nope"
out=$(awk 'BEGIN { for (i = 1; i <= 400; i++) print "row " i }' | "$OFFLOAD" summarize -q "anything odd?" --no-model)
expect_has "summarize: stdin" "$out" "400 lines"
out=$("$OFFLOAD" stats)
expect_has "stats: aggregates" "$out" "delegations:"
out=$("$OFFLOAD" doctor 2>&1)
expect_has "doctor runs" "$out" "worker agents load"

# ------------------------------------------------------- agent connectors
section "agent connectors (stub claude/codex/gemini/cursor-agent/pi)"
AB="$T/agent-bin"; mkdir -p "$AB"
for n in claude codex gemini cursor-agent pi; do ln -sf "$HERE/stub-agent" "$AB/$n"; done
chmod +x "$HERE/stub-agent"
export STUB_AGENT_LOG="$T/agent.log"
ag() { PATH="$AB:$PATH" "$OFFLOAD" "$@" 2>&1; }
: > "$STUB_AGENT_LOG"
out=$(ag ask -m claude:haiku "hello claude"); rc=$?
expect_eq "claude: exit 0" "$rc" 0
expect_has "claude: answer" "$out" "CLAUDE-STUB: hello claude"
expect_has "claude: footer names the ref" "$out" "[offload ask · claude:haiku"
alog=$(cat "$STUB_AGENT_LOG")
expect_has "claude: lean headless flags" "$alog" "arg[--strict-mcp-config]"
expect_has "claude: no recursion into offload" "$alog" "OFFLOAD_DISABLE=1"
expect_not "claude: never --bare (it cannot use subscription logins)" "$alog" "arg[--bare]"
expect_has "claude: model passed" "$alog" "arg[haiku]"
: > "$STUB_AGENT_LOG"; ag explore -m claude:haiku "where is fn3?" >/dev/null
expect_has "claude: explore gets read-only tools" "$(cat "$STUB_AGENT_LOG")" "arg[Read,Grep,Glob]"
out=$(ag ask -m codex:gpt-6-luna "hello codex")
expect_has "codex: answer (merged prompt on stdin)" "$out" "CODEX-STUB: hello codex"
: > "$STUB_AGENT_LOG"; ag ask -m codex:gpt-6-luna "x" >/dev/null
expect_has "codex: read-only sandbox" "$(cat "$STUB_AGENT_LOG")" "arg[read-only]"
out=$(ag ask -m gemini:flash-lite "hello gemini")
expect_has "gemini: answer + system prompt file" "$out" "GEMINI-STUB sys=ok: hello gemini"
out=$(ag ask -m cursor: "hello cursor")
expect_has "cursor: answer (prompt as argument)" "$out" "CURSOR-STUB: hello cursor"
out=$(ag ask -m pi: "hello pi")
expect_has "pi: answer" "$out" "PI-STUB: hello pi"
out=$(ag read -m pi: -q "what?" small.txt)
expect_has "pi: read footer" "$out" "[offload read · pi:"
STUB_AGENT_MODE=auth ag ask -m claude:haiku "hi" >/dev/null; expect_eq "claude: login problem → exit 11" "$?" 11
STUB_AGENT_MODE=quota ag ask -m claude:sonnet "hi" >/dev/null; expect_eq "claude: usage limit → exit 10" "$?" 10
STUB_AGENT_MODE=quota ag ask -m codex:x "hi" >/dev/null; expect_eq "codex: usage limit → exit 10" "$?" 10
STUB_AGENT_MODE=auth ag ask -m gemini:y "hi" >/dev/null; expect_eq "gemini: exit 41 → exit 11" "$?" 11
STUB_AGENT_MODE=quota ag ask -m pi:z "hi" >/dev/null; expect_eq "pi: 429 → exit 10" "$?" 10
s=$(date +%s); STUB_AGENT_MODE=slow OFFLOAD_TIMEOUT=1 ag ask -m codex:slow "hi" >/dev/null; rc=$?
expect_eq "agent timeout → exit 12, fast" "$rc:$(( $(date +%s) - s < 10 ))" "12:1"
printf '{"agents":{"claude":{"bin":"%s/nope-claude"}}}' "$T" > "$OFFLOAD_CONFIG"
ag ask -m claude:haiku "hi" >/dev/null; expect_eq "missing agent CLI → exit 15" "$?" 15
rm -f "$OFFLOAD_CONFIG"
"$OFFLOAD" doctor --reset >/dev/null 2>&1

section "@host (the calling harness's own subscription)"
out=$(OFFLOAD_HOST=claude ag ask -m @host "same plan")
expect_has "@host on Claude Code → claude:haiku" "$out" "[offload ask · claude:haiku"
out=$(CLAUDECODE=1 ag ask -m @host "detected")
expect_has "@host detects Claude Code from its env" "$out" "CLAUDE-STUB: detected"
out=$(OFFLOAD_HOST=codex ag ask -m @self "codex plan")
expect_has "@self on Codex → codex default luna" "$out" "[offload ask · codex:gpt-6-luna"
out=$(GEMINI_CLI=1 ag ask -m @host "g")
expect_has "@host on Gemini CLI → gemini:flash-lite" "$out" "[offload ask · gemini:flash-lite"
out=$(OFFLOAD_HOST=pi ag ask -m @host "p")
expect_has "@host on Pi → pi default model" "$out" "PI-STUB: p"
out=$(ag ask -m @host "who?"); rc=$?
expect_eq "@host with no harness → usage exit 2" "$rc" 2
expect_has "@host with no harness explains OFFLOAD_HOST" "$out" "OFFLOAD_HOST"
printf '{"host_models":{"claude":"claude:sonnet"}}' > "$OFFLOAD_CONFIG"
out=$(OFFLOAD_HOST=claude ag ask -m @host "override")
expect_has "config host_models overrides the default" "$out" "[offload ask · claude:sonnet"
rm -f "$OFFLOAD_CONFIG"
out=$(OFFLOAD_MODEL=@host OFFLOAD_HOST=claude ag read -q "q" small.txt)
expect_has "model @host routes reads to the host plan" "$out" "[offload read · claude:haiku"
d=$(OFFLOAD_MODEL=@host OFFLOAD_HOST=claude PATH="$AB:$PATH" pre_read '{"file_path":"'"$P"'/big.ts"}' | jq -r '.hookSpecificOutput.permissionDecision // "none"')
expect_eq "hook: @host + claude CLI present → large read redirected" "$d" "deny"
printf '{"agents":{"claude":{"bin":"%s/nope"}}}' "$T" > "$OFFLOAD_CONFIG"
d=$(decision "$(OFFLOAD_MODEL=@host OFFLOAD_HOST=claude PATH="$AB:$PATH" pre_read '{"file_path":"'"$P"'/big.ts"}')")
expect_eq "hook: @host but CLI missing → fail open" "$d" "none"
rm -f "$OFFLOAD_CONFIG"

# ------------------------------------------------------------ http connector
section "http connector (mock OpenAI-compatible endpoint)"
HAVE_TS=false
{ [ -n "${OFFLOAD_TS_CLI:-}" ] || [ -f "$PLUGIN/dist/cli.js" ] || [ -f "$PLUGIN/../../packages/cli/dist/cli.js" ] || command -v harness-offload >/dev/null 2>&1; } && HAVE_TS=true
if command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  HPORT=$(( 20000 + $$ % 20000 ))
  MOCK_PORT=$HPORT MOCK_LOG="$T/http-mock.log" python3 "$HERE/mock_openai.py" > "$T/http-mock.out" 2>&1 &
  HPID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s --noproxy '*' -m 1 "http://127.0.0.1:$HPORT/v1/models" >/dev/null 2>&1 && break; sleep 0.3; done
  jq -n --arg u "http://127.0.0.1:$HPORT/v1" '{endpoints: {mock: {type: "openai", base_url: $u}}}' > "$OFFLOAD_CONFIG"
  # non-explore HTTP needs no TypeScript CLI in the bash engine (curl)
  out=$(OFFLOAD_TS_CLI=false NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" ask -m mock:echo "hello http" 2>&1); rc=$?
  expect_eq "http: ask exit 0" "$rc" 0
  expect_has "http: answer comes from the endpoint" "$out" "MOCK-REPLY"
  expect_has "http: footer names the model ref" "$out" "[offload ask · mock:echo"
  out=$(OFFLOAD_TS_CLI=false NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" read -m mock:echo -q "what?" small.txt 2>&1)
  expect_has "http: read sends no tools" "$out" "tools=none"
  NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" ask -m mock:m-auth "hi" >/dev/null 2>&1; expect_eq "http: 401 → exit 11" "$?" 11
  NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" ask -m mock:m-error "hi" >/dev/null 2>&1; expect_eq "http: 429 → exit 10" "$?" 10
  if $HAVE_TS; then
    out=$(NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" explore -m mock:echo "where?" 2>&1)
    expect_has "http: explore gets the read-only tool set" "$out" "tools=glob,grep,list_dir,read_file"
    out=$(NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" explore -m mock:m-readenv "what is in READ:small.txt ?" 2>&1)
    expect_has "http: explore tool loop reads files" "$out" "small.txt (lines 1-40 of 40)"
    out=$(NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" explore -m mock:m-readenv "READ:.env ?" 2>&1)
    expect_has "http: explore refuses secrets" "$out" "secret-file rules"
    out=$(NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" explore -m mock:m-readenv "READ:../../etc/passwd ?" 2>&1)
    expect_has "http: explore stays inside the project" "$out" "outside the project"
  else
    printf '  skip  explore over HTTP (needs the TypeScript CLI)\n'
  fi
  expect_not "http: secret content never sent" "$(cat "$T/http-mock.log")" "SECRET=abc"
  "$OFFLOAD" ask -m nokey:whatever "hi" >/dev/null 2>&1; rc=$?
  [ "$rc" != 0 ] && ok "http: unknown backend prefix fails cleanly (exit $rc)" || bad "http: unknown backend prefix fails cleanly"
  rm -f "$OFFLOAD_CONFIG"
  kill "$HPID" 2>/dev/null
else
  printf '  skip  (needs python3 and curl)\n'
fi
"$OFFLOAD" doctor --reset >/dev/null 2>&1

# ------------------------------------------------------------------ hooks
section "hooks"
r=$(pre_read '{"file_path":"big.ts"}')
expect_eq "pre-read: blocks a big full read" "$(decision "$r")" "deny"
expect_has "pre-read: message has outline" "$r" "L1: export function fn1"
expect_has "pre-read: message has ready command" "$r" "offload read -q"
expect_eq "pre-read: small file passes" "$(decision "$(pre_read '{"file_path":"small.txt"}')")" "none"
expect_eq "pre-read: targeted slice passes" "$(decision "$(pre_read '{"file_path":"big.ts","offset":100,"limit":200}')")" "none"
expect_eq "pre-read: huge slice blocked" "$(decision "$(pre_read '{"file_path":"big.ts","offset":1,"limit":5000}')")" "deny"
expect_eq "pre-read: offset-only tail within chunk passes" "$(decision "$(pre_read '{"file_path":"big.ts","offset":1000}')")" "none"
expect_eq "pre-read: binary passes" "$(decision "$(pre_read '{"file_path":"blob.bin"}')")" "none"
expect_eq "pre-read: missing file passes" "$(decision "$(pre_read '{"file_path":"nope.ts"}')")" "none"
r=$(OFFLOAD_READ_GUARD=suggest pre_read '{"file_path":"big.ts"}')
expect_has "pre-read: suggest mode adds context only" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.additionalContext // ""')" "advice, not enforced"
expect_eq "pre-read: suggest mode does not decide" "$(decision "$r")" "none"
expect_eq "pre-read: ask mode" "$(decision "$(OFFLOAD_READ_GUARD=ask pre_read '{"file_path":"big.ts"}')")" "ask"
expect_eq "pre-read: off mode" "$(decision "$(OFFLOAD_READ_GUARD=off pre_read '{"file_path":"big.ts"}')")" "none"
expect_eq "pre-read: disabled offload passes" "$(decision "$(OFFLOAD_DISABLE=1 pre_read '{"file_path":"big.ts"}')")" "none"
expect_eq "pre-read: no opencode → fail open" "$(decision "$(OFFLOAD_OPENCODE_BIN=/nonexistent pre_read '{"file_path":"big.ts"}')")" "none"
echo '{"hooks":{"ignore_globs":["*.ts"]}}' > "$OFFLOAD_CONFIG"
expect_eq "pre-read: ignore_globs" "$(decision "$(pre_read '{"file_path":"big.ts"}')")" "none"
echo '{"hooks":{"subagents":false}}' > "$OFFLOAD_CONFIG"
r=$(hook pre-read "$(jq -nc --arg c "$P" '{cwd: $c, agent_id: "a1", tool_input: {file_path: "big.ts"}}')")
expect_eq "pre-read: subagents=false lets subagents read" "$(decision "$r")" "none"
rm -f "$OFFLOAD_CONFIG"
while read -r line; do
  [ -z "$line" ] && continue
  cmdline="${line% @@ *}"; want="${line##* @@ }"
  expect_eq "pre-bash: $cmdline → $want" "$(decision "$(pre_bash "$cmdline")")" "$want"
done <<'EOF'
cat big.ts @@ deny
cat -n big.ts @@ deny
nl big.ts @@ deny
less big.log @@ deny
head big.ts @@ none
head -50 big.ts @@ none
head -n 2000 big.ts @@ deny
tail -n2000 big.log @@ deny
tail -f big.log @@ none
sed -n '1,1000p' big.ts @@ deny
sed -n '10,40p' big.ts @@ none
sed 's/a/b/' big.ts @@ none
cat small.txt @@ none
cat big.ts | grep fn1 @@ none
cat big.ts > copy.ts @@ none
grep -n fn1 big.ts @@ none
OFFLOAD_RAW=1 cat big.ts @@ none
tail -n @@ none
offload read -q x big.ts @@ none
EOF
echo '{"hooks":{"autowrap":true}}' > "$OFFLOAD_CONFIG"
r=$(pre_bash "npm test")
expect_eq "pre-bash autowrap: rewrites noisy command" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedInput.command')" "offload run -c 'npm test'"
expect_eq "pre-bash autowrap: leaves permission flow alone" "$(decision "$r")" "none"
expect_eq "pre-bash autowrap: ignores other commands" "$(decision "$(pre_bash "ls -la")")" "none"
rm -f "$OFFLOAD_CONFIG"

big_out=$(awk 'BEGIN { for (i = 1; i <= 600; i++) print "compile unit " i; print "warning: deprecated api in src/x.ts:4:2" }')
post() { local x="${3:-}"; [ -z "$x" ] && x='{}'; hook post-bash "$(jq -nc --arg c "$P" --arg k "$1" --arg o "$2" --argjson x "$x" '{cwd: $c, tool_name: "Bash", tool_input: {command: $k, description: "Build"}, tool_response: ({stdout: $o, stderr: "", interrupted: false, isImage: false} + $x)}')"; }
r=$(STUB_ANSWER="STATUS: success" post "make build" "$big_out")
d=$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout // ""')
expect_has "post-bash: big output replaced by digest" "$d" "STATUS: success"
expect_has "post-bash: digest keeps verbatim key lines" "$d" "src/x.ts:4:2"
expect_eq "post-bash: keeps the tool_response shape" "$(printf '%s' "$r" | jq -c '.hookSpecificOutput.updatedToolOutput | keys')" '["interrupted","isImage","stderr","stdout"]'
expect_eq "post-bash: small output untouched" "$(post "make build" "ok")" ""
expect_eq "post-bash: viewer commands untouched (grep)" "$(post "grep -rn unit ." "$big_out")" ""
expect_eq "post-bash: last pipe segment decides (| head)" "$(post "make build 2>&1 | head -700" "$big_out")" ""
expect_eq "post-bash: background commands untouched" "$(hook post-bash "$(jq -nc --arg o "$big_out" '{tool_input: {command: "make", run_in_background: true}, tool_response: {stdout: $o}}')")" ""
printf '%s\nERROR: only in the full file\n' "$big_out" > "$T/persisted.txt"
r=$(post "make build" "$(printf '%s' "$big_out" | head -c 3000)" "$(jq -nc --arg p "$T/persisted.txt" '{persistedOutputPath: $p, persistedOutputSize: 99999}')")
d=$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout // ""')
expect_has "post-bash: reads persistedOutputPath (full output)" "$d" "ERROR: only in the full file"
[ "$(printf '%s' "$d" | head -c 2000 | grep -c 'ERROR: only')" -ge 1 ] && ok "post-bash: compact digest puts key lines in the first 2KB" || bad "post-bash: compact digest puts key lines in the first 2KB"
r=$(OFFLOAD_OPENCODE_BIN=/nonexistent post "make build" "$big_out")
expect_has "post-bash: without opencode still digests deterministically" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')" "key lines, verbatim"
r=$(hook session-start '{"source":"startup"}')
expect_has "session-start: injects guide" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.additionalContext')" "offload read -q"
r=$(OFFLOAD_OPENCODE_BIN=/nonexistent hook session-start '{"source":"startup"}')
expect_has "session-start: warns user when no backend is available" "$(printf '%s' "$r" | jq -r '.systemMessage')" "no worker backend available"

# ------------------------------------------------------------------ integration
if $INTEGRATION; then
  section "integration (real opencode: ${REAL_OPENCODE:-missing})"
  if [ -z "$REAL_OPENCODE" ] || ! command -v python3 >/dev/null 2>&1; then
    bad "integration needs opencode and python3"
  else
    MPORT=18381
    MOCK_PORT=$MPORT MOCK_LOG="$T/mock.log" python3 "$HERE/mock_openai.py" > "$T/mock.out" 2>&1 &
    MPID=$!
    sleep 1
    major=$("$REAL_OPENCODE" --version 2>/dev/null | tail -1 | sed -n 's/[^0-9]*\([0-9][0-9]*\)\..*/\1/p')
    if [ "${major:-1}" -ge 2 ]; then
      prov=$(jq -nc --arg u "http://127.0.0.1:$MPORT/v1" '{providers: {mock: {name: "Mock", package: "@opencode/ai/providers/openai-compatible", settings: {baseURL: $u, apiKey: "x"}, models: {echo: {}, "m-auth": {}, "m-error": {}, "m-readenv": {}}}}}')
    else
      prov=$(jq -nc --arg u "http://127.0.0.1:$MPORT/v1" '{provider: {mock: {npm: "@ai-sdk/openai-compatible", name: "Mock", options: {baseURL: $u, apiKey: "x"}, models: {echo: {name: "e"}, "m-auth": {name: "a"}, "m-error": {name: "r"}, "m-readenv": {name: "x"}}}}}')
    fi
    {
      export OFFLOAD_OPENCODE_BIN="$REAL_OPENCODE" OPENCODE_CONFIG_CONTENT="$prov" OFFLOAD_MODEL=mock/echo NO_PROXY="127.0.0.1,localhost"
      rm -rf "$OFFLOAD_STATE_DIR"
      out=$("$OFFLOAD" read -q "what is line 3?" big.ts 2>&1)
      expect_has "real opencode v$major: read round trip" "$out" "MOCK-REPLY"
      tools=$(printf '%s\n' "$out" | sed -n 's/.* tools=\([^ ]*\).*/\1/p' | head -1)
      case ",$tools," in
        *,read,*|*,edit,*|*,write,*|*,bash,*|*,shell,*|*,glob,*|*,grep,*) bad "real opencode v$major: reader has no file/shell tools" "tools=$tools" ;;
        *) ok "real opencode v$major: reader has no file/shell tools (tools=$tools)" ;;
      esac
      out=$("$OFFLOAD" explore "where is fn3?" 2>&1)
      expect_has "real opencode v$major: explorer gets read/grep/glob only" "$out" "glob,grep,read"
      expect_not "real opencode v$major: explorer cannot edit" "$out" "edit"
      out=$(MOCK_READ_PATH="$P/.env" "$OFFLOAD" explore -m mock/m-readenv "env?" 2>&1)
      expect_not "real opencode v$major: explorer cannot read .env" "$out" "SECRET=abc"
      "$OFFLOAD" ask -m mock/m-auth "hi" >/dev/null 2>&1; expect_eq "real opencode v$major: auth → 11" "$?" 11
      "$OFFLOAD" ask -m mock/nope "hi" >/dev/null 2>&1; expect_eq "real opencode v$major: unknown model → 13" "$?" 13
      s=$(date +%s); "$OFFLOAD" ask -m mock/m-error "hi" >/dev/null 2>&1; rc=$?
      expect_eq "real opencode v$major: 429 → 10 (took $(( $(date +%s) - s ))s)" "$rc" 10
      out=$("$OFFLOAD" doctor 2>&1)
      expect_has "real opencode v$major: doctor agent check" "$out" "worker agents load"
      if $E2E; then
        if command -v claude >/dev/null 2>&1; then
          cat > "$T/script.json" <<EOF
[{"name": "Read", "input": {"file_path": "$P/big.ts"}},
 {"name": "Bash", "input": {"command": "cat $P/big.ts", "description": "show"}},
 {"name": "Bash", "input": {"command": "python3 -c \"[print('unit', i) for i in range(1500)]; print('ERROR: x.ts:1 boom')\"", "description": "Build"}},
 {"name": "Bash", "input": {"command": "offload read -q 'what is fn3?' big.ts", "description": "delegate"}}]
EOF
          log=$("$HERE/e2e-claude.sh" "$T/script.json" "$P" "$T/e2e")
          r0=$(jq -r 'select(.kind == "tool_result" and .index == 0) | .text' "$log")
          r1=$(jq -r 'select(.kind == "tool_result" and .index == 1) | .text' "$log")
          r2=$(jq -r 'select(.kind == "tool_result" and .index == 2) | .text' "$log")
          r3=$(jq -r 'select(.kind == "tool_result" and .index == 3) | .text' "$log")
          expect_has "claude e2e: SessionStart guide reaches the model" "$(jq -r 'select(.kind == "request") | .has_offload_context' "$log" | head -1)" "true"
          expect_has "claude e2e: Read of big file denied with outline" "$r0" "L1: export function fn1"
          expect_has "claude e2e: cat of big file denied" "$r1" "offload read -q"
          expect_has "claude e2e: big Bash output replaced by digest" "$r2" "key lines, verbatim"
          expect_has "claude e2e: offload CLI on the Bash PATH" "$r3" "[offload read"
        else
          bad "e2e needs the claude binary"
        fi
      fi
    }
    kill "$MPID" 2>/dev/null
  fi
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
