# shellcheck shell=bash
# offload — shared plumbing for hook scripts.
#
# Hooks must never wedge Claude: every failure path exits 0 with no output,
# which Claude Code treats as "no opinion" and runs the tool normally.

command -v jq >/dev/null 2>&1 || exit 0

# @host models resolve to the harness that runs this hook
export OFFLOAD_HOST="${OFFLOAD_HOST:-claude}"
HK_INPUT=$(cat)
[ -z "$HK_INPUT" ] && exit 0
# Debug aid: OFFLOAD_DEBUG_DIR=/some/dir keeps every hook input there.
if [ -n "${OFFLOAD_DEBUG_DIR:-}" ]; then
  mkdir -p "$OFFLOAD_DEBUG_DIR" 2>/dev/null &&
    printf '%s' "$HK_INPUT" > "$OFFLOAD_DEBUG_DIR/$(basename "$0")-$(date +%s)-$$.json"
fi

CO_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
# shellcheck source=common.sh
. "$CO_ROOT/lib/common.sh" || exit 0
# shellcheck source=opencode.sh
. "$CO_ROOT/lib/opencode.sh" || exit 0

hk_get() { printf '%s' "$HK_INPUT" | jq -r "($1) // empty | tostring" 2>/dev/null; }

# Resolve the tool's cwd so relative paths in commands mean what Claude meant.
HK_CWD=$(hk_get '.cwd')
[ -n "$HK_CWD" ] && [ -d "$HK_CWD" ] && cd "$HK_CWD" 2>/dev/null
[ -n "$HK_CWD" ] && CO_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$HK_CWD}"
# Load once in this shell; $(co_cfg ...) subshells then reuse CO_CONFIG.
co_config_load

# Inside a subagent? (agent_id is only present there.)
hk_in_subagent() { [ -n "$(hk_get '.agent_id')" ]; }

hk_skip_subagent() {
  hk_in_subagent && ! co_cfg_bool '.hooks.subagents' true
}

hk_event() {
  local event="$1" extra="${2:-}"
  [ -z "$extra" ] && extra='{}'
  co_stats_append "$(jq -nc --arg e "$event" --argjson x "$extra" '{ts: now | floor, kind: "hook", event: $e} + $x' 2>/dev/null)"
}

# --- PreToolUse responses
hk_deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}
hk_ask() {
  jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}
# Lets the tool run as usual but adds a note to Claude's context.
hk_note() {
  jq -nc --arg c "$1" --arg ev "${2:-PreToolUse}" '{hookSpecificOutput: {hookEventName: $ev, additionalContext: $c}}'
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
  base=$(basename "$p")
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
  ext=$(printf '%s' "${1##*.}" | LC_ALL=C tr '[:upper:]' '[:lower:]')
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
- Need understanding/facts? Bash: offload read -q "<specific question>" $q
  A cheap model answers with $file:Lx-Ly citations whose quotes are checked; then Read only those lines if you must edit.
- Question spans many files? Bash: offload explore "<question>"
EOF
  if [ -n "$outline" ]; then
    printf 'Outline of %s:\n%s\n' "$file" "$outline"
  fi
}
