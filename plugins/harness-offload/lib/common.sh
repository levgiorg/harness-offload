# shellcheck shell=bash
# offload — shared helpers. Sourced by bin/offload and every hook.
#
# Portability: must run on macOS's stock bash 3.2 and BSD userland as well as
# Linux/GNU. No associative arrays, no mapfile, no ${var,,}, no GNU-only flags.

CO_ROOT="${CO_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [ -z "$CO_ROOT" ]; then
  CO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
CO_VERSION="0.2.1"

# ---------------------------------------------------------------- utilities

co_err() { printf 'offload: %s\n' "$*" >&2; }

# bash 4.2+ formats the time itself; bash 3.2 (macOS) asks date.
if [ "${BASH_VERSINFO[0]:-3}" -gt 4 ] || { [ "${BASH_VERSINFO[0]:-3}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 2 ]; }; then
  co_now() { local t; printf -v t '%(%s)T' -1; printf '%s' "$t"; }
else
  co_now() { date +%s; }
fi

# Milliseconds are not portable (BSD date has no %N); seconds are enough.
co_elapsed() { echo $(( $(co_now) - $1 )); }

# co_base VAR PATH — basename without a process (trailing slashes ignored).
co_base() {
  local __p="$2"
  while :; do
    case "$__p" in
      /) break ;;
      */) __p=${__p%/} ;;
      *) break ;;
    esac
  done
  [ "$__p" = / ] || __p=${__p##*/}
  printf -v "$1" '%s' "$__p"
}

# co_lower VAR TEXT — lowercase; a builtin on bash 4+, tr on macOS's bash 3.2.
if [ "${BASH_VERSINFO[0]:-3}" -ge 4 ]; then
  eval 'co_lower() { printf -v "$1" "%s" "${2,,}"; }'
else
  co_lower() {
    local __l
    __l=$(printf '%s' "$2" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    printf -v "$1" '%s' "$__l"
  }
fi

co_trim() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

# Thousands separator without relying on locale-aware printf.
co_fmt_int() {
  local s="$1" out=""
  while [ ${#s} -gt 3 ]; do
    out=",${s:$((${#s} - 3))}$out"
    s=${s:0:$((${#s} - 3))}
  done
  printf '%s' "$s$out"
}

co_file_bytes() {
  local b
  b=$(wc -c < "$1" 2>/dev/null) || b=0
  b=${b//[!0-9]/}
  printf '%s' "${b:-0}"
}

# wc -l misses a final line without a trailing newline; awk counts it.
co_file_lines() { awk 'END { print NR }' "$1" 2>/dev/null || echo 0; }

# Token estimates. Bytes ÷ 4 undercounts real tokenizers by up to 59% (dense logs,
# CSV, pretty JSON); 0.277 per byte + 1.127 per run of digits was fit on 25 files
# (code, logs, JSON, CSV, Markdown, minified JS, CJK) against two real tokenizers
# (docs/autopilot/EXPERIMENTS.md, A8). co_tokens FILE BYTES counts the digit runs;
# co_est_tokens BYTES is the bytes-only fallback (the same 0.3 per byte the TS engine
# uses without the text). Twins: estTokensText, estTokens.
co_est_tokens() { echo $(( ($1 * 3 + 9) / 10 )); }
co_tokens() {
  LC_ALL=C awk -v b="$2" '{ d += gsub(/[0-9]+/, "") } END { printf "%d\n", (b * 277 + d * 1127 + 999) / 1000 }' "$1" 2>/dev/null || co_est_tokens "$2"
}
# the most a text of BYTES can count (every other byte a digit run): above the limit
# only then is the file worth reading to count
co_tokens_max() { echo $(( ($1 * 840 + 999) / 1000 )); }

# True when the file looks like text (no NUL byte in the first 8 KB).
co_is_text() {
  local f="$1" LC_ALL=C x rc
  [ -f "$f" ] && [ -r "$f" ] || return 1
  # read stops at the first NUL (status 0) or after 8192 bytes; reaching the
  # end of the file without a NUL is status 1. No process needed.
  IFS= read -r -d '' -n 8192 x < "$f"; rc=$?
  [ "$rc" -ne 0 ] || [ ${#x} -ge 8192 ]
}

# Safe single-quote shell quoting, for commands we print for Claude to run.
co_shquote() {
  case "$1" in
    ''|*[!A-Za-z0-9_./:=@%+,-]*) printf "'%s'" "$(printf '%s' "$1" | LC_ALL=C sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Short slug for log file names.
co_slug() {
  printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9._-' '-' | LC_ALL=C tr -s '-' | LC_ALL=C sed -e 's/^[-.]*//' | LC_ALL=C cut -c1-40 | LC_ALL=C sed -e 's/-*$//'
}

co_mktemp() { mktemp "${TMPDIR:-/tmp}/offload.XXXXXX"; }

# co_tmp VAR — a temp file, removed when the process that created the temp
# dir exits. Subshells ($(...), pipelines) reuse the inherited dir and set no
# trap of their own (EXIT traps are not inherited), so a subshell exiting can
# never delete files its parent still needs.
CO_TMPDIR=""
co_tmp() {
  local f
  if [ -z "$CO_TMPDIR" ] || [ ! -d "$CO_TMPDIR" ]; then
    CO_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/offload.XXXXXX") || return 1
    trap 'co_cleanup' EXIT
  fi
  f=$(mktemp "$CO_TMPDIR/t.XXXXXX") || return 1
  printf -v "$1" '%s' "$f"
}
co_cleanup() {
  [ -n "$CO_TMPDIR" ] && rm -rf "$CO_TMPDIR" 2>/dev/null
}

# co_kill_tree PID... — a process and everything it started (children first), so a
# worker's own subprocesses don't outlive it. Twin: the process-tree kill in proc.ts.
co_kill_tree() {
  local p c
  for p in "$@"; do
    [ -n "$p" ] || continue
    for c in $(pgrep -P "$p" 2>/dev/null); do co_kill_tree "$c"; done
    kill "$p" 2>/dev/null
  done
  return 0
}

# co_wait_worker PID WATCHDOG — wait for a worker; if offload itself is stopped meanwhile
# (TERM, INT, HUP), take the worker's whole tree and the watchdog with it, then exit.
# Sets CO_WAIT_RC.
co_wait_worker() {
  local w="$1" d="$2"
  trap 'co_kill_tree "$w" "$d"; co_cleanup; exit 143' TERM
  trap 'co_kill_tree "$w" "$d"; co_cleanup; exit 130' INT
  trap 'co_kill_tree "$w" "$d"; co_cleanup; exit 129' HUP
  # (bash's own "Killed (cd …)" job notice must not reach the agent: the error says it better)
  wait "$w" 2>/dev/null; CO_WAIT_RC=$?
  trap - TERM INT HUP
}

# ------------------------------------------------------------------- config

co_project_dir() {
  if [ -n "${CO_PROJECT_DIR:-}" ]; then printf '%s' "$CO_PROJECT_DIR"; return; fi
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
    printf '%s' "$CLAUDE_PROJECT_DIR"; return
  fi
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ] && { printf '%s' "$top"; return; }
  pwd
}

co_user_config_path() {
  printf '%s' "${OFFLOAD_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/harness-offload/config.json}"
}

co_project_config_path() {
  printf '%s/.harness-offload.json' "$(co_project_dir)"
}

# A repository's .harness-offload.json is not trusted like the user's own
# config: a cloned repo must not pick binaries to execute, endpoints to send
# API keys to, or switch privacy guards off. Unless the project directory is
# listed in the user config's trusted_projects, only these keys apply, and
# privacy.secret_globs can only grow. (Twin: SAFE_PROJECT_KEYS in config.ts.)
CO_PROJECT_FILTER='
  . as $base | $p[0] as $proj | ($proj | if type == "object" then . else {} end) as $proj
  | if (($base.trusted_projects // []) | map(select(. == $dir)) | length) > 0 then $base * $proj
    else
      ($proj | with_entries(select(.key == "models" or .key == "variants" or .key == "read" or .key == "explore"
        or .key == "digest" or .key == "hooks" or .key == "enabled" or .key == "log_retention_days" or .key == "tasks"
        or .key == "timeouts"))) as $safe
    | (($proj.opencode // {}) | if type == "object" then with_entries(select(.key == "timeout_seconds" or .key == "max_stream_errors")) else {} end) as $oc
    | (($proj.privacy // {}) | if type == "object" then (.secret_globs // []) else [] end | if type == "array" then map(select(type == "string")) else [] end) as $globs
    | ($base * $safe * {opencode: $oc}) | .privacy.secret_globs = ((.privacy.secret_globs // []) + $globs)
    end'

# Keys of the project config that were ignored (for doctor).
co_project_config_ignored() {
  local proj
  proj=$(co_project_config_path)
  [ -f "$proj" ] || return 0
  co_config_load
  if printf '%s' "$CO_CONFIG" | jq -e --arg d "$(co_project_dir)" '(.trusted_projects // []) | map(select(. == $d)) | length > 0' >/dev/null 2>&1; then return 0; fi
  jq -r 'if type != "object" then empty else
      ([keys[] | select(. != "models" and . != "variants" and . != "read" and . != "explore" and . != "digest"
        and . != "hooks" and . != "enabled" and . != "log_retention_days" and . != "tasks" and . != "timeouts" and . != "opencode" and . != "privacy")]
      + ((.opencode // {}) | if type == "object" then [keys[] | select(. != "timeout_seconds" and . != "max_stream_errors") | "opencode." + .] else [] end)
      + ((.privacy // {}) | if type == "object" then [keys[] | select(. != "secret_globs") | "privacy." + .] else [] end))
      | join(", ") end' "$proj" 2>/dev/null
}

# Loads defaults <- user config <- project config (filtered) <- env
# overrides into CO_CONFIG (a JSON string). Broken files are reported and
# skipped, never fatal: a typo in a config must not wedge Claude's tools.
#
# Hooks run on every tool call, so this is one jq process: it validates,
# merges, filters and applies the overrides, and also turns every simple key
# into shell variables that co_cfg/co_cfg_list read without a process:
# CO_T__hooks__read_guard=s (s scalar, o object, l list of one-line strings,
# l0 empty list, a anything else) and CO_K__hooks__read_guard=block. Keys
# outside [A-Za-z0-9_] (or with "__", or a leading/trailing "_") are left to
# jq. CO_CFG_VARS lists the names so a reload can drop them.
CO_CONFIG=""
CO_CFG_FAST=""
CO_CFG_VARS=""
CO_CONFIG_PROGRAM='
  def obj: try (fromjson | if type == "object" then . else null end) catch null;
  def good: (explode | all(.[]; (. >= 65 and . <= 90) or (. >= 97 and . <= 122) or (. >= 48 and . <= 57) or . == 95))
    and length > 0 and (contains("__") | not) and (startswith("_") | not) and (endswith("_") | not);
  def flat($n):
    if type == "object" then
      (if $n != "" then ["CO_T\($n)", "o"] else empty end),
      (to_entries[] | select(.key | good) | .key as $k | .value | flat($n + "__" + $k))
    elif type == "array" then
      if length == 0 then ["CO_T\($n)", "l0"]
      elif all(.[]; type == "string" and (contains("\n") | not)) then ["CO_T\($n)", "l"], ["CO_K\($n)", join("\n")]
      else ["CO_T\($n)", "a"] end
    elif type == "null" then empty
    elif type == "string" and contains("\n") then ["CO_T\($n)", "a"]
    else ["CO_T\($n)", "s"], ["CO_K\($n)", tostring] end;
  ($d | obj // {}) as $dflt
  | (if $upath == "" then null else ($u | obj) end) as $user
  | (if $ppath == "" then null else ($pr | obj) end) as $projv
  | ($dflt * ($user // {})) as $base
  | (if $projv == null then $base
     else ([$projv] as $p | $base | (PROJECT_FILTER)) end) as $merged
  | ($merged
    | (if $model   != "" then .models.default = $model else . end)
    | (if $guard   != "" then .hooks.read_guard = $guard else . end)
    | (if $timeout != "" then .opencode.timeout_seconds = ($timeout | tonumber) else . end)
    | (if $bin     != "" then .opencode.bin = $bin else . end)
    | (if $disabled == "1" or $disabled == "true" then .enabled = false else . end)
    | (if $state   != "" then .state_dir = $state else . end)
    | (if $min_lines != "" then .hooks.read_threshold_lines = ($min_lines | tonumber) else . end)) as $final
  | [$final | flat("")] as $vars
  | "CO_CFG_BAD=" + ([(if $upath != "" and $user == null then $upath else empty end),
      (if $ppath != "" and $projv == null then $ppath else empty end)] | join("\n") | @sh),
    "CO_CONFIG=" + ($final | tojson | @sh),
    ($vars[] | .[0] + "=" + (.[1] | @sh)),
    "CO_CFG_VARS=" + ([$vars[] | .[0]] | join(" ") | @sh),
    "CO_CFG_FAST=1"'

co_config_load() {
  [ -n "$CO_CONFIG" ] && return 0
  local user proj pdir min_lines="${OFFLOAD_MIN_LINES:-}" timeout="${OFFLOAD_TIMEOUT:-}" out f
  CO_CFG_BAD=""
  # a reload (CO_CONFIG reset after a change) must not see the old keys
  # shellcheck disable=SC2086
  [ -n "$CO_CFG_VARS" ] && unset $CO_CFG_VARS
  CO_CFG_VARS="" CO_CFG_FAST=""
  user="${OFFLOAD_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/harness-offload/config.json}"   # = co_user_config_path
  pdir=${CO_PROJECT_DIR:-}
  [ -n "$pdir" ] || pdir=$(co_project_dir)
  proj="$pdir/.harness-offload.json"
  [ -f "$user" ] || user=""
  [ -f "$proj" ] || proj=""
  # Environment overrides — handy for one-off runs and for tests.
  # OFFLOAD_MIN_LINES is a shortcut for hooks.read_threshold_lines.
  # (No jq regex anywhere: Apple's /usr/bin/jq may be built without one.)
  case "$min_lines" in ''|*[!0-9]*) min_lines="" ;; esac
  case "$timeout" in ''|*[!0-9]*) timeout="" ;; esac

  # The result is cached per project, keyed by everything it depends on: the
  # environment overrides, the paths and the full text of the three files
  # (read here without starting a process). Any edit changes the key, so a
  # stale entry can't be used; the cache is only read when this user owns it.
  # OFFLOAD_NO_CONFIG_CACHE=1 turns it off.
  local key="" cache="" cdir c CO_CFG_KEY=""
  if [ -z "${OFFLOAD_NO_CONFIG_CACHE:-}" ]; then
    key="v1|$CO_ROOT|$user|$proj|$pdir|${OFFLOAD_MODEL:-}|${OFFLOAD_READ_GUARD:-}|$timeout|${OFFLOAD_OPENCODE_BIN:-}|${OFFLOAD_DISABLE:-}|${OFFLOAD_STATE_DIR:-}|$min_lines"
    for f in "$CO_ROOT/config/defaults.json" "$user" "$proj"; do
      c=""
      [ -n "$f" ] && IFS= read -r -d '' c < "$f"
      key="$key|${#c}|$c"
    done
    cdir="${OFFLOAD_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/harness-offload}/cache"
    c=${pdir//[!A-Za-z0-9._-]/_}
    [ ${#c} -gt 180 ] && c=${c:$((${#c} - 180))}
    cache="$cdir/config$c"
    if [ -f "$cache" ] && [ ! -h "$cache" ] && [ -O "$cache" ] && [ -O "$cdir" ]; then
      out=""
      IFS= read -r -d '' out < "$cache"
      case "$out" in
        *"CO_CFG_FAST=1"*)
          eval "$out"
          if [ "$CO_CFG_KEY" = "$key" ]; then
            co_config_warn
            return 0
          fi
          # shellcheck disable=SC2086
          [ -n "$CO_CFG_VARS" ] && unset $CO_CFG_VARS
          CO_CFG_VARS="" CO_CFG_FAST="" CO_CONFIG="" ;;
      esac
    fi
  fi
  out=$(jq -nr \
    --rawfile d "$CO_ROOT/config/defaults.json" \
    --rawfile u "${user:-/dev/null}" --arg upath "$user" \
    --rawfile pr "${proj:-/dev/null}" --arg ppath "$proj" --arg dir "$pdir" \
    --arg model "${OFFLOAD_MODEL:-}" \
    --arg guard "${OFFLOAD_READ_GUARD:-}" \
    --arg timeout "$timeout" \
    --arg bin "${OFFLOAD_OPENCODE_BIN:-}" \
    --arg disabled "${OFFLOAD_DISABLE:-}" \
    --arg state "${OFFLOAD_STATE_DIR:-}" \
    --arg min_lines "$min_lines" \
    "${CO_CONFIG_PROGRAM%%PROJECT_FILTER*}$CO_PROJECT_FILTER${CO_CONFIG_PROGRAM#*PROJECT_FILTER}" 2>/dev/null) || out=""
  case "$out" in
    *"CO_CFG_FAST=1") eval "$out" ;;
    *) co_config_load_slow; return 0 ;;
  esac
  if [ -n "$cache" ]; then
    # (private: the merged config can hold an endpoint's api_key)
    { [ -d "$cdir" ] || mkdir -p -m 700 "$cdir" 2>/dev/null; } &&
      (umask 077 && printf 'CO_CFG_KEY=%q\n%s\n' "$key" "$out" > "$cache.$$") 2>/dev/null &&
      mv -f "$cache.$$" "$cache" 2>/dev/null || rm -f "$cache.$$" 2>/dev/null
  fi
  co_config_warn
}

# Reports config files that were skipped as invalid (CO_CFG_BAD, one per line).
co_config_warn() {
  local f
  while IFS= read -r f; do
    [ -n "$f" ] && co_err "ignoring invalid JSON config: $f"
  done <<EOF
$CO_CFG_BAD
EOF
}

# The step-by-step loader, kept for a jq that rejects the program above.
co_config_load_slow() {
  local files="$CO_ROOT/config/defaults.json" f user proj
  user=$(co_user_config_path)
  proj=$(co_project_config_path)
  for f in "$user" "$proj"; do
    [ -f "$f" ] || continue
    if ! jq -e 'type == "object"' "$f" >/dev/null 2>&1; then
      co_err "ignoring invalid JSON config: $f"
      [ "$f" = "$proj" ] && proj=""
      continue
    fi
    [ "$f" = "$user" ] && files="$files
$f"
  done
  [ -f "$proj" ] || proj=""
  local merged
  # shellcheck disable=SC2086
  merged=$(printf '%s\n' "$files" | while IFS= read -r f; do cat "$f"; echo; done |
    jq -s 'reduce .[] as $c ({}; . * $c)') || merged=$(cat "$CO_ROOT/config/defaults.json")
  if [ -n "$proj" ]; then
    merged=$(printf '%s' "$merged" | jq --slurpfile p "$proj" --arg dir "$(co_project_dir)" "$CO_PROJECT_FILTER" 2>/dev/null) ||
      merged=$(printf '%s\n' "$files" | while IFS= read -r f; do cat "$f"; echo; done | jq -s 'reduce .[] as $c ({}; . * $c)')
  fi
  local min_lines="${OFFLOAD_MIN_LINES:-}" timeout="${OFFLOAD_TIMEOUT:-}" base="$merged"
  case "$min_lines" in ''|*[!0-9]*) min_lines="" ;; esac
  case "$timeout" in ''|*[!0-9]*) timeout="" ;; esac
  merged=$(printf '%s' "$merged" | jq \
    --arg model "${OFFLOAD_MODEL:-}" \
    --arg guard "${OFFLOAD_READ_GUARD:-}" \
    --arg timeout "$timeout" \
    --arg bin "${OFFLOAD_OPENCODE_BIN:-}" \
    --arg disabled "${OFFLOAD_DISABLE:-}" \
    --arg state "${OFFLOAD_STATE_DIR:-}" \
    --arg min_lines "$min_lines" '
      (if $model   != "" then .models.default = $model else . end)
    | (if $guard   != "" then .hooks.read_guard = $guard else . end)
    | (if $timeout != "" then .opencode.timeout_seconds = ($timeout | tonumber) else . end)
    | (if $bin     != "" then .opencode.bin = $bin else . end)
    | (if $disabled == "1" or $disabled == "true" then .enabled = false else . end)
    | (if $state   != "" then .state_dir = $state else . end)
    | (if $min_lines != "" then .hooks.read_threshold_lines = ($min_lines | tonumber) else . end)') || merged="$base"
  CO_CONFIG="$merged"
}

# co_cfgv VAR '.path.to.key' [default] — sets VAR to the setting (scalars as
# text, arrays/objects as JSON); co_cfg prints it. A simple path is answered
# from the CO_T__/CO_K__ variables; anything else asks jq.
co_cfgv() {
  local __v __t __n
  co_config_load
  if [ -n "$CO_CFG_FAST" ]; then
    case "$2" in
      *[!A-Za-z0-9_.]*|*..*|*.|*__*|*._*|*_.*|*_) ;;
      .[A-Za-z0-9]*)
        __n=${2//./__}
        eval "__t=\${CO_T$__n-}"
        case "$__t" in
          s)
            eval "__v=\$CO_K$__n"
            if [ -z "$__v" ] || [ "$__v" = "null" ]; then __v=${3:-}; fi
            printf -v "$1" '%s' "$__v"
            return 0 ;;
          '') printf -v "$1" '%s' "${3:-}"; return 0 ;;
        esac ;;
    esac
  fi
  # (not `// empty`: that would turn an explicit false into the default)
  __v=$(printf '%s' "$CO_CONFIG" | jq -r "($2) | if . == null then empty elif type == \"array\" or type == \"object\" then tojson else tostring end" 2>/dev/null)
  if [ -z "$__v" ] || [ "$__v" = "null" ]; then __v=${3:-}; fi
  printf -v "$1" '%s' "$__v"
}

co_cfg() {
  local v
  co_cfgv v "$1" "${2:-}"
  printf '%s' "$v"
}

co_cfg_bool() {
  local v
  co_cfgv v "$1" "${2:-false}"
  case "$v" in true|1|yes|on) return 0 ;; *) return 1 ;; esac
}

# co_cfgi VAR '.path' DEFAULT — a non-negative integer setting (else DEFAULT).
co_cfgi() {
  local __i
  co_cfgv __i "$2" "$3"
  case "$__i" in ''|*[!0-9]*) __i=$3 ;; esac
  printf -v "$1" '%s' "$__i"
}

co_cfg_int() {
  local v
  co_cfgi v "$1" "$2"
  printf '%s' "$v"
}

# "review-sql (Find N+1 queries), scan" — the user's own tasks, for session
# guides (at most 12; names must be valid task names). Twin: taskSummary.
co_task_summary() {
  local n d out="" count=0 total=0
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    case "$n" in *[!a-z0-9_-]*|-*) continue ;; esac
    [ ${#n} -le 40 ] || continue
    total=$((total + 1))
    [ "$count" -lt 12 ] || continue
    count=$((count + 1))
    d=$(co_cfg ".tasks[\"$n\"].description" | LC_ALL=C tr '\n\t\r' '   ' | LC_ALL=C tr -s ' ' | LC_ALL=C sed 's/^ //; s/ $//' | cut -c1-80)
    out="$out${out:+, }$n${d:+ ($d)}"
  done <<EOF
$(co_cfg_list '(.tasks // {}) | if type == "object" then keys else [] end')
EOF
  [ "$total" -gt 12 ] && out="$out, … ($((total - 12)) more: offload tasks)"
  printf '%s' "$out"
}

# Newline-separated list from a JSON array setting.
co_cfg_list() {
  co_config_load
  if [ -n "$CO_CFG_FAST" ]; then
    case "$1" in
      *[!A-Za-z0-9_.]*|*..*|*.|*__*|*._*|*_.*|*_) ;;
      .[A-Za-z0-9]*)
        local __n=${1//./__} __t __v
        eval "__t=\${CO_T$__n-}"
        case "$__t" in
          l) eval "__v=\$CO_K$__n"; printf '%s\n' "$__v"; return 0 ;;
          l0|s|'') return 0 ;;
        esac ;;
    esac
  fi
  printf '%s' "$CO_CONFIG" | jq -r "($1) // [] | .[]" 2>/dev/null
}

# -------------------------------------------------------------------- state

co_state_dir() {
  local d
  co_cfgv d '.state_dir'
  [ -z "$d" ] && d="${XDG_STATE_HOME:-$HOME/.local/state}/harness-offload"
  [ -d "$d/logs" ] && [ -d "$d/cooldowns" ] || mkdir -p "$d/logs" "$d/cooldowns" 2>/dev/null
  # logs hold raw command output (which can print secrets): the folder is private,
  # existing installs included; the marker keeps this to one chmod per state dir
  [ -e "$d/.private" ] || { chmod 700 "$d" 2>/dev/null && : > "$d/.private" 2>/dev/null; }
  printf '%s' "$d"
}

# Appends one JSON object (built by the caller with jq -nc) to stats.jsonl.
co_stats_append() {
  local d
  [ -n "$1" ] || return 0
  d=$(co_state_dir)
  printf '%s\n' "$1" >> "$d/stats.jsonl" 2>/dev/null || true
}

# Deletes logs past the retention window; cheap enough to run on each digest.
co_prune_logs() {
  local d days
  d=$(co_state_dir)
  days=$(co_cfg_int '.log_retention_days' 7)
  find "$d/logs" -type f -name '*.log' -mtime +"$days" -exec rm -f {} + 2>/dev/null || true
  find "$d/seen" -type f -mmin +120 -exec rm -f {} + 2>/dev/null || true
  find "$d/cache/answers" -type f -mmin +1440 -exec rm -f {} + 2>/dev/null || true
}

# Outputs this session already saw (digested or search view): one marker per
# session + POSIX cksum of the output, holding "<epoch> <HH:MM:SS> <log>". Twin:
# seenFile() in state.ts — the same name and contents, so both engines share them.
co_seen_session() { printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9_-' '_' | LC_ALL=C cut -c1-64; }
co_seen_file() {
  [ -n "${HK_SESSION:-}" ] || return 1
  local sum
  sum=$(LC_ALL=C cksum < "$1" | LC_ALL=C awk '{ print $1 "-" $2 }')
  printf '%s/seen/%s-%s' "$(co_state_dir)" "$(co_seen_session "$HK_SESSION")" "$sum"
}
# Forget what this session saw (after a compaction or /clear the agent no longer has it).
# After a compaction: the session's digested outputs, newest first (at most 600 bytes),
# so the agent still finds the full logs. Read from the per-command markers before
# co_seen_forget drops them. Twin: compactIndex.
co_compact_index() {
  [ -n "${HK_SESSION:-}" ] || return 0
  local d head out="" line at hms log name n LC_ALL=C   # lengths in bytes
  d="$(co_state_dir)/seen"
  set -- "$d/$(co_seen_session "$HK_SESSION")"-cmd-*
  [ -e "$1" ] || return 0
  head="Before the compaction, offload digested these outputs (full logs kept; offload summarize LOG digests one again):"
  n=${#head}
  while IFS=' ' read -r at hms log; do
    [ -n "$log" ] && [ -f "$log" ] || continue
    name=${log##*/}; name=${name#????????-??????-}; name=${name%-*.log}
    line="  $hms $name → $log"
    [ $(( n + 1 + ${#line} )) -le 600 ] || break
    out="$out"$'\n'"$line"; n=$(( n + 1 + ${#line} ))
  done <<EOF
$(cat "$@" 2>/dev/null | LC_ALL=C sort -k1,1nr -k3)
EOF
  [ -n "$out" ] && printf '%s%s' "$head" "$out"
  return 0
}

co_seen_forget() {
  [ -n "${HK_SESSION:-}" ] || return 0
  rm -f "$(co_state_dir)/seen/$(co_seen_session "$HK_SESSION")"-* 2>/dev/null || true
}

# ------------------------------------------------------------------ privacy

# True when the path looks like it holds secrets. Matches the basename against
# privacy.secret_globs, with privacy.secret_allow_globs as exceptions.
co_is_secret_path() {
  local base orig pat allow deny
  # case-insensitive (macOS/Windows file systems), trailing dots/spaces ignored
  co_base orig "$1"
  co_lower base "$orig"
  while :; do
    case "$base" in
      *[.\ ]) base=${base%?} ;;
      *) break ;;
    esac
  done
  [ -z "$base" ] && base=$orig
  allow=$(co_cfg_list '.privacy.secret_allow_globs')
  deny=$(co_cfg_list '.privacy.secret_globs')
  co_lower allow "$allow"
  co_lower deny "$deny"
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$base" in $pat) return 1 ;; esac
  done <<EOF
$allow
EOF
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$base" in $pat) return 0 ;; esac
  done <<EOF
$deny
EOF
  return 1
}

# Final target of a path after following symlinks (portable: no readlink -f).
co_real_path() {
  local p="$1" d n=0
  while [ -h "$p" ] && [ $n -lt 40 ]; do
    d=$(cd -P "$(dirname "$p")" 2>/dev/null && pwd) || break
    p=$(readlink "$p")
    case "$p" in /*) ;; *) p="$d/$p" ;; esac
    n=$((n + 1))
  done
  d=$(cd -P "$(dirname "$p")" 2>/dev/null && pwd) || { printf '%s' "$p"; return; }
  printf '%s/%s' "$d" "$(basename "$p")"
}

# A secret by its own name or by what it points to (notes.md -> .env).
co_is_secret_target() {
  co_is_secret_path "$1" && return 0
  [ -h "$1" ] && co_is_secret_path "$(co_real_path "$1")" && return 0
  return 1
}

# Masks common credential shapes in text bound for a third-party model.
# stdin -> stdout. Deliberately conservative: it only touches things that
# look like keys, so code and logs stay intact.
co_redact() {
  if ! co_cfg_bool '.privacy.redact' true; then cat; return; fi
  # LC_ALL=C: BSD sed stops at the first invalid UTF-8 byte otherwise.
  # Same patterns as redact() in secrets.ts.
  LC_ALL=C sed -E \
    -e 's/(AKIA|ASIA)[0-9A-Z]{16}/[REDACTED-AWS-KEY]/g' \
    -e 's/(gh[pousr]_)[A-Za-z0-9]{30,}/\1[REDACTED]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{30,}/github_pat_[REDACTED]/g' \
    -e 's/glpat-[A-Za-z0-9_-]{20,}/glpat-[REDACTED]/g' \
    -e 's/npm_[A-Za-z0-9]{36}/npm_[REDACTED]/g' \
    -e 's/hf_[A-Za-z0-9]{30,}/hf_[REDACTED]/g' \
    -e 's/((sk|rk)_(live|test)_)[A-Za-z0-9]{10,}/\1[REDACTED]/g' \
    -e 's/(sk-(proj-|ant-)?)[A-Za-z0-9_-]{20,}/\1[REDACTED]/g' \
    -e 's/xox[abprs]-[A-Za-z0-9-]{10,}/xox-[REDACTED]/g' \
    -e 's/AIza[0-9A-Za-z_-]{35}/[REDACTED-GOOGLE-KEY]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED-JWT]/g' \
    -e 's/([Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+)[A-Za-z0-9._~+\/=-]{16,}/\1[REDACTED]/g' \
    -e 's/([Bb][Aa][Ss][Ii][Cc][[:space:]]+)[A-Za-z0-9+\/=]{16,}/\1[REDACTED]/g' \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@]+:)[^@[:space:]/]+@#\1[REDACTED]@#g' \
    -e 's/(([Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Pp][Hh][Rr][Aa][Ss][Ee]|[Ss][Ee][Cc][Rr][Ee][Tt])"?[[:space:]]*[:=][[:space:]]*")[^"]{6,}"/\1[REDACTED]"/g' \
    -e "s/(([Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Pp][Hh][Rr][Aa][Ss][Ee]|[Ss][Ee][Cc][Rr][Ee][Tt])'?[[:space:]]*[:=][[:space:]]*')[^']{6,}'/\1[REDACTED]'/g" \
    -e 's/(([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Aa][Cc][Cc][Ee][Ss][Ss][-_]?[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][-_]?[Tt][Oo][Kk][Ee][Nn])[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^"'"'"'[:space:],;]{8,}/\1[REDACTED]/g' \
  | LC_ALL=C awk '
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/ { print "[REDACTED PRIVATE KEY]"; skip = 1; next }
      skip && /-----END [A-Z ]*PRIVATE KEY-----/ { skip = 0; next }
      !skip { print }'
}

# ------------------------------------------------------------- availability

co_opencode_bin() { co_cfg '.opencode.bin' 'opencode'; }

co_have_opencode() {
  local b
  b=$(co_opencode_bin)
  command -v "$b" >/dev/null 2>&1 || [ -x "$b" ]
}

# Hooks fail open: when offload cannot deliver (disabled, no opencode, every
# model cooling down after errors) they let Claude's own tools run unimpeded.
# Sources the worker code (OpenCode transport, agent CLIs, HTTP) once.
co_backends() {
  [ -n "${CO_BACKENDS_LOADED:-}" ] && return 0
  # shellcheck source=opencode.sh
  . "$CO_ROOT/lib/opencode.sh"
}

co_available() {
  co_cfg_bool '.enabled' true || return 1
  co_backends
  command -v jq >/dev/null 2>&1 || return 1
  co_backend_present || return 1
  co_any_model_ready
}

# True when the backend of the first read/summarize model can run here
# (opencode, the agent CLI, curl, or the TypeScript CLI — see co_route).
co_backend_present() {
  local m task
  co_backends
  for task in read summarize; do
    m=$(co_model_chain "$task" | head -n 1)
    co_route "$m" "$task" 2>/dev/null || continue
    co_route_ready && return 0
  done
  return 1
}

# ------------------------------------------------------------------ versions

# co_version_notes — one line per piece of offload that is a different version
# from this one: the Claude Code plugin (Claude Code's own record of it) and every
# integration `offload install` set up (installs.json). Twin: versionNotes.
co_version_notes() {
  local reg="${CLAUDE_CONFIG_DIR:-${OFFLOAD_HOME:-$HOME}/.claude}/plugins/installed_plugins.json" inst
  inst="$(co_state_dir)/installs.json"
  {
    [ -f "$reg" ] && jq -r '(.plugins // {}) | to_entries[] | select(.key | startswith("harness-offload@"))
      | .key as $k | .value | (if type == "array" then .[] else . end) | "plugin\t" + (.version // "" | tostring) + "\t" + $k' "$reg" 2>/dev/null | head -n 1
    [ -f "$inst" ] && jq -r 'to_entries[] | select(.value | type == "object") | .key + "\t" + (.value.version // "" | tostring)' "$inst" 2>/dev/null
  } | LC_ALL=C awk -F '\t' -v me="$CO_VERSION" '
    function num(v, i,   a, n) { sub(/-.*/, "", v); n = split(v, a, "."); return (i <= n ? a[i] + 0 : 0) }
    function cmp(a, b,   i) { for (i = 1; i <= 3; i++) { if (num(a, i) < num(b, i)) return -1; if (num(a, i) > num(b, i)) return 1 }; return 0 }
    $2 == "" || $2 == me { next }
    $1 == "plugin" {
      if (cmp($2, me) < 0) print "Claude Code plugin " $2 " is older than this offload " me " — update it: claude plugin update " $3
      else print "this offload " me " is older than the Claude Code plugin " $2 " — update it: npm i -g harness-offload@latest"
      next }
    { print $1 " integration was set up by offload " $2 " (this is " me ") — offload sync refreshes it" }'
}

# ------------------------------------------------------------------ config check

# co_config_unknown FILE — one line per key in FILE that offload doesn't know:
# "KEY<TAB>SUGGESTION" (the closest known key, or empty). Known keys are the leaves of
# config/defaults.json; maps of your own (tasks, endpoints, agents, hosts, host_models,
# host_api_models, trusted_projects) take any key. Twin: unknownConfigKeys() in config.ts.
co_config_unknown() {
  local f="$1" leaves='def lp(p): if type == "object" then to_entries[] as $e | ($e.value | lp(p + [$e.key])) else (p | join(".")) end; lp([])'
  [ -f "$f" ] || return 0
  { jq -r "$leaves" "$CO_ROOT/config/defaults.json" 2>/dev/null | sed 's/^/K /'
    jq -r "$leaves" "$f" 2>/dev/null | sed 's/^/A /'; } | LC_ALL=C awk '
    function lev(a, b,    i, j, la, lb, d, c, x, y) {
      la = length(a); lb = length(b)
      for (j = 0; j <= lb; j++) d[0, j] = j
      for (i = 1; i <= la; i++) {
        d[i, 0] = i
        for (j = 1; j <= lb; j++) {
          c = (substr(a, i, 1) == substr(b, j, 1)) ? 0 : 1
          x = d[i - 1, j] + 1; y = d[i, j - 1] + 1; if (y < x) x = y
          y = d[i - 1, j - 1] + c; if (y < x) x = y
          d[i, j] = x
        }
      }
      return d[la, lb]
    }
    $1 == "K" { known[$2] = 1; nk++; kl[nk] = $2; next }
    $1 == "A" {
      k = $2; top = k; sub(/\..*/, "", top)
      if (k in known || top ~ /^(tasks|endpoints|agents|hosts|host_models|host_api_models|trusted_projects)$/ || top ~ /^_/) next
      best = ""; bd = 4
      for (i = 1; i <= nk; i++) { e = lev(k, kl[i]); if (e < bd) { bd = e; best = kl[i] } }
      printf "%s\t%s\n", k, best
    }'
}

# co_fence — stdin to stdout with offload's own prompt tags neutralised inside material
# (a file, a log or piped text), so content can't close a block or start a new question:
# the "<" of <file>, <question>, <instructions>, <previous_answer>, <check> (open or close)
# and of </input>, </output> becomes "&lt;". Opening <input>/<output> (HTML, JSX) stay.
# Twin: fence() in secrets.ts.
co_fence() {
  LC_ALL=C awk '
    function fence(s,    line, out) {
      out = ""
      while (index(s, "<") > 0) {
        line = tolower(s)
        if (!match(line, /<\/?(file|question|instructions|previous_answer|check)([ \t>\/]|$)|<\/(input|output)([ \t>\/]|$)/)) break
        out = out substr(s, 1, RSTART - 1) "&lt;"
        s = substr(s, RSTART + 1)
      }
      return out s
    }
    { print fence($0) }'
}
