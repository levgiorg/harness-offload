# shellcheck shell=bash
# offload — shared plumbing for hook scripts.
#
# Hooks must never wedge Claude: every failure path exits 0 with no output,
# which Claude Code treats as "no opinion" and runs the tool normally.

# OFFLOAD_ENGINE=ts: the TypeScript engine answers this hook instead — to compare
# the two engines inside Claude Code with one plugin (installs never set it).
# Copilot and Qwen dialects are spoken by the bash hooks only.
if [ "${OFFLOAD_ENGINE:-}" = ts ] && [ "${COPILOT_CLI:-}" != 1 ] && [ -z "${QWEN_CODE_SESSION_ID:-}${QWEN_PROJECT_DIR:-}" ]; then
  case "$0" in
    */*) exec "${0%/*}/../bin/offload-ts" hook claude "${0##*/}" ;;
    *) exec ../bin/offload-ts hook claude "$0" ;;
  esac
fi

command -v jq >/dev/null 2>&1 || exit 0

# Several harnesses run this Claude-format plugin: GitHub Copilot CLI loads it
# as is, Qwen Code converts it. Same events, slightly different dialects.
if [ "${COPILOT_CLI:-}" = 1 ]; then HK_DIALECT=copilot
elif [ -n "${QWEN_CODE_SESSION_ID:-}${QWEN_PROJECT_DIR:-}" ]; then HK_DIALECT=qwen
else HK_DIALECT=claude
fi
# @host models resolve to the harness that runs this hook
export OFFLOAD_HOST="${OFFLOAD_HOST:-$HK_DIALECT}"
HK_INPUT=$(cat)
[ -z "$HK_INPUT" ] && exit 0
# Switched off for this run: nothing to decide, so no config to load.
case "${OFFLOAD_DISABLE:-}" in 1|true) exit 0 ;; esac
# Normalise to Claude's field names (Copilot: path/view_range, toolArgs,
# tool_result; Qwen: 0-based offsets).
case "$HK_DIALECT" in
  copilot)
    HK_INPUT=$(printf '%s' "$HK_INPUT" | jq -c '
      .tool_name = (.tool_name // .toolName // "")
      | .tool_input = ((.tool_input // .toolArgs // {}) | if type == "object" then . else {} end
          | if (.file_path == null and .path != null) then .file_path = .path else . end
          | if (.view_range | type) == "array" and (.view_range | length) == 2 then
              .offset = .view_range[0]
              | .limit = (if .view_range[1] == -1 then null else (.view_range[1] - .view_range[0] + 1) end)
            else . end)
      | .tool_response = (.tool_response // (if (.tool_result // .toolResult) then
          {stdout: (.tool_result.text_result_for_llm // .toolResult.textResultForLlm // "")} else null end))' 2>/dev/null) || exit 0 ;;
  qwen)
    HK_INPUT=$(printf '%s' "$HK_INPUT" | jq -c 'if (.tool_input.offset | type) == "number" then .tool_input.offset += 1 else . end' 2>/dev/null) || exit 0 ;;
esac
# Debug aid: OFFLOAD_DEBUG_DIR=/some/dir keeps every hook input there.
if [ -n "${OFFLOAD_DEBUG_DIR:-}" ]; then
  mkdir -p "$OFFLOAD_DEBUG_DIR" 2>/dev/null &&
    printf '%s' "$HK_INPUT" > "$OFFLOAD_DEBUG_DIR/$(basename "$0")-$(date +%s)-$$.json"
fi

CO_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$CO_ROOT" ]; then
  case "$0" in */*) CO_ROOT=$(cd "${0%/*}/.." && pwd) ;; *) CO_ROOT=$(cd .. && pwd) ;; esac
fi
# shellcheck source=common.sh
. "$CO_ROOT/lib/common.sh" || exit 0
# (the worker code, lib/opencode.sh + lib/agents.sh, loads on first use:
# co_backends — most tool calls pass without needing it)

hk_get() { printf '%s' "$HK_INPUT" | jq -r "($1) // empty | tostring" 2>/dev/null; }

# Every field a hook reads, in one jq run (hooks sit in front of every tool
# call, and each jq start costs a few ms). Same rules as hk_get: null and
# false read as empty. HK_OUT_BYTES/HK_OUT_LINES describe the Bash output as
# post-bash would write it to a file (-1: work it out from the file).
HK_FIELDS='
  def s: if . == null or . == false then "" else tostring end;
  def g(f): (try f catch null) | s;
  (try ((.tool_response.stdout // "") as $o | (.tool_response.stderr // "") as $e
    | (if ($e | length) > 0 then $o + (if ($o | length) > 0 then "\n" else "" end) + "[stderr]\n" + $e else $o end) + "\n"
    | [utf8bytelength, (split("\n") | length) - 1]) catch [-1, -1]) as $sz
  | @sh "HK_CWD=\(g(.cwd))",
    @sh "HK_AGENT_ID=\(g(.agent_id))",
    @sh "HK_SESSION=\(g(.session_id))",
    @sh "HK_TRANSCRIPT=\(g(.transcript_path))",
    @sh "HK_SOURCE=\(g(.source))",
    @sh "HK_FILE=\(g(.tool_input.file_path))",
    @sh "HK_OFFSET=\(g(.tool_input.offset))",
    @sh "HK_LIMIT=\(g(.tool_input.limit))",
    @sh "HK_COMMAND=\(g(.tool_input.command))",
    @sh "HK_DESCRIPTION=\(g(.tool_input.description))",
    @sh "HK_BACKGROUND=\(g(.tool_input.run_in_background))",
    @sh "HK_INTERRUPTED=\(g(.tool_response.interrupted))",
    @sh "HK_IS_IMAGE=\(g(.tool_response.isImage))",
    @sh "HK_PERSISTED=\(g(.tool_response.persistedOutputPath))",
    "HK_OUT_BYTES=\($sz[0])", "HK_OUT_LINES=\($sz[1])"'
HK_CWD="" HK_AGENT_ID="" HK_SESSION="" HK_TRANSCRIPT="" HK_SOURCE="" HK_FILE="" HK_OFFSET="" HK_LIMIT="" HK_COMMAND="" HK_DESCRIPTION=""
HK_BACKGROUND="" HK_INTERRUPTED="" HK_IS_IMAGE="" HK_PERSISTED="" HK_OUT_BYTES=-1 HK_OUT_LINES=-1
eval "$(printf '%s' "$HK_INPUT" | jq -r "$HK_FIELDS" 2>/dev/null)"

# How the agent should call the CLI: Claude Code puts the plugin's bin/ on the
# Bash PATH; other harnesses get the absolute path.
if [ "$HK_DIALECT" = claude ]; then HK_CLI=offload; else HK_CLI=$(co_shquote "$CO_ROOT/bin/offload"); fi

# Resolve the tool's cwd so relative paths in commands mean what Claude meant.
[ -n "$HK_CWD" ] && [ -d "$HK_CWD" ] && cd "$HK_CWD" 2>/dev/null
[ -n "$HK_CWD" ] && CO_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$HK_CWD}"
# Load once in this shell; $(co_cfg ...) subshells then reuse CO_CONFIG.
co_config_load

# Inside a subagent? (agent_id is only present there.)
hk_in_subagent() { [ -n "$HK_AGENT_ID" ]; }

hk_skip_subagent() {
  hk_in_subagent && ! co_cfg_bool '.hooks.subagents' true
}

# A hook found something worth acting on (a big read, a long output): may it?
# Checked late on purpose — most tool calls are small and pass before this.
# Tokens in the agent's context at its last turn, from the usage Claude Code records in
# the transcript (input + cache creation + cache read). Fails when it can't tell.
# Twin: contextUsed() in logic.ts.
hk_context_used() {
  local n
  [ -n "$HK_TRANSCRIPT" ] && [ -f "$HK_TRANSCRIPT" ] || return 1
  n=$(tail -c 400000 "$HK_TRANSCRIPT" 2>/dev/null | grep '"usage"' | tail -n 1 |
    jq -r '(.message.usage // .usage) | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))' 2>/dev/null)
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$n"
}

hk_may_act() {
  hk_skip_subagent && return 1
  co_available
}

# One stats line for a hook decision. EXTRA is a flat JSON object of numbers
# and plain words built by the caller (no jq needed for that).
hk_event() {
  local event="$1" extra="${2:-}"
  case "$extra" in
    ''|'{}') extra="" ;;
    '{'*'}') extra=",${extra#\{}"; extra=${extra%\}} ;;
    *) return 0 ;;
  esac
  co_stats_append "{\"ts\":$(co_now),\"kind\":\"hook\",\"event\":\"$event\"$extra}"
}

# --- PreToolUse responses
hk_deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}
hk_ask() {
  # Copilot and headless Qwen cannot ask: advice instead of a block
  [ "$HK_DIALECT" != claude ] && hk_note "$1"
  jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}
# Lets the tool run as usual but adds a note to the agent's context.
hk_note() {
  if [ "$HK_DIALECT" = copilot ]; then
    # Copilot reads additionalContext at the top level only
    jq -nc --arg c "$1" '{additionalContext: $c}'
  else
    jq -nc --arg c "$1" --arg ev "${2:-PreToolUse}" '{hookSpecificOutput: {hookEventName: $ev, additionalContext: $c}}'
  fi
  exit 0
}

# Applies hooks.read_guard (block|ask|suggest|off) to a "this read is too big"
# verdict. The message is written for Claude.
hk_guard() {
  local msg="$1" mode
  mode=$(co_cfg '.hooks.read_guard' 'block')
  case "$mode" in
    off) exit 0 ;;
    ask) hk_ask "$msg" ;;
    suggest) hk_note "offload (advice, not enforced): $msg" ;;
    *) hk_deny "$msg" ;;
  esac
}

# True when the path matches hooks.ignore_globs (full path or basename).
hk_ignored() {
  local p="$1" base pat
  co_base base "$p"
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$p" in $pat) return 0 ;; esac
    # shellcheck disable=SC2254
    case "$base" in $pat) return 0 ;; esac
  done <<EOF
$(co_cfg_list '.hooks.ignore_globs')
EOF
  return 1
}

# Files Claude's Read tool handles natively and that offload cannot help with.
hk_not_for_offload() {
  local ext
  co_lower ext "${1##*.}"
  case "$ext" in
    png|jpg|jpeg|gif|webp|bmp|ico|svgz|pdf|ipynb|zip|gz|tgz|tar|jar|wasm|so|dylib|dll|exe|bin|pyc|class|o|a|mp3|mp4|mov|woff|woff2|ttf|otf) return 0 ;;
  esac
  co_is_text "$1" || return 0
  co_is_secret_target "$1"
}

# The package manager that answers questions about a lockfile (empty: not a lockfile). Twin: lockTool.
hk_lock_tool() {
  case "${1##*/}" in
    package-lock.json|npm-shrinkwrap.json) printf 'npm ls NAME' ;;
    yarn.lock) printf 'yarn why NAME' ;;
    pnpm-lock.yaml) printf 'pnpm why NAME' ;;
    bun.lock) printf 'bun pm ls' ;;
    Cargo.lock) printf 'cargo tree -i NAME' ;;
    poetry.lock) printf 'poetry show NAME' ;;
    uv.lock) printf 'uv tree --package NAME' ;;
    Pipfile.lock) printf 'pipenv graph' ;;
    Gemfile.lock) printf 'bundle info NAME' ;;
    composer.lock) printf 'composer show NAME' ;;
    go.sum) printf 'go mod why -m NAME' ;;
  esac
}

# Top-level structure of a JSON file of at most 16 MB: the value itself, then up to
# 30 members (in JavaScript's order: integer keys first), then a line "@<jq commands>" (for its biggest member). Nothing when it is
# not one JSON value.
# Twin: jsonStructure.
hk_json_structure() {
  local file="$1" bytes="$2" q="$3"
  [ "$bytes" -le 16777216 ] || return 0
  jq -r -n '[inputs] | if length != 1 then empty else .[0] |
    def d: type as $t |
      if $t == "object" then "o\t\(length)"
      elif $t == "array" then "a\t\(length)\t\(map(type) | unique | if length == 1 then .[0] else "mixed" end)"
      else $t end;
    def isidx: (try tonumber catch null) as $n | (startswith("-") | not) and
      $n != null and $n >= 0 and $n < 4294967295 and ($n | floor | tostring) == .;
    (d), (if type == "object" then
      (((to_entries | map(select(.key | isidx)) | sort_by(.key | tonumber))
        + (to_entries | map(select(.key | isidx | not))))[:30][] | "\(.key | tojson)\t\(.value | d)"),
      (if length > 30 then "more\t\(length - 30)" else empty end)
    else empty end) end' "$file" 2>/dev/null | LC_ALL=C awk -F '\t' -v q="$q" -v sq="'" '
    function fmt(n,  s, o) { s = n ""; o = ""; while (length(s) > 3) { o = "," substr(s, length(s) - 2) o; s = substr(s, 1, length(s) - 3) }; return s o }
    function desc(i,  n, t) {
      if ($i == "o") { n = $(i + 1); return "object, " fmt(n) (n == 1 ? " key" : " keys") }
      if ($i == "a") { n = $(i + 1); t = $(i + 2)
        if (n == 0) return "array, empty"
        if (t == "mixed") return "array, " fmt(n) (n == 1 ? " item" : " items") " (mixed)"
        return "array, " fmt(n) " " t (n == 1 ? "" : "s") }
      return $i }
    NR == 1 { top = $1; print "  " desc(1); next }
    $1 == "more" { print "  … " fmt($2) " more keys"; next }
    { print "  " $1 ": " desc(2)
      if (($2 == "a" || $2 == "o") && (key == "" || $3 + 0 > best)) { key = $1; kt = $2; best = $3 + 0 }
      if (first == "") first = $1 }
    END {
      if (NR == 0) exit
      if (top == "a") { print "@jq " sq "length" sq " " q " · jq " sq ".[0]" sq " " q; exit }
      if (top != "o") exit
      h = "jq " sq "keys" sq " " q
      k = (key != "") ? key : first
      p = ""
      if (k ~ /^"[A-Za-z_][A-Za-z0-9_]*"$/) p = "." substr(k, 2, length(k) - 2)
      else if (k != "" && index(k, sq) == 0 && index(k, "\\") == 0) p = ".[" k "]"
      if (p != "" && kt == "a") h = h " · jq " sq p " | length" sq " " q " · jq " sq p "[0]" sq " " q
      else if (p != "" && kt == "o") h = h " · jq " sq p " | keys[0:20]" sq " " q
      else if (p != "") h = h " · jq " sq p sq " " q
      print "@" h
    }'
}

# The standard "too big for your context" message with options and outline.
# Lockfiles, long-line (minified/generated) files and JSON get advice that fits them.
# Twin: bigFileMessage.
hk_big_file_message() {
  local file="$1" lines="$2" tokens="$3" how="$4" chunk outline q bytes avg lock structure="" jqhint=""
  chunk=$(co_cfg_int '.hooks.read_max_chunk_lines' 600)
  q=$(co_shquote "$file")
  bytes=$(wc -c < "$file" 2>/dev/null | tr -d ' '); bytes=${bytes:-0}
  avg=$(( bytes / (lines > 0 ? lines : 1) ))
  lock=$(hk_lock_tool "$file")
  case "$file" in
    *.json|*.JSON)
      structure=$(hk_json_structure "$file" "$bytes" "$q")
      jqhint=$(printf '%s\n' "$structure" | LC_ALL=C sed -n 's/^@//p')
      structure=$(printf '%s\n' "$structure" | LC_ALL=C sed '/^@/d') ;;
  esac
  printf 'offload: %s would put all of %s into your context (%s lines, ~%s tokens; limit %s lines / %s tokens).\n' \
    "$how" "$file" "$(co_fmt_int "$lines")" "$(co_fmt_int "$tokens")" "$(co_cfg '.hooks.read_threshold_lines')" "$(co_fmt_int "$(co_cfg '.hooks.read_threshold_tokens')")"
  [ -n "$lock" ] && printf '%s\n' "It is a lockfile, written by the package manager: \`$lock\` answers \"which version, who needs it\" without reading it."
  [ "$avg" -gt 4000 ] && printf '%s\n' "Its lines average $(co_fmt_int "$avg") characters (minified or generated), so line slices do not help."
  printf 'Pick the cheapest option:\n'
  if [ "$avg" -gt 4000 ]; then
    printf '%s\n' "- Need exact text? Bash: grep -noE '.{0,80}PATTERN.{0,80}' $q shows each match with 80 characters around it."
  else
    printf '%s\n' "- Need exact text (to edit/quote)? Read with offset/limit (max $chunk lines per call) — outline below; \`grep -n PATTERN $q\` finds more."
  fi
  [ -n "$jqhint" ] && printf '%s\n' "- Need values? Bash: $jqhint"
  cat <<EOF
- Need understanding/facts? Bash: $HK_CLI read -q "<specific question>" $q
  A cheap model answers with $file:Lx-Ly citations whose quotes are checked; then Read only those lines if you must edit.
- Question spans many files? Bash: $HK_CLI explore "<question>"
EOF
  [ -n "$structure" ] && printf 'Structure of %s:\n%s\n' "$file" "$structure"
  [ "$avg" -gt 4000 ] && return 0
  # 3 symbols per 100 lines (16…40): about 2 KB per 1,000 lines of file
  local entries=$(( lines * 3 / 100 ))
  [ "$entries" -lt 16 ] && entries=16; [ "$entries" -gt 40 ] && entries=40
  outline=$(co_outline "$file" "$entries")
  if [ -n "$outline" ]; then
    printf 'Outline of %s:\n%s\n' "$file" "$outline"
  fi
}

# A huge JSON output (curl, kubectl -o json, gh api…): its structure and jq
# commands on the log instead of a digest. Prints nothing when the log is not one
# JSON object or array (the usual digest then runs). Twin: jsonView.
hk_json_view() {
  local log="$1" cmd="$2" lines="$3" bytes="$4" q s hint label out t0
  t0=$(co_now)
  q=$(co_shquote "$log")
  s=$(hk_json_structure "$log" "$bytes" "$q")
  hint=$(printf '%s\n' "$s" | LC_ALL=C sed -n 's/^@//p')
  [ -n "$hint" ] || return 0
  s=$(printf '%s\n' "$s" | LC_ALL=C sed '/^@/d')
  label=$(printf '%s' "$cmd" | co_redact)
  out="[offload] \`$(printf '%s' "$label" | LC_ALL=C cut -c1-120)\` · $(co_fmt_int "$lines") lines / $(( (bytes + 1023) / 1024 )) KB of JSON · full log: $log
── structure ──
$s
── query it instead of reading it ──
$hint"
  printf '%s' "$out"
  co_stats_append "$(jq -nc --arg lbl "$label" --arg log "$log" --argjson bin "$bytes" --argjson bout "$(printf '%s' "$out" | wc -c | tr -d ' ')" \
    --argjson secs "$(co_elapsed "$t0")" --argjson ein "$(co_tokens "$log" "$bytes")" \
    --argjson eout "$(printf '%s' "$out" | co_tokens - "$(printf '%s' "$out" | wc -c | tr -d ' ')")" \
    '{ts: now | floor, kind: "digest", source: "json", label: $lbl, log: $log, model: "", bytes_in: $bin, bytes_out: $bout,
      saved_tokens: (($ein - $eout) | if . < 0 then 0 else . end), seconds: $secs, model_ok: false, model_tried: false,
      worker_tokens_in: 0, worker_tokens_out: 0}')"
}
