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

HAVE_TS_NODE=false
command -v node >/dev/null 2>&1 && [ -f "$PLUGIN/dist/cli.js" ] && HAVE_TS_NODE=true

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

# A cloned repo's .harness-offload.json must not choose binaries, endpoints
# (where API keys go) or turn privacy guards off.
printf '#!/bin/sh\ntouch "%s/PWNED"\necho "{}"\n' "$T" > "$T/evil.sh"; chmod +x "$T/evil.sh"
jq -n --arg e "$T/evil.sh" '{opencode: {bin: $e, timeout_seconds: 7}, agents: {claude: {bin: $e}},
  endpoints: {openai: {base_url: "http://127.0.0.1:9/v1", api_key_env: "HOME"}}, backend: "openai", state_dir: "/tmp/x",
  privacy: {redact: false, secret_globs: ["*.secret"], secret_allow_globs: [".env"]}, models: {read: "x/y"}}' > "$P/.harness-offload.json"
cfgj=$(OFFLOAD_OPENCODE_BIN= "$OFFLOAD" config show 2>/dev/null | grep -v '^#')
expect_eq "project config: binaries/endpoints/backend ignored" "$(printf '%s' "$cfgj" | jq -c --arg s "$OFFLOAD_STATE_DIR" '[.opencode.bin, .agents.claude.bin, .endpoints.openai, .backend, .state_dir == $s]')" '["opencode",null,null,"opencode",true]'
expect_eq "project config: privacy can only tighten" "$(printf '%s' "$cfgj" | jq -c '[.privacy.redact, (.privacy.secret_globs | index("*.secret") != null), (.privacy.secret_globs | index(".env") != null), (.privacy.secret_allow_globs | index(".env"))]')" '[true,true,true,null]'
expect_eq "project config: models and timeout still apply" "$(printf '%s' "$cfgj" | jq -c '[.models.read, .opencode.timeout_seconds]')" '["x/y",7]'
expect_has "project config: ignored keys are listed" "$("$OFFLOAD" config show 2>/dev/null | grep '^#')" "agents, backend, endpoints, state_dir, opencode.bin, privacy.redact"
PATH="/nonexistent-bin:$PATH" "$OFFLOAD" ask -m claude:haiku "hi" >/dev/null 2>&1
OFFLOAD_OPENCODE_BIN= "$OFFLOAD" ask -m x/y "hi" >/dev/null 2>&1
[ -e "$T/PWNED" ] && bad "project config cannot make offload run a repo's script" || ok "project config cannot make offload run a repo's script"
"$OFFLOAD" config trust >/dev/null 2>&1
expect_eq "config trust: a trusted project may set binaries" "$("$OFFLOAD" config show 2>/dev/null | grep -v '^#' | jq -r '.agents.claude.bin')" "$T/evil.sh"
expect_eq "config files are owner-only" "$(ls -l "$OFFLOAD_CONFIG" | cut -c1-10)" "-rw-------"
rm -f "$OFFLOAD_CONFIG" "$P/.harness-offload.json" "$T/PWNED"

# ------------------------------------------------------------------ helpers
section "helpers"
. "$PLUGIN/lib/common.sh"; . "$PLUGIN/lib/outline.sh"; . "$PLUGIN/lib/digest.sh"; . "$PLUGIN/lib/opencode.sh"
CO_CONFIG=""; co_config_load
fast=$(OFFLOAD_NO_CONFIG_CACHE=1 bash -c '. "$1/lib/common.sh"; co_config_load_slow() { echo SLOW; }; co_config_load' _ "$PLUGIN")
expect_not "config: the one-pass loader compiles on this jq ($(jq --version))" "$fast" "SLOW"
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
red2=$(printf '%s\n' 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" -H "X-Api-Key: zyxwvutsrqponmlk"' \
  'DATABASE_URL=postgres://admin:s3cr3tpass@db.example.com/app' 'AWS=ASIAABCDEFGHIJKLMNOP' '{"token": "abc def ghi jkl"}' \
  "password = 'correct horse battery'" 'sk_live_abcdefghijklmnop npm_abcdefghijklmnopqrstuvwxyz0123456789 glpat-abcdefghijklmnopqrst' \
  '-----BEGIN OPENSSH PRIVATE KEY-----' 'b3BlbnNzaC1rZXktdjEAAAA' | co_redact)
for leak in abcdefghijklmnopqrstuvwxyz012345 zyxwvutsrqponmlk s3cr3tpass ASIAABCDEFGHIJKLMNOP "abc def ghi jkl" "correct horse battery" \
  sk_live_abcdefghijklmnop npm_abcdefghijklmnopqrstuvwxyz0123456789 glpat-abcdefghijklmnopqrst b3BlbnNzaC1rZXktdjEAAAA; do
  expect_not "redact: $leak" "$red2" "$leak"
done
expect_has "redact: keeps the URL host" "$red2" "@db.example.com/app"
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
# a file offload sent from outside this folder (a log in /tmp, a sibling repo) is checked too
mkdir -p "$T/elsewhere"; printf 'alpha\nthe retry budget is 5 attempts\nomega\n' > "$T/elsewhere/notes.txt"
out=$(STUB_ANSWER="budget is 5 — $T/elsewhere/notes.txt:L2 \`the retry budget is 5 attempts\`" "$OFFLOAD" read -q "retry budget?" "$T/elsewhere/notes.txt" 2>&1)
expect_has "read: citation into a file sent from outside the folder (absolute) is verified" "$out" "citations: 1 verified, 0 unverified"
rel=$(cd "$P" && printf '%s' "$T/elsewhere/notes.txt" | awk -v p="$P" '{ n = split(p, a, "/"); s = ""; for (i = 2; i <= n; i++) s = s "../"; print s substr($0, 2) }')
out=$(STUB_ANSWER="budget — $rel:L2 \`the retry budget is 5 attempts\`" "$OFFLOAD" read -q "retry budget?" "$rel" 2>&1)
expect_has "read: … and through ../ (as given)" "$out" "citations: 1 verified, 0 unverified"
out=$(STUB_ANSWER="hosts — /etc/hosts:L1 \`localhost\` and $T/elsewhere/notes.txt:L2 \`the retry budget is 5 attempts\`" "$OFFLOAD" read -q "?" "$T/elsewhere/notes.txt" 2>&1)
expect_has "read: a file that was NOT sent stays unverifiable outside the folder" "$out" "citations: 1 verified, 1 unverified"
out=$(STUB_PROMPT="$T/prompt-key" "$OFFLOAD" run -c 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz seq 1 3000' 2>&1)
expect_not "run: a key in the command line never reaches the worker" "$(cat "$T/prompt-key" 2>/dev/null)" "abcdefghijklmnopqrstuvwxyz"
expect_not "run: … nor the stats or log names" "$(cat "$OFFLOAD_STATE_DIR/stats.jsonl"; ls "$OFFLOAD_STATE_DIR/logs")" "abcdefghijklmnopqrstuvwxyz"
out=$(STUB_ANSWER='the key is AKIAABCDEFGHIJKLMNOP' "$OFFLOAD" ask "what key?" 2>&1)
expect_not "answers are redacted before they reach the agent" "$out" "AKIAABCDEFGHIJKLMNOP"
ln -sf .env notes-link.md
"$OFFLOAD" read -q "what?" notes-link.md >/dev/null 2>&1; expect_eq "read: a link to a secret is refused (exit 16)" "$?" 16
mkdir -p linkdir; printf 'hello\n' > linkdir/ok.txt; ln -sf ../.env linkdir/env-link.txt
out=$(STUB_PROMPT="$T/prompt-links" "$OFFLOAD" read -q "what?" linkdir 2>&1)
expect_not "read DIR: links inside are not followed" "$(cat "$T/prompt-links")" "SECRET=abc"
expect_has "read DIR: regular files still sent" "$(cat "$T/prompt-links")" "hello"
# own dir: on a case-insensitive FS (macOS) .ENV is .env, and removing it would delete the fixture
mkdir -p casedir; cp .env casedir/.ENV; "$OFFLOAD" read -q "what?" casedir/.ENV >/dev/null 2>&1; expect_eq "read: secret names match case-insensitively" "$?" 16
rm -rf notes-link.md linkdir casedir
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
# a citation whose path the worker shortened or mangled is repaired to the one file it means
mkdir -p repair/src/fx repair/hooks repair/a repair/b
printf 'export const ledger = []\nexport function post(entry) { ledger.push(entry) }\n' > repair/src/fx/ledger.ts
printf '#!/bin/sh\n# blocks full reads of huge files\nexit 0\n' > repair/hooks/pre-read
printf 'export const same = "first"\n' > repair/a/util.ts
printf 'export const same = "second"\n' > repair/b/util.ts
out=$(STUB_ANSWER='post appends — fx/ledger.ts:L2 `ledger.push(entry)`; the hook — pre-read:L2 `blocks full reads`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: a shortened path and a bare file name are still verified" "$out" "citations: 2 verified, 0 unverified"
expect_has "read: … the shortened one is rewritten to the real path" "$out" "repair/src/fx/ledger.ts:L2"
expect_has "read: … and so is the bare file name" "$out" "repair/hooks/pre-read:L2"
out=$(STUB_ANSWER='post — app/fx/ledger.ts:L2 `ledger.push(entry)`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: a wrong folder with a unique file name is repaired by name" "$out" "repair/src/fx/ledger.ts:L2"
out=$(STUB_ANSWER='first — util.ts:L1 `same = "first"`; also — lib/nowhere.ts:L2 `ledger.push(entry)`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: an ambiguous name, or one no sent file has, stays unverified" "$out" "citations: 0 verified, 2 unverified"
expect_has "read: … and is left as written" "$out" "util.ts:L1 \`same"
out=$(STUB_ANSWER='a — `repair/src/fx/ledger.ts:L2` `ledger.push(entry)`, defined just above `repair/src/fx/ledger.ts:L1`.' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: a backticked citation's closing backtick never becomes the next one's quote" "$out" "citations: 2 verified, 0 unverified"
out=$(STUB_ANSWER='- `repair/src/fx/ledger.ts:L2` in `post()`: `repair/src/fx/ledger.ts:L2` `ledger.push(entry)`; not `repair/src/fx/ledger.ts:L20` `ledger.push(entry)`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: the same citation twice on a line is checked once, where its quote is" "$out" "citations: 1 verified, 1 unverified"
out=$(STUB_ANSWER='- `repair/src/fx/ledger.ts:2` in `post()`: `ledger.push(entry)`; served on localhost:8080 at 10:30' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: path:N without L is checked when the path is a sent file (second quote span)" "$out" "citations: 1 verified, 0 unverified"
out=$(STUB_ANSWER='port localhost:8080 and nowhere.ts:2 `ledger.push(entry)`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: host:port and unknown name:N are plain text, not citations" "$out" "citations: 0 verified, 0 unverified"
out=$(STUB_ANSWER='a — repair/src/fx/ledger.ts:L2 `export function post(...) { ledger.push(entry) }`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: a quote shortened with ... is verified piece by piece" "$out" "citations: 1 verified, 0 unverified"
out=$(STUB_ANSWER='b — repair/src/fx/ledger.ts:L2 `ledger.push(entry) … export function`' "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: … and the pieces must come in order" "$out" "citations: 0 verified, 1 unverified"
# digest fixtures (evals/digest-fixtures): lines a digest must never lose, without a model
DF="$PLUGIN/../../evals/digest-fixtures"
for spec in "$DF"/*.txt; do
  [ -f "$spec" ] || continue
  name=$(basename "$spec" .txt)
  awk -f "$DF/expand.awk" "$spec" > "$T/fx-$name.log"
  dg=$("$OFFLOAD" summarize --no-model "$T/fx-$name.log" 2>&1)
  miss=""
  while IFS= read -r k; do printf '%s' "$dg" | grep -qF -- "$k" || miss="$miss
  missing: $k"; done <<EOF_KEEP
$(sed -n 's/^# keep: //p' "$spec")
EOF_KEEP
  if [ -z "$miss" ]; then ok "digest keeps what matters: $name"; else bad "digest keeps what matters: $name" "$miss"; fi
done
# mostly-unverified answers get one retry with the failures in view; the better answer is kept
BADA='a — repair/hooks/pre-read:L2 `not this`; b — repair/src/fx/ledger.ts:L1 `nor this`; c — repair/src/fx/ledger.ts:L2 `ledger.push(entry)`'
GOODA='fixed — repair/src/fx/ledger.ts:L2 `ledger.push(entry)` and repair/src/fx/ledger.ts:L1 `export const ledger = []`'
out=$(STUB_PROMPT="$T/prompt-retry" STUB_ANSWER="$BADA" STUB_ANSWER_RETRY="$GOODA" "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: mostly unverified → one retry, better answer kept" "$out" "citations: 2 verified, 0 unverified · retried once: 2 → 0 unverified"
expect_has "read: … the retry saw the failed answer and what to fix" "$(cat "$T/prompt-retry")" "<check>Some citations in your previous answer"
out=$(STUB_ANSWER="$BADA" "$OFFLOAD" read -q "?" repair 2>&1)
expect_has "read: a retry that is no better keeps the first answer" "$out" "citations: 1 verified, 2 unverified · retried once, the first answer was better"
printf '{"read":{"retry_unverified":false}}' > "$OFFLOAD_CONFIG"
out=$(STUB_ANSWER="$BADA" STUB_ANSWER_RETRY="$GOODA" "$OFFLOAD" read -q "?" repair 2>&1)
rm -f "$OFFLOAD_CONFIG"
expect_not "read: read.retry_unverified false: no retry" "$out" "retried"
out=$(STUB_ANSWER="$GOODA" STUB_ANSWER_RETRY="$BADA" "$OFFLOAD" read -q "?" repair 2>&1)
expect_not "read: a well-cited answer is never retried" "$out" "retried"
# real worker answers (evals/real-answers): the verifier must give the recorded counts
RA="$PLUGIN/../../evals/real-answers"
if [ -f "$RA/cases.txt" ]; then
  RD="$T/real"; mkdir -p "$RD/proj"
  "$PLUGIN/../../evals/fixtures/generate.sh" "$RD/fx" >/dev/null && cp -r "$PLUGIN/../../evals/fixtures/warehouse" "$RD/fx/"
  cp "$RA/orders.py" "$RD/proj/"
  while IFS='|' read -r name kind dir paths want; do
    name=$(echo $name); kind=$(echo $kind); dir=$(echo $dir); want=$(echo $want)
    case "$name" in ''|'#'*) continue ;; esac
    ans=$(sed "s|{{DIR}}|$RD|g" "$RA/$name.md")
    if [ "$kind" = read ]; then
      # shellcheck disable=SC2086
      out=$(cd "$RD/$dir" && STUB_ANSWER="$ans" "$OFFLOAD" read -q "?" $(echo $paths | sed "s|{{DIR}}|$RD|g") 2>&1)
    else
      out=$(cd "$RD/$dir" && STUB_ANSWER="$ans" "$OFFLOAD" explore "?" 2>&1)
    fi
    expect_has "real answer $name: $want verified/unverified" "$out" "citations: ${want% *} verified, ${want#* } unverified"
  done < "$RA/cases.txt"
fi
out=$(STUB_ANSWER='posting — src/fx/ledger.ts:L2 `ledger.push(entry)`' "$OFFLOAD" explore "where are entries posted?" 2>&1)
expect_has "explore: a citation missing the folder prefix is checked against the project's files" "$out" "citations: 1 verified, 0 unverified"
expect_has "explore: … and rewritten to the real path" "$out" "repair/src/fx/ledger.ts:L2"
out=$(STUB_ANSWER='posting — src/fx/ledger.ts:L2 `nothing like this line`' "$OFFLOAD" explore "where?" 2>&1)
expect_has "explore: a repaired path still needs its quote to match" "$out" "citations: 0 verified, 1 unverified"
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
# 600 warnings that differ only in numbers must not push real errors out of the key lines
awk 'BEGIN { for (i = 1; i <= 1200; i++) { if (i == 500) print "src/pay/charge.ts:88:5 - error TS2345: Argument of type string"; else if (i == 700) print "FAIL src/pay/refund.test.ts > refunds twice"; else if (i % 2) printf "warning: deprecated API useLegacy() in src/mod%d.ts:%d:%d\n", i % 40, i, i % 9; else printf "  compiling module %d\n", i } }' > "$T/noisy.log"
out=$("$OFFLOAD" summarize --no-model "$T/noisy.log")
expect_has "digest: a real error survives 600 near-identical warnings" "$out" "L500: src/pay/charge.ts:88:5 - error TS2345"
expect_has "digest: … and so does a failing test" "$out" "L700: FAIL src/pay/refund.test.ts"
expect_has "digest: lines that differ only in numbers are one kind" "$out" "(600 similar lines)"
expect_has "digest: … and the rest is counted" "$out" "... 599 more distinct matching lines"
awk 'BEGIN { for (i = 1; i <= 300; i++) print "build ok"; for (i = 1; i <= 5; i++) printf "FAIL test %d\n", i }' > "$T/fails.log"
out=$("$OFFLOAD" summarize --no-model "$T/fails.log")
expect_has "digest: error-like kinds show up to three instances" "$out" "L303: FAIL test 3  (5 similar lines)"
# library and runtime stack frames are counted, not shown; the project's own frames stay
{ printf 'TypeError: boom\n      at total (src/cart.ts:41:11)\n'; for i in 1 2 3 4 5 6; do printf '      at Object.<anonymous> (node_modules/jest-circus/build/utils.js:30%d:1)\n' $i; done
  printf 'java.lang.AssertionError: expected:<1> but was:<0>\n\tat org.junit.Assert.fail(Assert.java:89)\n\tat com.acme.pay.RefundTest.testRefund(RefundTest.java:21)\n\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)\n'
  printf '  File "/usr/lib/python3.12/unittest/case.py", line 58, in testPartExecutor\n  File "tests/test_pay.py", line 9, in test_refund\nAssertionError: 1 != 0\n'
  seq 1 300; } > "$T/frames.log"
out=$("$OFFLOAD" summarize --no-model "$T/frames.log")
expect_has "digest: the project's own frame stays (node)" "$out" "at total (src/cart.ts:41:11)"
expect_has "digest: … (java)" "$out" "at com.acme.pay.RefundTest.testRefund(RefundTest.java:21)"
expect_not "digest: library frames are not shown (node_modules)" "$out" "jest-circus"
expect_not "digest: … (junit, jdk internals)" "$out" "org.junit.Assert.fail"
expect_has "digest: … but counted" "$out" "... 8 stack frames in libraries and the runtime left out"
expect_has "summarize: digest is recorded in stats" "$(tail -1 "$OFFLOAD_STATE_DIR/stats.jsonl")" '"source":"summarize"'
expect_eq "stats: no blank or broken lines" "$(jq -Rr 'fromjson? // "BAD" | select(. == "BAD")' "$OFFLOAD_STATE_DIR/stats.jsonl" | wc -l | tr -d ' ')" 0
out=$("$OFFLOAD" stats)
expect_has "stats: aggregates" "$out" "delegations:"
out=$("$OFFLOAD" doctor 2>&1)
expect_has "doctor runs" "$out" "worker agents load"
n_del=$(jq -s 'map(select(.kind != "hook")) | length' "$OFFLOAD_STATE_DIR/stats.jsonl")
expect_eq "stats --json: delegations match the log" "$("$OFFLOAD" stats --json | jq -r .delegations)" "$n_del"
now=$(date +%s); for e in read_blocked bash_read_blocked read_slice_blocked autowrap; do printf '{"ts":%s,"kind":"hook","event":"%s"}\n' "$now" "$e" >> "$OFFLOAD_STATE_DIR/stats.jsonl"; done
n_blk=$(jq -s '[.[] | select(.kind == "hook" and ((.event // "") | endswith("blocked")))] | length' "$OFFLOAD_STATE_DIR/stats.jsonl")
expect_eq "stats --json: blocked reads (extra agent turns) counted, other hook events not" "$("$OFFLOAD" stats --json | jq -r .blocked_reads)" "$n_blk"
[ "$n_blk" -ge 3 ] && ok "stats: (fixture has blocked reads)" || bad "stats: (fixture has blocked reads)" "n_blk=$n_blk"
expect_has "stats: blocked reads shown as extra turns" "$("$OFFLOAD" stats)" "blocked reads: $n_blk (each costs the agent one more turn"
expect_has "stats: 14-day sparkline" "$("$OFFLOAD" stats)" "last 14 days"
# an input too large for a model: its own exit code, a hint, and no cooldown (the model is fine)
out=$("$OFFLOAD" ask -m stub/toolong "x" 2>&1); rc=$?
expect_eq "too large: exit 17, not a quota error (10)" "$rc" 17
expect_has "too large: says how to send less" "$out" "hint: send less at once"
SAVED_STATE=$OFFLOAD_STATE_DIR; export OFFLOAD_STATE_DIR="$T/state-toolong"
printf '{"models":{"default":"stub/toolong","fallback":["stub/ok"]}}' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" ask "x" 2>&1); rc=$?
expect_eq "too large: the chain moves on to the next model" "$rc" 0
expect_eq "too large: no cooldown for that model" "$(ls "$OFFLOAD_STATE_DIR/cooldowns" 2>/dev/null | wc -l | tr -d ' ')" 0
rm -f "$OFFLOAD_CONFIG"; export OFFLOAD_STATE_DIR=$SAVED_STATE
# logs hold raw command output: the state folder is private (new and existing ones)
( umask 022; export OFFLOAD_STATE_DIR="$T/state-perm"; mkdir -p "$OFFLOAD_STATE_DIR"; chmod 755 "$OFFLOAD_STATE_DIR"
  seq 1 400 | "$OFFLOAD" summarize --no-model >/dev/null 2>&1
  ls -ld "$OFFLOAD_STATE_DIR" | cut -c1-10 ) > "$T/perm.txt"
expect_eq "state: the state folder (logs, stats) is private, even one that existed" "$(cat "$T/perm.txt")" "drwx------"
# per-model latency and citations; every record as CSV
SAVED_STATE=$OFFLOAD_STATE_DIR; export OFFLOAD_STATE_DIR="$T/state-model"; mkdir -p "$OFFLOAD_STATE_DIR"
for i in 1 2 3 4 5 6 7 8 9 10; do printf '{"ts":%s,"kind":"read","model":"m:a","seconds":%s,"cites_ok":2,"cites_bad":%s,"label":"q \\"x\\", y"}\n' "$(date +%s)" "$i" $((i % 2)); done > "$OFFLOAD_STATE_DIR/stats.jsonl"
expect_eq "stats --json: p50/p95 seconds per model (nearest rank)" "$("$OFFLOAD" stats --json | jq -c '.by_model["m:a"] | [.count, .p50_seconds, .p95_seconds, .cites_ok, .cites_bad]')" "[10,5,10,20,5]"
expect_eq "stats --csv: a header and one row per record" "$("$OFFLOAD" stats --csv | wc -l | tr -d ' ')" 11
expect_has "stats --csv: quotes and commas inside fields are escaped" "$("$OFFLOAD" stats --csv | sed -n 2p)" ',"q ""x"", y",'
export OFFLOAD_STATE_DIR=$SAVED_STATE
# task templates: list, add one, run it
expect_has "tasks templates: lists review-diff with an example" "$("$OFFLOAD" tasks templates)" "e.g. git diff | offload task review-diff --stdin"
out=$("$OFFLOAD" tasks add pr --from review-diff); rc=$?
expect_eq "tasks add: exit 0" "$rc" 0
expect_has "tasks add: says how to run it under its own name" "$out" "run it: git diff | offload task pr --stdin"
expect_eq "tasks add: the template's prompt is in the config" "$(jq -r '.tasks.pr.tools' "$OFFLOAD_CONFIG")" none
expect_has "tasks add: the new task runs" "$(printf 'diff --git a/x b/x\n' | STUB_PROMPT="$T/prompt-pr" STUB_ANSWER="no problems found" "$OFFLOAD" task pr --stdin 2>&1)" "no problems found"
"$OFFLOAD" tasks add pr --from review-diff >/dev/null 2>&1; expect_eq "tasks add: an existing task is not overwritten (exit 2)" "$?" 2
rm -f "$OFFLOAD_CONFIG"
# per-command help with examples; config get
expect_has "help read: usage and examples" "$("$OFFLOAD" help read)" "Examples:"
expect_eq "read --help = help read" "$("$OFFLOAD" read --help)" "$("$OFFLOAD" help read)"
expect_has "explain --help" "$("$OFFLOAD" explain --help)" "offload explain [N]"
expect_has "help without a topic: the overview" "$("$OFFLOAD" help)" "offload read"
printf '{"hooks":{"read_threshold_lines":900}}' > "$OFFLOAD_CONFIG"
expect_eq "config get: the file's own settings" "$("$OFFLOAD" config get | jq -c .)" '{"hooks":{"read_threshold_lines":900}}'
rm -f "$OFFLOAD_CONFIG"
# doctor --json: the same machine format from both engines
expect_eq "doctor --json: JSON with checks" "$("$OFFLOAD" doctor --json 2>/dev/null | jq -r 'type')" object
# a mistyped config key is reported, with the closest real key
printf '{"hooks":{"read_treshold_lines":2000},"endpoints":{"mine":{"base_url":"http://x"}},"tasks":{"t":{"prompt":"p"}}}' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" config validate 2>&1); rc=$?
expect_eq "config validate: unknown key → exit 1" "$rc" 1
expect_has "config validate: … with the closest real key" "$out" "hooks.read_treshold_lines (did you mean hooks.read_threshold_lines?)"
expect_not "config validate: your own maps (endpoints, tasks) take any key" "$out" "endpoints.mine"
expect_has "config set: warns about an unknown key" "$("$OFFLOAD" config set hooks.serch_view false 2>&1)" "warning: hooks.serch_view is not a known setting (did you mean hooks.search_view?)"
expect_not "config set: a known key sets quietly" "$("$OFFLOAD" config set hooks.read_threshold_lines 900 2>&1)" "warning"
printf '{"hooks":{"read_threshold_lines":900}}' > "$OFFLOAD_CONFIG"
expect_has "config validate: a clean config is ok" "$("$OFFLOAD" config validate 2>&1)" "config ok: every key is known"
rm -f "$OFFLOAD_CONFIG"
# a model failure is a model that was tried and failed — not a digest that never asked one
SAVED_STATE=$OFFLOAD_STATE_DIR; export OFFLOAD_STATE_DIR="$T/state-fail"
seq 1 400 | "$OFFLOAD" summarize --no-model >/dev/null 2>&1
seq 1 400 | "$OFFLOAD" summarize -m stub/auth >/dev/null 2>&1
expect_eq "stats: a digest with no model asked is not a model failure" "$("$OFFLOAD" stats | awk '/digest:summarize/ { print $2 }')" 2
expect_eq "stats: … only the failed model call counts" "$("$OFFLOAD" stats | awk '/digest:summarize/ { print $NF }')" 1
expect_eq "stats rows say whether a model was tried" "$(jq -s -c 'map(.model_tried)' "$OFFLOAD_STATE_DIR/stats.jsonl")" "[false,true]"
export OFFLOAD_STATE_DIR=$SAVED_STATE
if [ "$HAVE_TS_NODE" = true ]; then
  out=$("$OFFLOAD" dashboard --out "$T/dash.html" 2>&1)
  expect_eq "dashboard: prints the report path" "$out" "$T/dash.html"
  expect_has "dashboard: report embeds this machine's stats" "$(cat "$T/dash.html")" '"kind":"read"'
fi

# ------------------------------------------------------- agent connectors
section "agent connectors (stub claude/codex/gemini/cursor-agent/pi)"
AB="$T/agent-bin"; mkdir -p "$AB"
for n in claude codex gemini cursor-agent pi copilot qwen crush; do ln -sf "$HERE/stub-agent" "$AB/$n"; done
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
out=$(ag explore -m claude:haiku "where is fn3?")
expect_has "claude explore: footer counts what the worker read (input + cache)" "$out" "worker read ~120 tokens"
out=$(ag ask -m codex:gpt-6-luna "hello codex")
expect_has "codex: answer (merged prompt on stdin)" "$out" "CODEX-STUB: hello codex"
: > "$STUB_AGENT_LOG"; ag ask -m codex:gpt-6-luna "x" >/dev/null
expect_has "codex: read-only sandbox" "$(cat "$STUB_AGENT_LOG")" "arg[read-only]"
out=$(ag ask -m gemini:flash-lite "hello gemini")
expect_has "gemini: answer + system prompt file" "$out" "GEMINI-STUB sys=ok: hello gemini"
out=$(ag ask -m cursor: "hello cursor")
expect_has "cursor: answer (prompt as argument)" "$out" "CURSOR-STUB: hello cursor"
out=$(ag explore -m cursor: "where is fn3?")
expect_has "cursor explore: footer counts what the worker read" "$out" "worker read ~30 tokens"
out=$(ag ask -m pi: "hello pi")
expect_has "pi: answer" "$out" "PI-STUB: hello pi"
out=$(ag read -m pi: -q "what?" small.txt)
expect_has "pi: read footer" "$out" "[offload read · pi:"
out=$(STUB_AGENT_MODE=pretty ag ask -m gemini:x "pretty")
expect_has "gemini: pretty-printed JSON after log lines" "$out" "GEMINI-PRETTY: pretty"
: > "$STUB_AGENT_LOG"; ag explore -m claude:haiku "where?" >/dev/null
expect_has "claude explore: secret files denied to its Read tool" "$(cat "$STUB_AGENT_LOG")" "arg[Read(**/.env)"
out=$(ag ask -m copilot: "hello copilot")
expect_has "copilot: answer (prompt on stdin, JSONL events)" "$out" "COPILOT-STUB: hello copilot"
: > "$STUB_AGENT_LOG"; ag ask -m copilot:gpt-5-mini "x" >/dev/null
expect_has "copilot: no tools for a plain question" "$(cat "$STUB_AGENT_LOG")" "arg[none]"
: > "$STUB_AGENT_LOG"; ag explore -m copilot: "where?" >/dev/null
expect_has "copilot: explore gets view/grep/glob only" "$(cat "$STUB_AGENT_LOG")" "arg[glob]"
out=$(ag ask -m qwen: "hello qwen")
expect_has "qwen: answer, background memory switched off" "$out" "QWEN-STUB memory=off: hello qwen"
out=$(ag ask -m crush: "hello crush")
expect_has "crush: answer, every Crush tool switched off (crush run auto-approves)" "$out" "CRUSH-STUB tools-off=29: hello crush"
ag explore -m crush: "where?" >/dev/null 2>&1; expect_eq "crush: never used as an explorer (usage exit 2)" "$?" 2
STUB_AGENT_MODE=quota ag ask -m copilot:x "hi" >/dev/null; expect_eq "copilot: rate limit → exit 10" "$?" 10
STUB_AGENT_MODE=quota ag ask -m qwen:x "hi" >/dev/null; expect_eq "qwen: rate limit → exit 10" "$?" 10
STUB_AGENT_MODE=quota ag ask -m crush:x "hi" >/dev/null; expect_eq "crush: too many requests → exit 10" "$?" 10
out=$(COPILOT_CLI=1 ag ask -m @host "copilot plan")
expect_has "@host in Copilot CLI → its own CLI" "$out" "COPILOT-STUB: copilot plan"
out=$(QWEN_CODE_SESSION_ID=s ag ask -m @host "qwen plan")
expect_has "@host in Qwen Code → its own CLI" "$out" "QWEN-STUB"
out=$(CRUSH=1 ag ask -m @host "crush plan")
expect_has "@host in Crush → its own CLI" "$out" "CRUSH-STUB tools-off=29: crush plan"
STUB_AGENT_MODE=auth ag ask -m claude:haiku "hi" >/dev/null; expect_eq "claude: login problem → exit 11" "$?" 11
STUB_AGENT_MODE=quota ag ask -m claude:sonnet "hi" >/dev/null; expect_eq "claude: usage limit → exit 10" "$?" 10
STUB_AGENT_MODE=quota ag ask -m codex:x "hi" >/dev/null; expect_eq "codex: usage limit → exit 10" "$?" 10
out=$(STUB_AGENT_MODE=auth ag ask -m gemini:y "hi"); expect_eq "gemini: exit 41 → exit 11" "$?" 11
expect_has "gemini: shows its own login message (JSON on stderr)" "$out" "Please set an Auth method"
STUB_AGENT_MODE=auth ag ask -m qwen:x "hi" >/dev/null; expect_eq "qwen: no auth type selected → exit 11" "$?" 11
STUB_AGENT_MODE=auth ag ask -m pi:x "hi" >/dev/null; expect_eq "pi: invalid security token → exit 11" "$?" 11
out=$(STUB_AGENT_MODE=nokey ag ask -m pi:x "hi"); expect_eq "pi: no API key (reason on its first stderr line) → exit 11" "$?" 11
expect_has "pi: the error shows pi's reason" "$out" "No API key found"
STUB_AGENT_MODE=auth ag ask -m crush:x "hi" >/dev/null; expect_eq "crush: no providers configured → exit 11" "$?" 11
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
out=$(OFFLOAD_MODEL= OFFLOAD_HOST=claude ag read -q "q" small.txt)
expect_has "out of the box, Claude Code reads go to its own plan (claude:haiku)" "$out" "[offload read · claude:haiku"
out=$(OFFLOAD_MODEL= STUB_ANSWER="oc default" ag ask "no harness"); rc=$?
expect_eq "out of the box, no harness → falls back to @default (exit 0)" "$rc" 0
expect_has "out of the box, no harness → OpenCode default model answers" "$out" "oc default"
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

# ------------------------------------------------------- TS-only commands
section "commands that live in the TypeScript CLI"
if $HAVE_TS_NODE; then
  out=$("$OFFLOAD" demo 2>&1); rc=$?
  expect_eq "demo runs from either engine" "$rc" 0
  expect_has "demo output" "$out" "no model calls"
fi
if [ "$OFFLOAD" = "$PLUGIN/bin/offload" ] && [ -x /usr/bin/jq ] && ! PATH=/usr/bin:/bin command -v node >/dev/null 2>&1; then
  out=$(PATH=/usr/bin:/bin "$OFFLOAD" setup 2>&1); rc=$?
  expect_eq "bash engine without Node: setup → exit 15" "$rc" 15
  expect_has "bash engine without Node: says what is needed" "$out" "setup needs Node.js 18+"
fi

# ------------------------------------------------------------ custom tasks
section "custom tasks (tasks.<name> in the config)"
out=$("$OFFLOAD" tasks 2>&1)
expect_has "tasks: none yet → shows how to add one" "$out" "No custom tasks yet"
mkdir -p "$P/prompts"; printf 'You summarise release notes for managers.\n' > "$P/prompts/notes.md"
awk 'BEGIN { for (i = 1; i <= 7000; i++) print "padding line " i }' > "$P/prompts/huge.md"
jq -n '{tasks: {
  "review-sql": {description: "Find N+1 queries", prompt: "You review SQL access code for N+1 queries.", model: "claude:haiku"},
  scan: {description: "Scan the repo", prompt: "List TODO comments.", tools: "read", model: "claude:haiku"},
  notes: {prompt_file: "prompts/notes.md", model: "claude:haiku"},
  outside: {prompt_file: "/etc/hosts"},
  secret: {prompt_file: ".env"},
  huge: {prompt_file: "prompts/huge.md"},
  writer: {prompt: "x", tools: "write"},
  empty: {description: "no prompt"}}}' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" tasks 2>&1)
expect_has "tasks: lists name and description" "$out" "review-sql"
expect_has "tasks: shows tools and model" "$out" "[none · claude:haiku]"
: > "$STUB_AGENT_LOG"; rm -f "$OFFLOAD_STATE_DIR/stats.jsonl"
out=$(STUB_AGENT_ARGS="$T/task-args" ag task review-sql small.txt); rc=$?
expect_eq "task with files: exit 0" "$rc" 0
expect_has "task with files: runs on the task's model, labelled as the task" "$out" "[offload task review-sql · claude:haiku · 1 file(s)"
targs=$(cat "$T/task-args")
expect_has "task: worker gets the task's own instructions" "$targs" "You review SQL access code for N+1 queries."
expect_has "task: + the shared citation rules" "$targs" "Citations are machine-checked."
expect_not "task: built-in read prompt replaced" "$targs" "$(head -1 "$PLUGIN/prompts/read.md" | cut -c1-40)"
expect_has "task: still no tools for a files task" "$targs" "--tools"
expect_has "task: stats record the task name" "$(tail -1 "$OFFLOAD_STATE_DIR/stats.jsonl")" '"task":"review-sql"'
expect_has "task: stats keep the flow kind" "$(tail -1 "$OFFLOAD_STATE_DIR/stats.jsonl")" '"kind":"read"'
out=$(ag task review-sql -q "only the orders table" small.txt)
expect_has "task: -q question reaches the worker" "$out" "[offload task review-sql"
out=$(ag task review-sql -m codex:gpt-6-luna small.txt)
expect_has "task: -m overrides the task's model" "$out" "[offload task review-sql · codex:gpt-6-luna"
out=$(ag task review-sql)
expect_has "task without files → one-shot (ask flow)" "$out" "CLAUDE-STUB: Do the task described in your instructions."
out=$(printf 'SELECT * FROM a;\n' | ag task review-sql --stdin)
expect_has "task --stdin: piped input goes to the worker" "$(grep stdin-bytes "$STUB_AGENT_LOG" | tail -1)" "stdin-bytes="
expect_has "task --stdin: answers" "$out" "[offload task review-sql · claude:haiku"
: > "$STUB_AGENT_LOG"; ag task scan src >/dev/null
expect_has "task tools:read → read-only explorer tools" "$(cat "$STUB_AGENT_LOG")" "arg[Read,Grep,Glob]"
out=$(STUB_AGENT_ARGS="$T/task-args2" ag task notes small.txt)
expect_has "task prompt_file inside the project is used" "$(cat "$T/task-args2")" "You summarise release notes for managers."
out=$(ag task outside small.txt); rc=$?
expect_eq "task prompt_file outside project/config dir → exit 2" "$rc" 2
expect_has "task prompt_file outside → explains" "$out" "must be inside the project"
out=$(ag task secret small.txt); rc=$?
expect_eq "task prompt_file that is a secret → exit 2" "$rc" 2
expect_has "task prompt_file secret → explains" "$out" "secret_globs"
out=$(ag task huge small.txt); rc=$?
expect_eq "task prompt_file over 64 KB → exit 2" "$rc" 2
out=$(ag task writer small.txt); rc=$?
expect_has "task tools other than none/read refused" "$out" 'tools must be "none" or "read"'
out=$(ag task empty small.txt); rc=$?
expect_has "task with no prompt → explains" "$out" "give it a prompt or a prompt_file"
out=$(ag task nope small.txt); rc=$?
expect_eq "unknown task → exit 2" "$rc" 2
expect_has "unknown task → points at offload tasks" "$out" "offload tasks"
out=$(ag task 'Bad*Name' small.txt); rc=$?
expect_eq "invalid task name → exit 2" "$rc" 2
out=$(ag doctor); rc=$?
expect_eq "doctor: a broken task is a problem (exit 1)" "$rc" 1
expect_has "doctor: names the task and why" "$out" "prompt_file must be inside the project"
expect_has "doctor: checks task tools" "$out" 'task writer: tools must be "none" or "read"'
expect_has "doctor: good tasks pass" "$out" "task review-sql (none · claude:haiku)"
STUB_CONFIG="$T/oc-cfg" ag task review-sql -m stub/ok small.txt >/dev/null
expect_has "task on OpenCode: its agent carries the task's instructions" "$(jq -r '(.agent // .agents)["offload-read"] | (.prompt // .system)' "$T/oc-cfg")" "You review SQL access code"
expect_has "task on OpenCode: + the shared rules" "$(jq -r '(.agent // .agents)["offload-read"] | (.prompt // .system)' "$T/oc-cfg")" "Citations are machine-checked."
STUB_CONFIG="$T/oc-cfg" ag read -m stub/ok -q q small.txt >/dev/null
expect_not "plain read on OpenCode keeps the built-in prompt" "$(jq -r '(.agent // .agents)["offload-read"] | (.prompt // .system)' "$T/oc-cfg")" "You review SQL"
expect_has "plain read on OpenCode: built-in prompt present" "$(jq -r '(.agent // .agents)["offload-read"] | (.prompt // .system)' "$T/oc-cfg")" "$(head -1 "$PLUGIN/prompts/read.md" | cut -c1-30)"
rm -f "$OFFLOAD_CONFIG"
printf '{"tasks":{"repo-task":{"description":"from the repo","prompt":"Repo rules."}}}' > "$P/.harness-offload.json"
out=$("$OFFLOAD" tasks 2>&1)
expect_has "tasks: an untrusted repo may define tasks" "$out" "repo-task"
expect_not "tasks: not reported as an ignored project key" "$("$OFFLOAD" config show 2>&1 | grep ignored)" "tasks"
rm -f "$P/.harness-offload.json"

# ------------------------------------------------------------ model command
section "offload model (show / change / undo)"
unset GROQ_API_KEY OPENROUTER_API_KEY
out=$(OFFLOAD_MODEL= "$OFFLOAD" model 2>&1); rc=$?
expect_eq "model: show exits 0" "$rc" 0
expect_has "model: shows the default (@host)" "$out" "default            @host"
expect_has "model: unset slots say (default)" "$out" "read               (default)"
out=$(OFFLOAD_MODEL= OFFLOAD_HOST=claude "$OFFLOAD" model 2>&1)
expect_has "model: @host resolved for the calling harness" "$out" "claude:haiku via claude's own plan"
out=$("$OFFLOAD" model read groq:llama-3.3-70b 2>&1); rc=$?
expect_eq "model: set read → exit 0" "$rc" 0
expect_eq "model: written to the user config" "$(jq -r '.models.read' "$OFFLOAD_CONFIG")" "groq:llama-3.3-70b"
expect_has "model: warns when the API key is missing" "$out" "no API key (export GROQ_API_KEY"
out=$(GROQ_API_KEY=x "$OFFLOAD" model read groq:llama-3.3-70b 2>&1)
expect_not "model: no warning once the key is there" "$out" "warning"
out=$("$OFFLOAD" model opnerouter:qwen/qwen3-coder 2>&1); rc=$?
expect_eq "model: unknown backend → exit 2" "$rc" 2
expect_has "model: typo → did you mean" "$out" "did you mean openrouter:qwen/qwen3-coder?"
expect_eq "model: rejected ref not written" "$(jq -r '.models.default // "unset"' "$OFFLOAD_CONFIG")" "unset"
out=$("$OFFLOAD" model groq: 2>&1); rc=$?
expect_eq "model: HTTP backend without a model id → exit 2" "$rc" 2
expect_has "model: says it needs a model id" "$out" "groq needs a model id"
out=$("$OFFLOAD" model groq 2>&1); rc=$?
expect_has "model: bare backend name → explains BACKEND:MODEL" "$out" "write groq:MODEL"
out=$("$OFFLOAD" model gpt5 2>&1); rc=$?
expect_eq "model: neither task nor ref → exit 2" "$rc" 2
out=$(PATH="$AB:$PATH" "$OFFLOAD" model claude:haiku 2>&1)
expect_has "model: one argument sets the default" "$out" "models.default = claude:haiku"
expect_has "model: agent CLI found" "$out" "claude CLI"
printf '%s' "$(jq --arg b "$T/nope/copilot" '.agents.copilot.bin = $b' "$OFFLOAD_CONFIG")" > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" model explore copilot: 2>&1)
expect_has "model: warns when the CLI is not installed" "$out" "nope/copilot is not installed"
out=$("$OFFLOAD" model fallback @host openrouter:qwen/qwen3-coder ollama:qwen3:8b 2>&1)
expect_eq "model: fallback takes several" "$(jq -c '.models.fallback' "$OFFLOAD_CONFIG")" '["@host","openrouter:qwen/qwen3-coder","ollama:qwen3:8b"]'
out=$("$OFFLOAD" model read a/b c/d 2>&1); rc=$?
expect_eq "model: only fallback takes several → exit 2" "$rc" 2
out=$("$OFFLOAD" model read --reset 2>&1)
expect_eq "model: --reset removes the setting" "$(jq -r '.models.read // "unset"' "$OFFLOAD_CONFIG")" "unset"
# plug and play: what `offload model` sets is what the next call uses
printf '%s' "$(jq '.models.fallback = []' "$OFFLOAD_CONFIG")" > "$OFFLOAD_CONFIG"
OFFLOAD_MODEL= "$OFFLOAD" model read codex:gpt-6-luna >/dev/null 2>&1
out=$(OFFLOAD_MODEL= ag read -q "q" small.txt)
expect_has "model: the next read runs on the new model" "$out" "[offload read · codex:gpt-6-luna"
OFFLOAD_MODEL= "$OFFLOAD" model read gemini:flash-lite >/dev/null 2>&1
out=$(OFFLOAD_MODEL= ag read -q "q" small.txt)
expect_has "model: switching again takes effect at once" "$out" "[offload read · gemini:flash-lite"
printf '{"models":{"read":"opnerouter:qwen/qwen3-coder"}}' > "$OFFLOAD_CONFIG"
out=$(ag doctor); rc=$?
expect_eq "doctor: mistyped backend is a problem" "$rc" 1
expect_has "doctor: mistyped backend → did you mean" "$out" "did you mean openrouter:qwen/qwen3-coder?"
printf '{"tasks":{"t1":{"prompt":"p"}}}' > "$OFFLOAD_CONFIG"
out=$("$OFFLOAD" model t1 pi: 2>&1)
expect_eq "model: sets a custom task's model" "$(jq -r '.tasks.t1.model' "$OFFLOAD_CONFIG")" "pi:"
out=$(ag task t1 small.txt)
expect_has "model: custom task then runs there" "$out" "[offload task t1 · pi:"
printf '{"models":{"read":"ollama:qwen3:8b"}}' > "$P/.harness-offload.json"
out=$("$OFFLOAD" model read groq:x 2>&1)
expect_has "model: says when the repo config overrides it" "$out" "another config file overrides this"
out=$("$OFFLOAD" model read groq:x --project 2>&1)
expect_eq "model: --project writes the repo config" "$(jq -r '.models.read' "$P/.harness-offload.json")" "groq:x"
rm -f "$P/.harness-offload.json" "$OFFLOAD_CONFIG"

# ------------------------------------------------------- API-key backup
section "@host-api (the same model family through an API key)"
export OFFLOAD_CREDENTIALS="$T/credentials.json"
unset ANTHROPIC_API_KEY GROQ_API_KEY
out=$(OFFLOAD_HOST=claude "$OFFLOAD" model fallback @host-api @default 2>&1)
expect_has "@host-api on Claude Code → anthropic:claude-haiku-5-5" "$out" "anthropic:claude-haiku-5-5 via claude's API key"
expect_has "@host-api warns while there is no key" "$out" "no key yet (offload key anthropic)"
out=$(OFFLOAD_HOST=codex "$OFFLOAD" model fallback 2>&1)
expect_has "model shows the backup in the chain" "$out" "@host-api, @default"
out=$(OFFLOAD_HOST=cursor "$OFFLOAD" model fallback @host-api 2>&1)
expect_has "@host-api on a harness without an API: skipped" "$out" "cursor has no API-key backup"
rm -f "$OFFLOAD_CONFIG"
out=$(OFFLOAD_HOST=claude ag ask -m @host-api "hi"); rc=$?
expect_eq "@host-api without a key → usage exit 2" "$rc" 2
expect_has "@host-api without a key → says how to add one" "$out" "offload key anthropic"
printf '{"host_api_models":{"claude":"codex:gpt-6-luna"}}' > "$OFFLOAD_CONFIG"
out=$(OFFLOAD_HOST=claude ag ask -m @host-api "via backup")
expect_has "@host-api resolves through host_api_models" "$out" "[offload ask · codex:gpt-6-luna"
printf '{"host_api_models":{"claude":"codex:gpt-6-luna"},"agents":{"claude":{"bin":"%s/no-claude"}},"models":{"default":"@host","fallback":["@host-api"]}}' "$T" > "$OFFLOAD_CONFIG"
out=$(OFFLOAD_MODEL= OFFLOAD_HOST=claude ag ask "plan route gone")
expect_has "claude -p unavailable → the API-key backup answers" "$out" "CODEX-STUB: plan route gone"
expect_has "backup answer is labelled with the real model" "$out" "[offload ask · codex:gpt-6-luna"
printf '{"agents":{"claude":{"bin":"%s/no-claude"}},"models":{"default":"@host","fallback":["@host-api"]}}' "$T" > "$OFFLOAD_CONFIG"
out=$(OFFLOAD_MODEL= OFFLOAD_HOST=claude ag ask "no key either"); rc=$?
[ "$rc" != 0 ] && ok "no CLI and no key → fails cleanly (exit $rc)" || bad "no CLI and no key → fails cleanly"
expect_has "the error says the backup has no key yet" "$out" "@host-api: no API key for anthropic yet"
rm -f "$OFFLOAD_CONFIG"
section "offload key (API keys, never shown)"
out=$(printf 'sk-test-abc123\n' | "$OFFLOAD" key anthropic 2>&1); rc=$?
expect_eq "key: stores from stdin" "$rc" 0
expect_eq "key: credentials file is private (600)" "$(stat -c '%a' "$OFFLOAD_CREDENTIALS" 2>/dev/null || stat -f '%Lp' "$OFFLOAD_CREDENTIALS")" "600"
expect_eq "key: stored under the backend name" "$(jq -r .anthropic "$OFFLOAD_CREDENTIALS")" "sk-test-abc123"
expect_has "key: tells which harnesses it backs up" "$out" "backup for claude"
out=$("$OFFLOAD" key 2>&1)
expect_has "key: list shows it as stored" "$out" "anthropic    stored"
expect_not "key: list never prints the key" "$out" "sk-test-abc123"
out=$(OFFLOAD_HOST=claude "$OFFLOAD" model fallback @host-api 2>&1)
expect_not "@host-api: no warning once the key is stored" "$out" "warning"
"$OFFLOAD" key anthropic sk-in-argv </dev/null >/dev/null 2>&1; expect_eq "key: refuses a key in argv (shell history)" "$?" 2
printf '\n' | "$OFFLOAD" key anthropic >/dev/null 2>&1; expect_eq "key: refuses an empty key" "$?" 2
"$OFFLOAD" key nope </dev/null >/dev/null 2>&1; expect_eq "key: unknown backend → exit 2" "$?" 2
out=$("$OFFLOAD" key anthropic --remove 2>&1)
expect_eq "key --remove deletes it" "$(jq -r '.anthropic // "gone"' "$OFFLOAD_CREDENTIALS")" "gone"
rm -f "$OFFLOAD_CREDENTIALS" "$OFFLOAD_CONFIG"

# ------------------------------------------------------------ http connector
section "http connector (mock OpenAI-compatible endpoint)"
HAVE_TS=false
{ [ -n "${OFFLOAD_TS_CLI:-}" ] || [ -f "$PLUGIN/dist/cli.js" ] || [ -f "$PLUGIN/../../packages/cli/dist/cli.js" ] || command -v harness-offload >/dev/null 2>&1; } && HAVE_TS=true
if command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  HPORT=$(( 20000 + $$ % 20000 ))
  MOCK_PORT=$HPORT MOCK_LOG="$T/http-mock.log" python3 "$HERE/mock_openai.py" > "$T/http-mock.out" 2>&1 &
  HPID=$!
  # up to ~15 s: python3 can take seconds to start on a cold macOS runner
  i=0; while [ $i -lt 50 ]; do curl -s --noproxy '*' -m 1 "http://127.0.0.1:$HPORT/v1/models" >/dev/null 2>&1 && break; sleep 0.3; i=$((i + 1)); done
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
  jq --arg u "http://127.0.0.1:$HPORT/v1" '.tasks = {hq: {prompt: "HTTPTASK rules here.", model: "mock:echo"}, hx: {prompt: "HTTPEXPLORE rules here.", tools: "read", model: "mock:echo"}}' "$OFFLOAD_CONFIG" > "$T/c.json" && mv "$T/c.json" "$OFFLOAD_CONFIG"
  out=$(OFFLOAD_TS_CLI=false NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" task hq small.txt 2>&1)
  expect_has "http: custom task sends its own instructions" "$out" "SYSTEM_HEAD: HTTPTASK rules here."
  expect_has "http: custom task footer" "$out" "[offload task hq · mock:echo"
  if $HAVE_TS; then
    out=$(NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" task hx 2>&1)
    expect_has "http: explore-type custom task keeps its instructions (via the TS worker)" "$out" "SYSTEM_HEAD: HTTPEXPLORE rules here."
    expect_has "http: explore-type custom task gets read-only tools" "$out" "tools=glob,grep,list_dir,read_file"
  fi
  expect_not "http: secret content never sent" "$(cat "$T/http-mock.log")" "SECRET=abc"
  jq '.host_api_models = {claude: "mock:echo"}' "$OFFLOAD_CONFIG" > "$T/c.json" && mv "$T/c.json" "$OFFLOAD_CONFIG"
  out=$(OFFLOAD_HOST=claude NO_PROXY='127.0.0.1,localhost' "$OFFLOAD" ask -m @host-api "backup over http" 2>&1)
  expect_has "http: @host-api reaches the endpoint" "$out" "MOCK-REPLY"
  expect_has "http: @host-api footer names the real model" "$out" "[offload ask · mock:echo"
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
# GitHub Copilot CLI loads this plugin as is (its own field names/outputs)
out=$(printf '%s' "$(jq -nc --arg c "$P" --arg f "$P/big.ts" '{hook_event_name: "PreToolUse", cwd: $c, tool_name: "Read", tool_input: {path: $f}}')" | COPILOT_CLI=1 "$PLUGIN/hooks/pre-read")
expect_eq "copilot: path → large read denied" "$(decision "$out")" "deny"
expect_has "copilot: messages use the absolute CLI path" "$out" "$PLUGIN/bin/offload read -q"
out=$(printf '%s' "$(jq -nc --arg c "$P" --arg f "$P/big.ts" '{cwd: $c, tool_name: "Read", tool_input: {path: $f, view_range: [10, 60]}}')" | COPILOT_CLI=1 "$PLUGIN/hooks/pre-read")
expect_eq "copilot: a view_range slice passes" "$(decision "$out")" "none"
out=$(printf '%s' "$(jq -nc --arg c "$P" --arg o "$(seq 1 900)" '{cwd: $c, tool_name: "Bash", tool_input: {command: "seq 1 900"}, tool_result: {result_type: "success", text_result_for_llm: $o}}')" | COPILOT_CLI=1 OFFLOAD_NO_MODEL=1 "$PLUGIN/hooks/post-bash")
expect_has "copilot: long output replaced via modifiedResult" "$(printf '%s' "$out" | jq -r '.modifiedResult.textResultForLlm // empty')" "[offload] \`seq 1 900\`"
out=$(printf '%s' "$(jq -nc --arg c "$P" '{cwd: $c, source: "startup"}')" | COPILOT_CLI=1 "$PLUGIN/hooks/session-start")
expect_has "copilot: session guide as top-level additionalContext" "$(printf '%s' "$out" | jq -r '.additionalContext // empty')" "offload is installed"
# Qwen Code converts the plugin: 0-based offsets, no output replacement
out=$(printf '%s' "$(jq -nc --arg c "$P" --arg f "$P/big.ts" '{cwd: $c, tool_name: "read_file", tool_input: {file_path: $f}}')" | QWEN_CODE_SESSION_ID=x "$PLUGIN/hooks/pre-read")
expect_eq "qwen: large read_file denied" "$(decision "$out")" "deny"
out=$(printf '%s' "$(jq -nc --arg c "$P" --arg o "$(seq 1 900)" '{cwd: $c, tool_name: "run_shell_command", tool_input: {command: "seq 1 900"}, tool_response: {llmContent: $o}}')" | QWEN_CODE_SESSION_ID=x "$PLUGIN/hooks/post-bash")
expect_eq "qwen: no output replacement attempted" "$out" ""
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
# opt-in: a nearly full context halves the read limit (usage from the transcript)
seq 1 400 | sed 's/^/const v = 1; \/\/ line /' > mid.ts; seq 1 200 > small200.ts
printf '{"type":"user","message":{"content":"hi"}}\n{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":1000,"cache_read_input_tokens":149000,"output_tokens":9}}}\n' > "$T/full.jsonl"
printf '{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_creation_input_tokens":1000,"cache_read_input_tokens":40000,"output_tokens":9}}}\n' > "$T/room.jsonl"
ctx_read() { hook pre-read "$(jq -nc --arg c "$P" --arg f "$1" --arg t "$2" '{cwd: $c, transcript_path: $t, tool_name: "Read", tool_input: {file_path: $f}}')"; }
expect_eq "context-aware: off by default (400-line read passes)" "$(decision "$(ctx_read mid.ts "$T/full.jsonl")")" none
printf '{"hooks":{"context_tight_tokens":100000}}' > "$OFFLOAD_CONFIG"
r=$(ctx_read mid.ts "$T/full.jsonl")
expect_eq "context-aware: nearly full context → the 400-line read is held back" "$(decision "$r")" deny
expect_has "context-aware: … and says why" "$r" "nearly full: ~150,005 tokens in use"
expect_eq "context-aware: plenty of room → it passes" "$(decision "$(ctx_read mid.ts "$T/room.jsonl")")" none
expect_eq "context-aware: no transcript → it passes" "$(decision "$(ctx_read mid.ts "$T/none.jsonl")")" none
expect_eq "context-aware: files under half the limit never look" "$(decision "$(ctx_read small200.ts "$T/full.jsonl")")" none
if [ -n "${NODE_OK:-}" ] || command -v node >/dev/null 2>&1; then
  ts_ctx() { printf '%s' "$(jq -nc --arg c "$P" --arg f "$1" --arg t "$2" '{cwd: $c, transcript_path: $t, tool_name: "Read", tool_input: {file_path: $f}}')" | "$PLUGIN/bin/offload-ts" hook claude pre-read 2>/dev/null; }
  r=$(ts_ctx mid.ts "$T/full.jsonl")
  expect_eq "context-aware (TS hooks): nearly full → held back" "$(decision "$r")" deny
  expect_has "context-aware (TS hooks): … same reason" "$r" "nearly full: ~150,005 tokens in use"
  expect_eq "context-aware (TS hooks): plenty of room → passes" "$(decision "$(ts_ctx mid.ts "$T/room.jsonl")")" none
fi
rm -f "$OFFLOAD_CONFIG"
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
# hooks.digest_timeout_seconds 0: instant digest, the worker is never called
: > "$T/stub.log"
printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
d=$(STUB_LOG="$T/stub.log" STUB_ANSWER="STATUS: from model" post "make build" "$big_out" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
rm -f "$OFFLOAD_CONFIG"
expect_has "post-bash: digest_timeout_seconds 0 still digests" "$d" "src/x.ts:4:2"
expect_not "post-bash: digest_timeout_seconds 0 skips the model" "$d" "STATUS: from model"
expect_eq "post-bash: digest_timeout_seconds 0 never starts the worker" "$(wc -l < "$T/stub.log" | tr -d ' ')" 0
# the line count is the output's own: a final newline is not one more line
printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
d=$(post "make build" "$(seq 1 900)
" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
expect_has "post-bash: a final newline is not counted as a line" "$d" "→ exit 0 · 900 lines"
# the same command digested twice at once (parallel agents) keeps two logs
post "make build" "$big_out" > "$T/pb1" & post "make build" "$big_out" > "$T/pb2" & wait
rm -f "$OFFLOAD_CONFIG"
l1=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout' "$T/pb1" | sed -n 's/.*full log: \([^ ]*\.log\).*/\1/p' | head -1)
l2=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout' "$T/pb2" | sed -n 's/.*full log: \([^ ]*\.log\).*/\1/p' | head -1)
expect_eq "post-bash: two identical commands at once keep separate logs" "$([ -n "$l1" ] && [ -f "$l1" ] && [ -f "$l2" ] && [ "$l1" != "$l2" ] && echo separate || echo "same: $l1 $l2")" separate
expect_eq "post-bash: viewer commands untouched (cat)" "$(post "cat build.log" "$big_out")" ""
# a huge search gets the search view: counts per file, first matches, the full log
search_out=$(awk 'BEGIN { for (i = 1; i <= 400; i++) printf "src/f%d.ts:%d:  const unit%d = load()\n", i % 7, i, i; for (i = 1; i <= 30; i++) printf "lib/rare.ts:%d:  rare%d\n", i, i }')
d=$(post "rg -n unit src lib" "$search_out" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
expect_has "post-bash: huge search → search view header" "$d" "· 430 matches in 8 files · full log:"
expect_has "post-bash: search view counts per file, busiest first" "$(printf '%s' "$d" | sed -n 3p)" "     58  src/f1.ts"
expect_has "post-bash: search view shows first matches verbatim" "$d" "src/f1.ts:1:  const unit1 = load()"
expect_has "post-bash: search view says how to narrow it" "$d" "── narrow it:"
lg=$(printf '%s' "$d" | sed -n '1s/.*full log: //p')
expect_eq "post-bash: search view keeps every line in the log" "$(awk 'END { print NR }' "$lg")" 430
expect_has "post-bash: search view is recorded as a digest (source search)" "$(tail -n 1 "$OFFLOAD_STATE_DIR/stats.jsonl")" '"source":"search"'
expect_eq "post-bash: small search untouched" "$(post "rg -n unit src" "$(printf '%s\n' "$search_out" | head -20)")" ""
expect_eq "post-bash: search piped to head untouched" "$(post "rg -n unit src | head -700" "$search_out")" ""
d=$(post "find . -name '*.ts'" "$(awk 'BEGIN { for (i = 1; i <= 300; i++) printf "./pkg%d/src/file%d.ts\n", i % 3, i }')" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
expect_has "post-bash: huge path list → per-folder view" "$d" "· 300 paths in 3 folders"
d=$(post "grep -n unit build.log" "$big_out" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
expect_has "post-bash: single-file grep → first and last lines" "$d" "── first 40 lines ──"
expect_has "post-bash: … with its last lines" "$d" "warning: deprecated api in src/x.ts:4:2"
printf '{"hooks":{"search_view":false}}' > "$OFFLOAD_CONFIG"
expect_eq "post-bash: hooks.search_view false leaves searches alone" "$(post "rg -n unit src lib" "$search_out")" ""
rm -f "$OFFLOAD_CONFIG"
# offload explain: what the hooks did, why, how to change it
SAVED_STATE=$OFFLOAD_STATE_DIR; export OFFLOAD_STATE_DIR="$T/state-explain"
expect_has "explain: nothing yet" "$("$OFFLOAD" explain)" "Nothing yet"
pre_read '{"file_path":"big.ts"}' >/dev/null
post "rg -n unit src lib" "$search_out" >/dev/null
out=$("$OFFLOAD" explain)
expect_has "explain: newest first, with a count" "$out" "newest first (2 of 2)"
expect_has "explain: a blocked Read names the file and size" "$out" "blocked a full Read of big.ts ("
expect_has "explain: … the rule with its current value" "$out" "why: over hooks.read_threshold_lines (600)"
expect_has "explain: … and how to turn it off" "$out" "off: offload config set hooks.read_guard off"
expect_has "explain: a search view points at the full log" "$out" "all of it: $OFFLOAD_STATE_DIR/logs/"
expect_eq "explain N limits the list" "$("$OFFLOAD" explain 1 | grep -c '^  [0-9]')" 1
export OFFLOAD_STATE_DIR=$SAVED_STATE
# the same output again in one session: one line instead of a second digest
posts() { hook post-bash "$(jq -nc --arg c "$P" --arg s "$1" --arg k "$2" --arg o "$3" '{session_id: $s, cwd: $c, tool_name: "Bash", tool_input: {command: $k}, tool_response: {stdout: $o, stderr: ""}}')" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout // ""'; }
printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
d1=$(posts sess-A "make test" "$big_out"); d2=$(posts sess-A "make test" "$big_out")
expect_has "post-bash: first run of an output gets the digest" "$d1" "── key lines"
expect_has "post-bash: the same output again in the session is one line" "$d2" "same output as at"
expect_eq "post-bash: … and only one line" "$(printf '%s\n' "$d2" | wc -l | tr -d ' ')" 1
expect_has "post-bash: … pointing at the first run's log" "$d2" "full log: $(printf '%s' "$d1" | sed -n '1s/.*full log: //p')"
expect_has "post-bash: … recorded as a repeat" "$(tail -n 1 "$OFFLOAD_STATE_DIR/stats.jsonl")" '"source":"repeat"'
expect_has "post-bash: another session gets the full digest" "$(posts sess-B "make test" "$big_out")" "── key lines"
expect_has "post-bash: changed output gets the full digest" "$(posts sess-A "make test" "$big_out
one more line")" "── key lines"
expect_has "post-bash: a repeated search is one line too" "$(posts sess-A "rg -n unit src lib" "$search_out" >/dev/null; posts sess-A "rg -n unit src lib" "$search_out")" "same output as at"
# a changed re-run of the same command: only the key lines that are new since, and what is gone
r1=$(awk 'BEGIN { for (i = 1; i <= 300; i++) printf "ok %d (%dms)\n", i, i % 7; print "FAIL cart works"; print "FAIL ledger works" }')
r2=$(awk 'BEGIN { for (i = 1; i <= 300; i++) printf "ok %d (%dms)\n", i, i % 5; print "FAIL cart works"; print "FAIL shipping works" }')
posts sess-R "npm test" "$r1" >/dev/null; d=$(posts sess-R "npm test" "$r2")
expect_has "post-bash: a changed re-run says what is new, unchanged and gone" "$d" ": 1 new, 1 unchanged, 1 gone ──"
expect_has "post-bash: … shows the new failure" "$d" "FAIL shipping works"
expect_has "post-bash: … and the fixed one" "$d" "  - FAIL ledger works"
expect_not "post-bash: … not the unchanged one again" "$(printf '%s' "$d" | sed -n '/key lines since/,/gone since/p')" "FAIL cart works"
expect_has "post-bash: another command in the session gets a normal digest" "$(posts sess-R "npm run build" "$r2
build step")" "── key lines, verbatim"
hook session-start "$(jq -nc --arg c "$P" '{session_id: "sess-A", cwd: $c, source: "compact"}')" >/dev/null
expect_has "post-bash: after a compaction the digest is shown again" "$(posts sess-A "make test" "$big_out")" "── key lines"
expect_has "post-bash: without a session id nothing is deduplicated" "$(post "make test" "$big_out" >/dev/null; post "make test" "$big_out" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')" "── key lines"
rm -f "$OFFLOAD_CONFIG"
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
expect_not "session-start: no task line without tasks" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.additionalContext')" "own tasks"
printf '{"tasks":{"review-sql":{"description":"Find N+1\\nqueries","prompt":"p"},"Bad Name":{"prompt":"p"}}}' > "$OFFLOAD_CONFIG"
g=$(hook session-start '{"source":"startup"}' | jq -r '.hookSpecificOutput.additionalContext')
expect_has "session-start: lists the user's own tasks" "$g" "task NAME [PATH...] — the user's own tasks: review-sql (Find N+1 queries)."
expect_not "session-start: skips invalid task names" "$g" "Bad Name"
if $HAVE_TS_NODE; then
  g=$(printf '{"source":"startup"}' | node "$PLUGIN/dist/cli.js" hook codex session-start 2>/dev/null)
  expect_has "session-start (TS engine): lists the user's own tasks" "$g" "the user's own tasks: review-sql (Find N+1 queries)."
  # the hook bundle the launcher uses (dist/hook.cjs) answers the same
  g=$(printf '{"source":"startup"}' | "$PLUGIN/bin/offload-ts" hook codex session-start 2>/dev/null)
  expect_has "session-start (TS hook bundle via offload-ts): lists the user's own tasks" "$g" "the user's own tasks: review-sql (Find N+1 queries)."
fi
rm -f "$OFFLOAD_CONFIG"
if $HAVE_TS_NODE && [ -f "$PLUGIN/dist/hook.cjs" ]; then
  ts_hook() { printf '%s' "$2" | "$PLUGIN/bin/offload-ts" hook claude "$1" 2>/dev/null; }
  big_read=$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Read", tool_input: {file_path: "big.ts"}}')
  expect_eq "pre-read (TS hook bundle): big file denied" "$(decision "$(ts_hook pre-read "$big_read")")" deny
  printf 'one\ntwo\n' > small.txt
  expect_eq "pre-read (TS hook bundle): small file passes" "$(ts_hook pre-read "$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Read", tool_input: {file_path: "small.txt"}}')"; echo "rc=$?")" "rc=0"
  # switched off, the launcher answers without starting Node at all
  mkdir -p "$T/fakenode" && printf '#!/bin/sh\ntouch "%s/node-ran"\n' "$T" > "$T/fakenode/node" && chmod +x "$T/fakenode/node"
  out=$(printf '%s' "$big_read" | OFFLOAD_DISABLE=1 PATH="$T/fakenode:$PATH" "$PLUGIN/bin/offload-ts" hook claude pre-read; echo "rc=$?")
  expect_eq "pre-read (TS hook bundle): OFFLOAD_DISABLE=1 says nothing" "$out" "rc=0"
  expect_eq "pre-read (TS hook bundle): OFFLOAD_DISABLE=1 starts no Node" "$([ -e "$T/node-ran" ] && echo ran || echo no)" no
  printf '%s' "$big_read" | PATH="$T/fakenode:$PATH" "$PLUGIN/bin/offload-ts" hook claude pre-read >/dev/null 2>&1
  expect_eq "pre-read (TS hook bundle): enabled, the launcher does start Node" "$([ -e "$T/node-ran" ] && echo ran || echo no)" ran
  expect_has "post-bash (TS hook bundle): long output digested" "$(ts_hook post-bash "$(jq -nc --arg c "$P" --rawfile o big.log '{cwd: $c, tool_name: "Bash", tool_input: {command: "make", description: "Build"}, tool_response: {stdout: $o, stderr: ""}}')")" "updatedToolOutput"
  : > "$T/stub.log"
  printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
  d=$(STUB_LOG="$T/stub.log" ts_hook post-bash "$(jq -nc --arg c "$P" --rawfile o big.log '{cwd: $c, tool_name: "Bash", tool_input: {command: "make", description: "Build"}, tool_response: {stdout: $o, stderr: ""}}')")
  rm -f "$OFFLOAD_CONFIG"
  expect_has "post-bash (TS hook bundle): digest_timeout_seconds 0 still digests" "$d" "updatedToolOutput"
  expect_eq "post-bash (TS hook bundle): digest_timeout_seconds 0 never starts the worker" "$(wc -l < "$T/stub.log" | tr -d ' ')" 0
  printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
  d=$(ts_hook post-bash "$(jq -nc --arg c "$P" --arg o "$(seq 1 900)
" '{cwd: $c, tool_name: "Bash", tool_input: {command: "make"}, tool_response: {stdout: $o, stderr: ""}}')" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
  rm -f "$OFFLOAD_CONFIG"
  expect_has "post-bash (TS hook bundle): a final newline is not counted as a line" "$d" "→ exit 0 · 900 lines"
  # hooks.autowrap works in the TypeScript hooks too
  echo '{"hooks":{"autowrap":true}}' > "$OFFLOAD_CONFIG"
  r=$(OFFLOAD_CLI_COMMAND=offload ts_hook pre-bash "$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Bash", tool_input: {command: "npm test", description: "Run tests"}}')")
  expect_eq "pre-bash (TS hook bundle): autowrap rewrites a noisy command" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedInput.command')" "offload run -c 'npm test'"
  expect_eq "pre-bash (TS hook bundle): … keeping the other input fields" "$(printf '%s' "$r" | jq -r '.hookSpecificOutput.updatedInput.description')" "Run tests"
  expect_eq "pre-bash (TS hook bundle): autowrap ignores other commands" "$(ts_hook pre-bash "$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Bash", tool_input: {command: "ls -la"}}')")" ""
  expect_eq "pre-bash (TS hook bundle): autowrap leaves background commands alone" "$(ts_hook pre-bash "$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Bash", tool_input: {command: "npm test", run_in_background: true}}')")" ""
  rm -f "$OFFLOAD_CONFIG"
  expect_eq "pre-bash (TS hook bundle): autowrap is off by default" "$(ts_hook pre-bash "$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Bash", tool_input: {command: "npm test"}}')")" ""
  printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
  j=$(jq -nc --arg c "$P" --rawfile o big.log '{session_id: "ts-sess", cwd: $c, tool_name: "Bash", tool_input: {command: "make"}, tool_response: {stdout: $o, stderr: ""}}')
  ts_hook post-bash "$j" >/dev/null
  expect_has "post-bash (TS hook bundle): the same output again is one line" "$(ts_hook post-bash "$j" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')" "same output as at"
  ts_hook session-start "$(jq -nc --arg c "$P" '{session_id: "ts-sess", cwd: $c, source: "clear"}')" >/dev/null
  expect_has "post-bash (TS hook bundle): after /clear the digest is shown again" "$(ts_hook post-bash "$j" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')" "── "
  ts_hook session-start "$(jq -nc --arg c "$P" '{session_id: "ts-sess", cwd: $c, source: "clear"}')" >/dev/null
  first=$(printf '%s' "$j" | "$PLUGIN/hooks/post-bash" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')
  expect_has "post-bash: (bash hook writes the marker on a fresh session)" "$first" "── "
  expect_has "post-bash: a bash marker is honoured by the TS hook (shared format)" "$(ts_hook post-bash "$j" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')" "same output as at"
  rm -f "$OFFLOAD_CONFIG"
  # every digest fixture reads the same in both engines
  for spec in "$PLUGIN/../../evals/digest-fixtures"/*.txt; do
    name=$(basename "$spec" .txt); awk -f "$PLUGIN/../../evals/digest-fixtures/expand.awk" "$spec" > "$T/pf-$name.log"
    vb=$("$PLUGIN/bin/offload" summarize --no-model "$T/pf-$name.log" 2>&1 | sed 's#/[^ ]*/logs/[^ ]*\.log#LOG#g')
    vt=$("$PLUGIN/bin/offload-ts" summarize --no-model "$T/pf-$name.log" 2>&1 | sed 's#/[^ ]*/logs/[^ ]*\.log#LOG#g')
    expect_eq "digest: bash and TS give the same text ($name)" "$vt" "$vb"
  done
  # the search view and the digest read the same in both engines
  for k in "rg -n unit src lib" "make"; do
    j=$(jq -nc --arg c "$P" --arg k "$k" --arg o "$(awk 'BEGIN { for (i = 1; i <= 400; i++) printf "src/f%d.ts:%d: unit %d failed\n", i % 7, i, i }')" '{cwd: $c, tool_name: "Bash", tool_input: {command: $k}, tool_response: {stdout: $o, stderr: ""}}')
    vb=$(printf '%s' "$j" | OFFLOAD_NO_MODEL=1 "$PLUGIN/hooks/post-bash" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout' | sed 's#/[^ ]*/logs/[^ ]*\.log#LOG#g')
    vt=$(OFFLOAD_NO_MODEL=1 ts_hook post-bash "$j" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout' | sed 's#/[^ ]*/logs/[^ ]*\.log#LOG#g')
    expect_eq "post-bash: bash and TS hooks give the same text ($k)" "$vt" "$vb"
  done
  printf '{"hooks":{"digest_timeout_seconds":0}}' > "$OFFLOAD_CONFIG"
  j=$(jq -nc --arg c "$P" --rawfile o big.log '{cwd: $c, tool_name: "Bash", tool_input: {command: "make"}, tool_response: {stdout: $o, stderr: ""}}')
  ts_hook post-bash "$j" > "$T/tb1" & ts_hook post-bash "$j" > "$T/tb2" & wait
  rm -f "$OFFLOAD_CONFIG"
  l1=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout' "$T/tb1" | sed -n 's/.*full log: \([^ ]*\.log\).*/\1/p' | head -1)
  l2=$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout' "$T/tb2" | sed -n 's/.*full log: \([^ ]*\.log\).*/\1/p' | head -1)
  expect_eq "post-bash (TS hook bundle): two identical commands at once keep separate logs" "$([ -n "$l1" ] && [ -f "$l1" ] && [ -f "$l2" ] && [ "$l1" != "$l2" ] && echo separate || echo "same: $l1 $l2")" separate
fi
# hostile or broken hook input: every hook, both engines, fails open (exit 0, nothing or valid JSON) and fast
mkdir -p "$T/fz"; n=0
while IFS= read -r inp; do n=$((n + 1)); printf '%s' "$inp" > "$T/fz/$n.json"; done <<'EOF_FZ'

{
null
[]
"str"
42
{"tool_input":null}
{"tool_input":{"file_path":123}}
{"tool_name":"Read","tool_input":{"file_path":["a"]}}
{"tool_name":"Bash","tool_input":{"command":{"x":1}}}
{"tool_name":"Bash","tool_input":{"command":"cat a\u0000b"},"tool_response":{"stdout":"x\u0000y"}}
{"tool_name":"Read","tool_input":{"file_path":"/dev/zero"}}
{"tool_name":"Read","tool_input":{"file_path":"../../../../etc/shadow"}}
{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"stdout":12}}
{"transcript_path":"/dev/zero","tool_name":"Read","tool_input":{"file_path":"big.ts"}}
EOF_FZ
# a 4 MB input (2 MB command, 2 MB output)
head -c 2000000 /dev/zero | LC_ALL=C tr '\0' 'a' > "$T/fz-a"
jq -nc --rawfile a "$T/fz-a" '{tool_name: "Bash", tool_input: {command: $a}, tool_response: {stdout: $a}}' > "$T/fz/big.json"
for h in pre-read pre-bash post-bash session-start; do
  for eng in bash ts; do
    for f in "$T"/fz/*.json; do
      s0=$(date +%s)
      if [ "$eng" = ts ]; then o=$("$PLUGIN/bin/offload-ts" hook claude "$h" < "$f" 2>/dev/null); rc=$?
      else o=$("$PLUGIN/hooks/$h" < "$f" 2>/dev/null); rc=$?; fi
      el=$(( $(date +%s) - s0 ))
      if [ "$rc" != 0 ] || [ "$el" -gt 3 ] || { [ -n "$o" ] && ! printf '%s' "$o" | jq -e . >/dev/null 2>&1; }; then
        echo "$eng $h rc=$rc ${el}s input=$(head -c 60 "$f")"
      fi
    done
  done
done > "$T/fuzz.txt"
if [ -s "$T/fuzz.txt" ]; then bad "hooks fail open on hostile input (both engines)" "$(head -5 "$T/fuzz.txt")"; else ok "hooks fail open on hostile input (both engines)"; fi
# config cache: an edit applies on the very next hook, even within the same second
big_read=$(jq -nc --arg c "$P" '{cwd: $c, tool_name: "Read", tool_input: {file_path: "big.ts"}}')
printf '{"hooks":{"read_threshold_lines":100000,"read_threshold_tokens":1000000}}' > "$OFFLOAD_CONFIG"
expect_eq "config cache: raised threshold lets the big read pass" "$(decision "$(hook pre-read "$big_read")")" none
printf '{"hooks":{"read_threshold_lines":100}}' > "$OFFLOAD_CONFIG"
expect_eq "config cache: the next edit applies at once" "$(decision "$(hook pre-read "$big_read")")" deny
# the on-disk cache is the bash engine's (it saves a jq run per hook); the TS engine parses in-process
if [ "$OFFLOAD" = "$PLUGIN/bin/offload" ]; then
  cfile=$(ls "$OFFLOAD_STATE_DIR"/cache/config* 2>/dev/null | head -1)
  expect_eq "config cache: file is private (0600)" "$( [ -n "$cfile" ] && ls -l "$cfile" | cut -c1-10)" "-rw-------"
fi
printf '{"hooks": ' > "$OFFLOAD_CONFIG"
expect_has "config cache: a broken config is still reported" "$(hook pre-read "$big_read" 2>&1 >/dev/null)" "ignoring invalid JSON config"
rm -f "$OFFLOAD_CONFIG"
# first session after install: one line for the user, once, in plain words
W="$T/welcome-state"
w1=$(OFFLOAD_STATE_DIR="$W" hook session-start '{"source":"startup"}' | jq -r '.systemMessage // ""')
w2=$(OFFLOAD_STATE_DIR="$W" hook session-start '{"source":"startup"}' | jq -r '.systemMessage // ""')
expect_has "session-start: first session tells the user who does the work" "$w1" "Harness Offload is on: huge file reads and long command output now go to stub/ok via OpenCode"
expect_eq "session-start: the welcome line is shown once" "$w2" ""
expect_has "session-start: default worker in plain words (Claude plan)" "$(PATH="$AB:$PATH" OFFLOAD_MODEL= OFFLOAD_STATE_DIR="$T/welcome-host" hook session-start '{"source":"startup"}' | jq -r '.systemMessage // ""')" "go to Haiku on your Claude plan instead"
if $HAVE_TS_NODE && [ -f "$PLUGIN/dist/hook.cjs" ]; then
  wt=$(printf '{"source":"startup"}' | OFFLOAD_STATE_DIR="$T/welcome-ts" "$PLUGIN/bin/offload-ts" hook claude session-start 2>/dev/null | jq -r '.systemMessage // ""')
  expect_eq "session-start (TS engine): same welcome line as bash" "$wt" "$w1"
  # OFFLOAD_ENGINE=ts: the plugin's own hooks and CLI hand over to the TypeScript engine
  printf '#!/bin/sh\nprintf "%%s " "$@" > "%s/ts-called"\n' "$T" > "$T/fake-ts" && chmod +x "$T/fake-ts"
  printf '{}' | OFFLOAD_ENGINE=ts OFFLOAD_TS_CLI="$T/fake-ts" "$PLUGIN/hooks/pre-read" >/dev/null 2>&1
  expect_eq "OFFLOAD_ENGINE=ts: the Read hook is answered by the TypeScript engine" "$(cat "$T/ts-called" 2>/dev/null)" "hook claude pre-read "
  OFFLOAD_ENGINE=ts OFFLOAD_TS_CLI="$T/fake-ts" "$PLUGIN/bin/offload" doctor >/dev/null 2>&1
  expect_eq "OFFLOAD_ENGINE=ts: so is the offload command" "$(cat "$T/ts-called" 2>/dev/null)" "doctor "
  rm -f "$T/ts-called"
  printf '{}' | OFFLOAD_ENGINE=ts COPILOT_CLI=1 OFFLOAD_TS_CLI="$T/fake-ts" "$PLUGIN/hooks/pre-read" >/dev/null 2>&1
  expect_eq "OFFLOAD_ENGINE=ts: Copilot keeps the bash hooks (its dialect)" "$([ -e "$T/ts-called" ] && echo ts || echo bash)" bash
fi
r=$(OFFLOAD_OPENCODE_BIN=/nonexistent hook session-start '{"source":"startup"}')
expect_has "session-start: tells the user when offload is paused" "$(printf '%s' "$r" | jq -r '.systemMessage')" "Harness Offload is paused"

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
