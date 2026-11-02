# shellcheck shell=bash
# offload — shared plumbing for hook scripts.
#
# Hooks must never wedge Claude: every failure path exits 0 with no output,
# which Claude Code treats as "no opinion" and runs the tool normally.

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
HK_CWD="" HK_AGENT_ID="" HK_SOURCE="" HK_FILE="" HK_OFFSET="" HK_LIMIT="" HK_COMMAND="" HK_DESCRIPTION=""
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

# The standard "too big for your context" message with options and outline.
hk_big_file_message() {
  local file="$1" lines="$2" tokens="$3" how="$4" chunk outline q
  chunk=$(co_cfg_int '.hooks.read_max_chunk_lines' 600)
  q=$(co_shquote "$file")
  outline=$(co_outline "$file" 40)
  cat <<EOF
offload: $how would put all of $file into your context ($(co_fmt_int "$lines") lines, ~$(co_fmt_int "$tokens") tokens; limit $(co_cfg '.hooks.read_threshold_lines') lines / $(co_fmt_int "$(co_cfg '.hooks.read_threshold_tokens')") tokens).
Pick the cheapest option:
- Need exact text (to edit/quote)? Read with offset/limit (max $chunk lines per call) — outline below; \`grep -n PATTERN $q\` finds more.
- Need understanding/facts? Bash: $HK_CLI read -q "<specific question>" $q
  A cheap model answers with $file:Lx-Ly citations whose quotes are checked; then Read only those lines if you must edit.
- Question spans many files? Bash: $HK_CLI explore "<question>"
EOF
  if [ -n "$outline" ]; then
    printf 'Outline of %s:\n%s\n' "$file" "$outline"
  fi
}
