# shellcheck shell=bash
# offload — shared helpers. Sourced by bin/offload and every hook.
#
# Portability: must run on macOS's stock bash 3.2 and BSD userland as well as
# Linux/GNU. No associative arrays, no mapfile, no ${var,,}, no GNU-only flags.

CO_ROOT="${CO_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [ -z "$CO_ROOT" ]; then
  CO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
CO_VERSION="0.2.0"

# ---------------------------------------------------------------- utilities

co_err() { printf 'offload: %s\n' "$*" >&2; }

co_now() { date +%s; }

# Milliseconds are not portable (BSD date has no %N); seconds are enough.
co_elapsed() { echo $(( $(co_now) - $1 )); }

co_trim() { printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

# Thousands separator without relying on locale-aware printf.
co_fmt_int() {
  printf '%s' "$1" | awk '{ s=$0; out=""; while (length(s) > 3) { out="," substr(s, length(s)-2) out; s=substr(s, 1, length(s)-3) } print s out }'
}

co_file_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# wc -l misses a final line without a trailing newline; awk counts it.
co_file_lines() { awk 'END { print NR }' "$1" 2>/dev/null || echo 0; }

# Rough token estimate: ~4 bytes per token for code and logs.
co_est_tokens() { echo $(( ($1 + 3) / 4 )); }

# True when the file looks like text (no NUL byte in the first 8 KB).
co_is_text() {
  local f="$1" n1 n2
  [ -f "$f" ] || return 1
  n1=$(head -c 8192 "$f" 2>/dev/null | wc -c | tr -d ' ')
  # LC_ALL=C: BSD tr aborts on invalid/cut-in-half UTF-8 in a UTF-8 locale.
  n2=$(head -c 8192 "$f" 2>/dev/null | LC_ALL=C tr -d '\000' | wc -c | tr -d ' ')
  [ "$n1" = "$n2" ]
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
        or .key == "digest" or .key == "hooks" or .key == "enabled" or .key == "log_retention_days"))) as $safe
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
        and . != "hooks" and . != "enabled" and . != "log_retention_days" and . != "opencode" and . != "privacy")]
      + ((.opencode // {}) | if type == "object" then [keys[] | select(. != "timeout_seconds" and . != "max_stream_errors") | "opencode." + .] else [] end)
      + ((.privacy // {}) | if type == "object" then [keys[] | select(. != "secret_globs") | "privacy." + .] else [] end))
      | join(", ") end' "$proj" 2>/dev/null
}

# Loads defaults <- user config <- project config (filtered) <- env
# overrides into CO_CONFIG (a JSON string). Broken files are reported and
# skipped, never fatal: a typo in a config must not wedge Claude's tools.
CO_CONFIG=""
co_config_load() {
  [ -n "$CO_CONFIG" ] && return 0
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

  # Environment overrides — handy for one-off runs and for tests.
  # OFFLOAD_MIN_LINES is a shortcut for hooks.read_threshold_lines.
  # (No jq regex anywhere: Apple's /usr/bin/jq may be built without one.)
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

# co_cfg '.path.to.key' [default] — scalar lookup (arrays come back as JSON).
co_cfg() {
  co_config_load
  local v
  # (not `// empty`: that would turn an explicit false into the default)
  v=$(printf '%s' "$CO_CONFIG" | jq -r "($1) | if . == null then empty elif type == \"array\" or type == \"object\" then tojson else tostring end" 2>/dev/null)
  if [ -z "$v" ] || [ "$v" = "null" ]; then printf '%s' "${2:-}"; else printf '%s' "$v"; fi
}

co_cfg_bool() {
  case "$(co_cfg "$1" "${2:-false}")" in true|1|yes|on) return 0 ;; *) return 1 ;; esac
}

co_cfg_int() {
  local v
  v=$(co_cfg "$1" "$2")
  case "$v" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$v" ;; esac
}

# Newline-separated list from a JSON array setting.
co_cfg_list() {
  co_config_load
  printf '%s' "$CO_CONFIG" | jq -r "($1) // [] | .[]" 2>/dev/null
}

# -------------------------------------------------------------------- state

co_state_dir() {
  local d
  d=$(co_cfg '.state_dir')
  [ -z "$d" ] && d="${XDG_STATE_HOME:-$HOME/.local/state}/harness-offload"
  mkdir -p "$d/logs" "$d/cooldowns" 2>/dev/null
  printf '%s' "$d"
}

# Appends one JSON object (built by the caller with jq -nc) to stats.jsonl.
co_stats_append() {
  local d
  d=$(co_state_dir)
  printf '%s\n' "$1" >> "$d/stats.jsonl" 2>/dev/null || true
}

# Deletes logs past the retention window; cheap enough to run on each digest.
co_prune_logs() {
  local d days
  d=$(co_state_dir)
  days=$(co_cfg_int '.log_retention_days' 7)
  find "$d/logs" -type f -name '*.log' -mtime +"$days" -exec rm -f {} + 2>/dev/null || true
}

# ------------------------------------------------------------------ privacy

# True when the path looks like it holds secrets. Matches the basename against
# privacy.secret_globs, with privacy.secret_allow_globs as exceptions.
co_is_secret_path() {
  local base pat
  base=$(basename "$1")
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$base" in $pat) return 1 ;; esac
  done <<EOF
$(co_cfg_list '.privacy.secret_allow_globs')
EOF
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$base" in $pat) return 0 ;; esac
  done <<EOF
$(co_cfg_list '.privacy.secret_globs')
EOF
  return 1
}

# Masks common credential shapes in text bound for a third-party model.
# stdin -> stdout. Deliberately conservative: it only touches things that
# look like keys, so code and logs stay intact.
co_redact() {
  if ! co_cfg_bool '.privacy.redact' true; then cat; return; fi
  # LC_ALL=C: BSD sed stops at the first invalid UTF-8 byte otherwise.
  LC_ALL=C sed -E \
    -e 's/AKIA[0-9A-Z]{16}/[REDACTED-AWS-KEY]/g' \
    -e 's/(gh[pousr]_)[A-Za-z0-9]{30,}/\1[REDACTED]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{30,}/github_pat_[REDACTED]/g' \
    -e 's/(sk-(proj-|ant-)?)[A-Za-z0-9_-]{20,}/\1[REDACTED]/g' \
    -e 's/xox[abprs]-[A-Za-z0-9-]{10,}/xox-[REDACTED]/g' \
    -e 's/AIza[0-9A-Za-z_-]{35}/[REDACTED-GOOGLE-KEY]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED-JWT]/g' \
    -e 's/(([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Pp][Ii]_?[Kk][Ee][Yy]|[Aa][Cc][Cc][Ee][Ss][Ss]_?[Tt][Oo][Kk][Ee][Nn])[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^"'"'"'[:space:],;]{8,}/\1[REDACTED]/g' \
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
co_available() {
  co_cfg_bool '.enabled' true || return 1
  command -v jq >/dev/null 2>&1 || return 1
  co_backend_present || return 1
  co_any_model_ready
}

# True when the backend of the first read/summarize model can run here
# (opencode, the agent CLI, curl, or the TypeScript CLI — see co_route).
co_backend_present() {
  local m task
  for task in read summarize; do
    m=$(co_model_chain "$task" | head -n 1)
    co_route "$m" "$task" 2>/dev/null || continue
    co_route_ready && return 0
  done
  return 1
}
