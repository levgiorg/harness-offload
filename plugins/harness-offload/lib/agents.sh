# shellcheck shell=bash
# offload — native bash connectors for agent CLIs (claude, codex, gemini,
# cursor, pi) and HTTP APIs (OpenAI-compatible / Anthropic via curl), so the
# Claude Code plugin can use the user's own subscriptions without Node.
# Same contract as co_oc_attempt: answer in answer_file, CO_OC_* set, exit
# codes from opencode.sh. The TypeScript engine has the twin implementations.

CO_AGENT_BACKENDS="claude codex gemini cursor pi"

co_is_agent_backend() {
  case " $CO_AGENT_BACKENDS " in *" $1 "*) return 0 ;; esac
  return 1
}

# ---------------------------------------------------------------- @host

# Which harness is calling: OFFLOAD_HOST (our hooks/launchers set it), else
# the environment each harness gives its shell.
co_detect_host() {
  if [ -n "${OFFLOAD_HOST:-}" ]; then printf '%s' "$OFFLOAD_HOST"; return 0; fi
  if [ "${CLAUDECODE:-}" = 1 ] || [ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]; then printf claude; return 0; fi
  if [ -n "${CODEX_THREAD_ID:-}${CODEX_SANDBOX:-}${CODEX_CI:-}" ]; then printf codex; return 0; fi
  if [ -n "${CURSOR_AGENT:-}${CURSOR_CONVERSATION_ID:-}" ]; then printf cursor; return 0; fi
  if [ "${GEMINI_CLI:-}" = 1 ] || [ -n "${GEMINI_SESSION_ID:-}" ]; then printf gemini; return 0; fi
  if [ "${OPENCODE:-}" = 1 ] || [ -n "${OPENCODE_SESSION_ID:-}" ]; then printf opencode; return 0; fi
  if [ "${PI_CODING_AGENT:-}" = 1 ] || [ -n "${PI_SESSION_ID:-}" ]; then printf pi; return 0; fi
  return 1
}

# The harness's own cheap model for @host (config host_models overrides the
# shared defaults in config/connectors.json). Empty when the host is unknown.
co_host_model() {
  local host m
  host=$(co_detect_host) || return 1
  m=$(co_cfg ".host_models.$host")
  [ -z "$m" ] && m=$(jq -r --arg h "$host" '.host_models[$h] // empty' "$CO_ROOT/config/connectors.json" 2>/dev/null)
  [ -z "$m" ] && return 1
  printf '%s' "$m"
}

# ---------------------------------------------------------------- routing

# co_route REF TASK — call directly (not in $(…)); sets
#   CO_RT_REF      the reference after @host resolution (cooldown/log key)
#   CO_RT_BACKEND  opencode | claude | codex | … | an endpoint name
#   CO_RT_MODEL    the model id for that backend ("" = its default)
#   CO_RT_KIND     opencode | agent | http | ts
# References: "@default", "provider/model" (default backend), "BACKEND:MODEL"
# for a known backend or endpoint, "@host"/"@self" (same subscription).
co_route() {
  local ref="$1" task="$2" def prefix m
  def=$(co_cfg '.backend' opencode)
  case "$ref" in
    @host|@self)
      if ! m=$(co_host_model); then
        CO_OC_ERROR="@host: cannot tell which agent harness is calling (set OFFLOAD_HOST=claude|codex|gemini|cursor|pi|opencode)"
        return $CO_E_USAGE
      fi
      case "$m" in @host|@self) m=@default ;; esac
      co_route "$m" "$task"
      return $? ;;
    ''|@default)
      CO_RT_REF=@default CO_RT_BACKEND="$def" CO_RT_MODEL="" ;;
    *)
      CO_RT_REF="$ref" CO_RT_BACKEND="$def" CO_RT_MODEL="$ref"
      prefix=${ref%%:*}
      case "$prefix" in
        "$ref"|''|*/*) ;;
        *)
          if [ "$prefix" = opencode ] || co_is_agent_backend "$prefix" || [ -n "$(co_endpoint_json "$prefix")" ]; then
            CO_RT_BACKEND="$prefix" CO_RT_MODEL="${ref#*:}"
          fi ;;
      esac ;;
  esac
  if [ "$CO_RT_BACKEND" = opencode ]; then CO_RT_KIND=opencode
  elif co_is_agent_backend "$CO_RT_BACKEND"; then CO_RT_KIND=agent
  elif [ "$task" != explore ] && [ "${OFFLOAD_BASH_HTTP:-1}" != 0 ] && [ -n "$(co_endpoint_json "$CO_RT_BACKEND")" ]; then CO_RT_KIND=http
  else CO_RT_KIND=ts
  fi
  return 0
}

# True when the last co_route target can run on this machine.
co_route_ready() {
  case "$CO_RT_KIND" in
    opencode) co_have_opencode ;;
    agent) command -v "$(co_agent_bin "$CO_RT_BACKEND")" >/dev/null 2>&1 ;;
    http) command -v curl >/dev/null 2>&1 ;;
    *) co_ts_cli >/dev/null ;;
  esac
}

co_agent_bin() {
  case "$1" in
    cursor) co_cfg '.agents.cursor.bin' cursor-agent ;;
    *) co_cfg ".agents.$1.bin" "$1" ;;
  esac
}

# --------------------------------------------------------------- endpoints

# Endpoint JSON {type, base_url, api_key_env, …} for a name: presets from
# config/connectors.json overlaid with the user's `endpoints.<name>`.
co_endpoint_json() {
  local preset own
  preset=$(jq -c --arg n "$1" '.endpoints[$n] // {}' "$CO_ROOT/config/connectors.json" 2>/dev/null)
  own=$(co_cfg ".endpoints[\"$1\"]")
  [ -z "$own" ] && own='{}'
  printf '%s' "$preset" | jq -c --argjson o "$own" '. + $o | if .type and .base_url then . else empty end' 2>/dev/null
}

co_credentials_path() {
  printf '%s' "${OFFLOAD_CREDENTIALS:-${XDG_CONFIG_HOME:-$HOME/.config}/harness-offload/credentials.json}"
}

co_endpoint_key() {
  local name="$1" ep="$2" k env
  k=$(printf '%s' "$ep" | jq -r '.api_key // empty')
  [ -n "$k" ] && { printf '%s' "$k"; return 0; }
  k=$(jq -r --arg n "$name" '.[$n] // empty' "$(co_credentials_path)" 2>/dev/null)
  [ -n "$k" ] && { printf '%s' "$k"; return 0; }
  env=$(printf '%s' "$ep" | jq -r '.api_key_env // empty')
  case "$env" in ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) env="" ;; esac
  if [ -n "$env" ]; then eval "k=\${$env:-}"; fi
  printf '%s' "$k"
}

# ------------------------------------------------------------- execution

# co_spawn_wait TIMEOUT IN OUT ERR CWD CMD... — runs CMD with stdin from IN,
# stdout/stderr to files, OFFLOAD_DISABLE=1 (no hook recursion in the worker).
# Sets CO_RUN_RC (124 on timeout).
co_spawn_wait() {
  local timeout="$1" in="$2" out="$3" err="$4" cwd="$5" pid start
  shift 5
  start=$(co_now)
  (
    cd "$cwd" 2>/dev/null || exit 1
    PWD="$cwd"; export PWD
    OFFLOAD_DISABLE=1 exec "$@"
  ) < "$in" > "$out" 2> "$err" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(co_elapsed "$start")" -ge "$timeout" ]; then
      kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      CO_RUN_RC=124
      return 0
    fi
    sleep 0.3
  done
  wait "$pid"; CO_RUN_RC=$?
}

# The last JSON object a CLI printed, even when log lines precede a
# pretty-printed object (then: parse from the last line that opens one).
co_json_last() {
  if jq -e . "$1" >/dev/null 2>&1; then
    jq -cs 'map(select(type == "object")) | last // empty' "$1"
  else
    awk 'NR == FNR { if ($0 ~ /^\{/) n = FNR; next } FNR >= n' "$1" "$1" | jq -cs 'map(select(type == "object")) | last // empty' 2>/dev/null
  fi
}

# Turns an error text + exit code into CO_OC_ERROR and a return code.
co_agent_fail() {
  CO_OC_ERROR="$1"
  [ "${2:-}" = 124 ] && { CO_OC_ERROR="timed out after ${3:-?}s"; return $CO_E_TIMEOUT; }
  co_oc_classify "$CO_OC_ERROR"
}

# co_agent_attempt BACKEND TASK MODEL PROMPT_FILE WORKDIR VARIANT ANSWER_FILE
co_agent_attempt() {
  local backend="$1" task="$2" model="$3" prompt_file="$4" workdir="$5" variant="$6" answer_file="$7"
  local bin sys timeout out err in merged rc text u msg
  bin=$(co_agent_bin "$backend")
  CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_ERROR=""
  if ! command -v "$bin" >/dev/null 2>&1; then
    CO_OC_ERROR="$bin not found on PATH (needed for $backend:… models)"
    return $CO_E_NOOC
  fi
  sys=$(cat "$CO_ROOT/prompts/$task.md")
  timeout=$(co_attempt_timeout)
  co_tmp out; co_tmp err; co_tmp merged
  { printf '<instructions>\n%s\n</instructions>\n\n' "$sys"; cat "$prompt_file"; } > "$merged"
  local -a a pre
  pre=(env)
  case "$backend" in
    claude)
      # lean headless Claude on the user's plan (not --bare: it can't use OAuth logins)
      a=(-p --output-format json --no-session-persistence --setting-sources "" --strict-mcp-config --disable-slash-commands --system-prompt "$sys")
      [ -n "$model" ] && a+=(--model "$model")
      if [ "$task" = explore ]; then
        a+=(--tools Read,Grep,Glob --allowedTools Read,Grep,Glob)
        # secret files stay unreadable for the worker too (Read rules cover Grep/Glob)
        local g deny=""
        while IFS= read -r g; do [ -n "$g" ] && deny="$deny${deny:+,}Read(**/$g)"; done <<EOF
$(co_cfg_list '.privacy.secret_globs')
EOF
        [ -n "$deny" ] && a+=(--disallowedTools "$deny")
      else a+=(--tools ""); fi
      in="$prompt_file" ;;
    codex)
      a=(exec --json --ephemeral --skip-git-repo-check -s read-only --disable hooks --ignore-rules -C "$workdir")
      [ -n "$model" ] && a+=(-m "$model")
      [ -n "$variant" ] && a+=(-c "model_reasoning_effort=\"$variant\"")
      a+=(-)
      in="$merged" ;;
    gemini)
      printf '%s\n' "$sys" > "$merged.sys"
      pre+=("GEMINI_SYSTEM_MD=$merged.sys" GEMINI_CLI_TRUST_WORKSPACE=true)
      a=(-o json --approval-mode plan --skip-trust -e none)
      [ -n "$model" ] && a+=(-m "$model")
      a+=(-p "Answer as instructed above.")
      in="$prompt_file" ;;
    cursor)
      a=(-p --output-format json --mode ask --trust --workspace "$workdir")
      [ -n "$model" ] && a+=(--model "$model")
      a+=("$(cat "$merged")")
      in=/dev/null ;;
    pi)
      a=(-p --mode json --no-session -na -ne -ns -nc --no-mcp --system-prompt "$sys")
      if [ "$task" = explore ]; then a+=(--tools read,grep,find,ls); else a+=(--no-tools); fi
      if [ -n "$model" ]; then
        if [ -n "$variant" ]; then a+=(--model "$model:$variant"); else a+=(--model "$model"); fi
      fi
      a+=("$(printf '\n\nAnswer as instructed above.')")
      in="$prompt_file" ;;
  esac
  co_spawn_wait "$timeout" "$in" "$out" "$err" "$workdir" "${pre[@]}" "$bin" "${a[@]}"
  rc=$CO_RUN_RC
  [ "$rc" = 124 ] && { co_agent_fail "" 124 "$timeout"; return $?; }

  case "$backend" in
    claude|cursor|gemini) co_json_last "$out" > "$out.j"; mv "$out.j" "$out" ;;
  esac
  case "$backend" in
    claude|cursor)
      text=$(jq -rs 'map(select(type == "object")) | last | if .is_error then empty else (.result // empty) end' "$out" 2>/dev/null)
      if [ -z "$text" ]; then
        msg=$(jq -rs 'map(select(type == "object")) | last | .result // empty' "$out" 2>/dev/null)
        co_agent_fail "$backend: ${msg:-$(tail -c 300 "$err")}"; return $?
      fi
      u=$(jq -rs 'map(select(type == "object")) | last | (.total_cost_usd // 0) as $c | .usage // {} | [((.input_tokens // .inputTokens // 0) + (.cache_read_input_tokens // .cacheReadTokens // 0) + (.cache_creation_input_tokens // 0)), (.output_tokens // .outputTokens // 0), $c] | map(tostring) | join(" ")' "$out" 2>/dev/null) ;;
    codex)
      text=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "item.completed" and .item.type == "agent_message") | .item.text) | last // empty' "$out" 2>/dev/null)
      if [ -z "$text" ]; then
        msg=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "turn.failed" or .type == "error") | (.error.message // .message // tostring)) | last // empty' "$out" 2>/dev/null)
        co_agent_fail "codex: ${msg:-$(tail -c 300 "$err")}"; return $?
      fi
      u=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "turn.completed") | .usage) | [(map((.input_tokens // 0) + (.cached_input_tokens // 0)) | add // 0), (map(.output_tokens // 0) | add // 0)] | map(tostring) | join(" ")' "$out" 2>/dev/null) ;;
    gemini)
      text=$(jq -r 'if .error then empty else (.response // empty) end' "$out" 2>/dev/null)
      if [ -z "$text" ]; then
        msg=$(jq -r '.error.message // .error.type // empty' "$out" 2>/dev/null)
        [ "$rc" = 41 ] && { CO_OC_ERROR="gemini: ${msg:-authentication required}"; return $CO_E_AUTH; }
        co_agent_fail "gemini: ${msg:-$(tail -c 300 "$err")}"; return $?
      fi
      u=$(jq -r '[(.stats.models // {} | [.[] | .tokens.prompt // 0] | add // 0), (.stats.models // {} | [.[] | .tokens.candidates // 0] | add // 0)] | map(tostring) | join(" ")' "$out" 2>/dev/null) ;;
    pi)
      msg=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "message_end" and .message.role == "assistant" and (.message.stopReason == "error" or .message.stopReason == "aborted")) | (.message.errorMessage // .message.stopReason)) | last // empty' "$out" 2>/dev/null)
      [ -n "$msg" ] && { co_agent_fail "pi: $msg"; return $?; }
      text=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "message_end" and .message.role == "assistant") | (.message.content // [] | map(select(.type == "text") | .text) | join(""))) | map(select(explode | map(select(. > 32)) | length > 0)) | last // empty' "$out" 2>/dev/null)
      if [ -z "$text" ]; then co_agent_fail "pi: $(tail -c 300 "$err")"; return $?; fi
      u=$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "message_end" and .message.role == "assistant") | .message.usage // {}) | [(map((.input // 0) + (.cacheRead // 0)) | max // 0), (map(.output // 0) | add // 0)] | map(tostring) | join(" ")' "$out" 2>/dev/null) ;;
  esac
  printf '%s\n' "$text" > "$answer_file"
  read -r CO_OC_TOKENS_IN CO_OC_TOKENS_OUT CO_OC_COST <<EOF
${u:-0 0}
EOF
  CO_OC_CTX_IN=$CO_OC_TOKENS_IN CO_OC_COST=${CO_OC_COST:-0}
  return 0
}

# co_http_attempt ENDPOINT TASK MODEL PROMPT_FILE ANSWER_FILE — non-explore
# tasks only (explore needs the tool loop of the TypeScript engine).
co_http_attempt() {
  local name="$1" task="$2" model="$3" prompt_file="$4" answer_file="$5"
  local ep type base key body out hdr url code timeout msg variant start
  start=$(co_now)
  CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_ERROR=""
  command -v curl >/dev/null 2>&1 || { CO_OC_ERROR="curl not found"; return $CO_E_NOOC; }
  ep=$(co_endpoint_json "$name")
  type=$(printf '%s' "$ep" | jq -r .type); base=$(printf '%s' "$ep" | jq -r .base_url)
  key=$(co_endpoint_key "$name" "$ep")
  case "$base" in *127.0.0.1*|*localhost*) ;; *) [ -z "$key" ] && { CO_OC_ERROR="no API key for $name (set $(printf '%s' "$ep" | jq -r '.api_key_env // "it"') or run offload setup)"; return $CO_E_AUTH; } ;; esac
  [ -z "$model" ] && { CO_OC_ERROR="endpoint $name needs a model id ($name:MODEL)"; return $CO_E_MODEL; }
  timeout=$(co_attempt_timeout)
  variant=$(co_cfg ".variants.$task")
  co_tmp body; co_tmp out; co_tmp hdr
  # headers go through a file so the key never shows up in `ps`
  printf '%s' "$ep" | jq -r '.headers // {} | to_entries[] | "\(.key): \(.value)"' > "$hdr" 2>/dev/null
  printf 'content-type: application/json\n' >> "$hdr"
  if [ "$type" = anthropic ]; then
    jq -n --arg m "$model" --rawfile sys "$CO_ROOT/prompts/$task.md" --rawfile p "$prompt_file" \
      '{model: $m, max_tokens: 8192, system: $sys, messages: [{role: "user", content: $p}]}' > "$body"
    printf 'anthropic-version: 2023-06-01\n' >> "$hdr"
    [ -n "$key" ] && printf 'x-api-key: %s\n' "$key" >> "$hdr"
    url="$base/v1/messages"
  else
    jq -n --arg m "$model" --arg v "$variant" --rawfile sys "$CO_ROOT/prompts/$task.md" --rawfile p "$prompt_file" \
      '{model: $m, messages: [{role: "system", content: $sys}, {role: "user", content: $p}]} + (if $v != "" then {reasoning_effort: $v} else {} end)' > "$body"
    [ -n "$key" ] && printf 'authorization: Bearer %s\n' "$key" >> "$hdr"
    url="$base/chat/completions"
  fi
  code=$(curl -sS --max-time "$timeout" -o "$out" -w '%{http_code}' -H "@$hdr" --data-binary "@$body" "$url" 2>/dev/null)
  [ "$code" = 000 ] && [ "$(co_elapsed "$start")" -ge "$timeout" ] && { CO_OC_ERROR="timed out after ${timeout}s"; return $CO_E_TIMEOUT; }
  case "$code" in
    200) ;;
    000) CO_OC_ERROR="cannot reach $base (or timed out)"; return $CO_E_WORKER ;;
    *)
      msg=$(jq -r '.error.message // .message // empty' "$out" 2>/dev/null); [ -z "$msg" ] && msg=$(head -c 200 "$out")
      CO_OC_ERROR="HTTP $code: $msg"
      case "$code" in 401|403) return $CO_E_AUTH ;; 402|429) return $CO_E_QUOTA ;; esac
      [ "$code" = 404 ] && case "$msg" in *[Mm]odel*) return $CO_E_MODEL ;; esac
      co_oc_classify "$code $msg"; return $? ;;
  esac
  if [ "$type" = anthropic ]; then
    jq -r '[.content[]? | select(.type == "text") | .text] | join("")' "$out" > "$answer_file" 2>/dev/null
    read -r CO_OC_TOKENS_IN CO_OC_TOKENS_OUT <<EOF
$(jq -r '[.usage.input_tokens // 0, .usage.output_tokens // 0] | map(tostring) | join(" ")' "$out" 2>/dev/null)
EOF
    CO_OC_CTX_IN=$(jq -r '(.usage.input_tokens // 0) + (.usage.cache_read_input_tokens // 0)' "$out" 2>/dev/null)
  else
    jq -r '.choices[0].message.content // "" | if type == "array" then map(.text // "") | join("") else . end' "$out" > "$answer_file" 2>/dev/null
    read -r CO_OC_TOKENS_IN CO_OC_TOKENS_OUT <<EOF
$(jq -r '[.usage.prompt_tokens // 0, .usage.completion_tokens // 0] | map(tostring) | join(" ")' "$out" 2>/dev/null)
EOF
  fi
  [ "$type" = anthropic ] || CO_OC_CTX_IN=$CO_OC_TOKENS_IN
  if ! grep -q '[^[:space:]]' "$answer_file" 2>/dev/null; then CO_OC_ERROR="worker returned an empty answer"; return $CO_E_WORKER; fi
  return 0
}
