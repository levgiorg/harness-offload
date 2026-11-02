# shellcheck shell=bash
# offload — OpenCode transport (supports OpenCode V1 1.x and V2 2.x).
#
# One delegation = one `opencode run --format json` against a offload-owned
# agent, prompt on stdin, agents injected via OPENCODE_CONFIG_CONTENT (merged
# over the user's own config, so their providers and logins keep working).
#
# Behaviour this file relies on (verified against opencode 1.19.5 and 2.2.5):
#   * Non-retryable failures (bad key, unknown model/agent) exit 1 and emit a
#     {"type":"error"} event — V1 {error:{name,data:{message}}},
#     V2 {error:{type:"provider.auth",message}}.
#   * Retryable failures (429, quota, overload) are retried with backoff and
#     print nothing useful: V1 logs "stream error" lines on stderr (with
#     --print-logs) and never gives up; V2 re-emits step_start events. We
#     count those and stop early so a quota wall costs seconds, not minutes.
#   * V2 `run` talks to a shared background service that never sees our env;
#     --standalone gives the run a private server that does.
#   * A tool denied with a catch-all deny is removed from the model's tools.
#
# Exit codes (also used by bin/offload):
#   0 ok · 2 usage · 10 rate limit/quota · 11 auth · 12 timeout
#   13 unknown model/provider · 14 other worker error · 15 opencode missing
#   16 nothing to send (refused by a guard)

CO_BACKENDS_LOADED=1
CO_E_USAGE=2 CO_E_QUOTA=10 CO_E_AUTH=11 CO_E_TIMEOUT=12 CO_E_MODEL=13
CO_E_WORKER=14 CO_E_NOOC=15 CO_E_REFUSED=16

# Outputs of the last co_oc_invoke / co_oc_attempt call.
CO_OC_MODEL="" CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_SECONDS=0 CO_OC_ERROR=""

# ------------------------------------------------------------ version

CO_OC_MAJOR="${CO_OC_MAJOR:-}"
# Major version of the configured opencode binary (1 or 2). `opencode
# --version` costs up to ~0.5s, so the answer is cached in the state dir for
# an hour per binary path (and per process); a CLI flag error clears it.
co_oc_major() {
  if [ -z "$CO_OC_MAJOR" ]; then
    local bin cache v="" cbin cmaj
    bin=$(co_opencode_bin)
    cache="$(co_state_dir)/opencode-version"
    if [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -60 2>/dev/null)" ]; then
      read -r cmaj cbin < "$cache" 2>/dev/null
      [ "$cbin" = "$bin" ] && v="$cmaj"
    fi
    if [ -z "$v" ]; then
      v=$("$bin" --version 2>/dev/null | tail -1 | sed -n 's/[^0-9]*\([0-9][0-9]*\)\..*/\1/p')
      case "$v" in ''|*[!0-9]*) v=1 ;; *) printf '%s %s\n' "$v" "$bin" > "$cache" 2>/dev/null ;; esac
    fi
    CO_OC_MAJOR="$v"
  fi
  printf '%s' "$CO_OC_MAJOR"
}

# ------------------------------------------------------------ model chain

# The system prompt file for a task (a running custom task supplies its own).
co_prompt_path() {
  if [ -n "${CO_TASK_SYSTEM_FILE:-}" ]; then printf '%s' "$CO_TASK_SYSTEM_FILE"; else printf '%s/prompts/%s.md' "$CO_ROOT" "$1"; fi
}

co_model_for() {
  local task="$1" m
  # a custom task's own model comes first
  [ -n "${CO_TASK_MODEL:-}" ] && { printf '%s' "$CO_TASK_MODEL"; return 0; }
  m=$(co_cfg ".models.$task")
  [ -z "$m" ] && m=$(co_cfg '.models.default')
  printf '%s' "$m"
}

# Primary model for the task, then models.fallback, de-duplicated. An empty
# primary means "the default backend's own default model" ("@default").
co_model_chain() {
  local task="$1" override="${2:-}" first
  # an explicit override (-m) is used alone, without the fallback chain
  [ -n "$override" ] && { printf '%s\n' "$override"; return 0; }
  first=$(co_model_for "$task")
  {
    printf '%s\n' "${first:-@default}"
    co_cfg_list '.models.fallback'
  } | awk 'NF && !seen[$0]++'
}

# Per-attempt timeout: opencode.timeout_seconds, capped by what is left of a
# total budget (CO_OC_DEADLINE, epoch seconds) — hooks run under host timeouts.
co_attempt_timeout() {
  local t left
  t=$(co_cfg_int '.opencode.timeout_seconds' 180)
  if [ -n "${CO_OC_DEADLINE:-}" ]; then
    left=$(( CO_OC_DEADLINE - $(co_now) ))
    [ "$left" -lt "$t" ] && t=$left
    [ "$t" -lt 1 ] && t=1
  fi
  printf '%s' "$t"
}

co_cooldown_file() {
  printf '%s/cooldowns/%s' "$(co_state_dir)" "$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_')"
}

# Prints the cooldown reason (and time left) when the model is cooling down.
co_model_cooling() {
  local f until reason
  f=$(co_cooldown_file "$1")
  [ -f "$f" ] || return 1
  read -r until reason < "$f" 2>/dev/null || return 1
  case "$until" in ''|*[!0-9]*) rm -f "$f"; return 1 ;; esac
  if [ "$until" -le "$(co_now)" ]; then rm -f "$f"; return 1; fi
  printf '%s, %ss left' "${reason:-error}" $(( until - $(co_now) ))
  return 0
}

co_model_cooldown() {
  printf '%s %s\n' $(( $(co_now) + $2 )) "$3" > "$(co_cooldown_file "$1")" 2>/dev/null || true
}

co_any_model_ready() {
  local m task
  for task in read summarize; do
    while IFS= read -r m; do
      [ -z "$m" ] && continue
      co_route "$m" "$task" 2>/dev/null || continue
      co_model_cooling "$CO_RT_REF" >/dev/null || return 0
    done <<EOF
$(co_model_chain "$task")
EOF
  done
  return 1
}

# ------------------------------------------------------------ agent config

# OPENCODE_CONFIG_CONTENT defining offload's worker agents, in the schema of
# the installed major version. Prompts live in prompts/*.md. Every agent is
# deny-by-default; only the explorer may read/grep/glob, and never files that
# match privacy.secret_globs.
co_oc_config() {
  local major steps user_cfg="${OPENCODE_CONFIG_CONTENT:-}" secrets
  major=$(co_oc_major)
  steps=$(co_cfg_int '.explore.max_steps' 40)
  secrets=$(co_config_load; printf '%s' "$CO_CONFIG" | jq -c '.privacy.secret_globs // []')
  if [ -z "$user_cfg" ] || ! printf '%s' "$user_cfg" | jq -e 'type == "object"' >/dev/null 2>&1; then
    user_cfg='{}'
  fi
  jq -n \
    --rawfile read "$(co_prompt_path read)" \
    --rawfile summarize "$(co_prompt_path summarize)" \
    --rawfile explore "$(co_prompt_path explore)" \
    --rawfile write "$(co_prompt_path write)" \
    --rawfile ask "$(co_prompt_path ask)" \
    --argjson steps "$steps" \
    --argjson secrets "$secrets" \
    --argjson user "$user_cfg" \
    --argjson major "$major" '
    def secretGlobs: ($secrets | map(., "**/" + .));
    def v1(name; prompt; temp):
      {mode: "primary", description: name, prompt: prompt, temperature: temp, permission: {"*": "deny"}};
    def v2(name; prompt):
      {mode: "primary", hidden: true, description: name, system: prompt,
       permissions: [{action: "*", resource: "*", effect: "deny"}]};
    if $major >= 2 then
      $user * {
        snapshots: false,
        agents: {
          "offload-read":      v2("offload bulk reader"; $read),
          "offload-summarize": v2("offload output digester"; $summarize),
          "offload-write":     v2("offload code writer"; $write),
          "offload-ask":       v2("offload one-shot helper"; $ask),
          "offload-explore":   (v2("offload read-only explorer"; $explore) + {steps: $steps}
            | .permissions += ([ "read", "grep", "glob" ] | map({action: ., resource: "*", effect: "allow"}))
            | .permissions += (secretGlobs | map({action: "read", resource: ., effect: "deny"})))
        }
      }
    else
      $user * {
        snapshot: false,
        agent: {
          "offload-read":      v1("offload bulk reader"; $read; 0.1),
          "offload-summarize": v1("offload output digester"; $summarize; 0.1),
          "offload-write":     v1("offload code writer"; $write; 0.2),
          "offload-ask":       v1("offload one-shot helper"; $ask; 0.3),
          "offload-explore":   (v1("offload read-only explorer"; $explore; 0.1) + {steps: $steps}
            | .permission = ({"*": "deny",
                              read: ({"*": "allow"} + (secretGlobs | map({key: ., value: "deny"}) | from_entries)),
                              grep: "allow", glob: "allow", list: "allow"}))
        }
      }
    end'
}

# --------------------------------------------------------------- invoke

# Maps an error type/message to one of the exit codes above.
co_oc_classify() {
  local msg
  msg=$(printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')
  case "$msg" in
    *provider.rate-limit*|*provider.quota*|*provider.free-limit*|*provider.go-limit*|*provider.overloaded*|\
    *"usage limit"*|*"rate limit"*|*rate_limit*|*quota*|*"too many requests"*|*429*|*overloaded*|*"limit reached"*|*"insufficient"*|*credit*)
      return $CO_E_QUOTA ;;
    *provider.auth*|*"api key"*|*api_key*|*unauthorized*|*401*|*403*|*forbidden*|*"not authenticated"*|*"log in"*|*login*|\
    *authenticat*|*"auth type"*|*"auth method"*|*"security token"*|*"invalid token"*|*"token expired"*|*"expired token"*|*"no providers configured"*|*"no provider configured"*)
      return $CO_E_AUTH ;;
    *provider.no-route*|*"model unavailable"*|*"model not found"*|*"unknown model"*|*"provider not found"*|*providermodelnotfound*|*model_not_found*|*"does not exist"*)
      return $CO_E_MODEL ;;
    *provider.timeout*|*"timed out"*)
      return $CO_E_TIMEOUT ;;
  esac
  return $CO_E_WORKER
}

# Final assistant text from a --format json event stream: the text of the
# last step that produced any (earlier steps are tool-calling chatter).
co_oc_extract_text() {
  jq -rRs '
    split("\n") | map(fromjson? // empty)
    | reduce .[] as $e ({done: [], cur: ""};
        if $e.type == "step_start" then .done += [.cur] | .cur = ""
        elif $e.type == "text" then .cur += ($e.part.text // "")
        else . end)
    | (.done + [.cur]) | map(select(explode - [32, 9, 10, 13] | length > 0)) | last // ""' "$1" 2>/dev/null
}

# "<type-or-name>: <message>" of the last error event, empty if none.
co_oc_error_message() {
  jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "error")) | last
           | if . == null then "" else
               ((.error.type // .error.name // "error") + ": " + (.error.message // .error.data.message // (.error | tostring)))
             end' "$1" 2>/dev/null
}

# Number of provider retries so far. V1: "stream error" log lines. V2: a
# step_start that follows another step_start with no step_finish between.
co_oc_retry_count() {
  local out="$1" errf="$2" n
  n=$(LC_ALL=C grep -c 'stream error' "$errf" 2>/dev/null || true)
  if [ "${n:-0}" -gt 0 ]; then printf '%s' "$n"; return; fi
  grep -oE '^\{"type":"(step_start|step_finish)"' "$out" 2>/dev/null |
    awk '/step_start/ { if (open) r++; open = 1; next } { open = 0 } END { print r + 0 }'
}

# Deletes a worker session in the background so OpenCode's session list does
# not fill up with offload runs. Fully detached: hooks must not wait on it.
co_oc_forget_session() {
  local sid="$1" bin
  [ -z "$sid" ] && return 0
  co_cfg_bool '.opencode.keep_sessions' false && return 0
  bin=$(co_opencode_bin)
  # On V2, --standalone keeps us from starting the user's background service.
  if [ "$(co_oc_major)" -ge 2 ]; then
    ( cd "$(co_state_dir)" && nohup "$bin" session delete --standalone "$sid" >/dev/null 2>&1 </dev/null & ) >/dev/null 2>&1
  else
    ( cd "$(co_state_dir)" && nohup "$bin" session delete "$sid" >/dev/null 2>&1 </dev/null & ) >/dev/null 2>&1
  fi
}

# ------------------------------------------------------------ other backends

# The TypeScript CLI: transport for what the bash engine cannot do natively
# (explore over HTTP APIs needs a tool loop). Resolution order:
# $OFFLOAD_TS_CLI, `harness-offload` on PATH, the bundled dist/cli.js, npx.
co_ts_cli() {
  if [ -n "${OFFLOAD_TS_CLI:-}" ]; then printf '%s' "$OFFLOAD_TS_CLI"; return 0; fi
  local js
  # the plugin's own bundle first (same version as this engine); then
  # `harness-offload` on PATH; a repo checkout; the npm package's marketplace
  for js in "$CO_ROOT/dist/cli.js" @path "$CO_ROOT/../../packages/cli/dist/cli.js" "$CO_ROOT/../../../../dist/cli.js"; do
    if [ "$js" = @path ]; then
      command -v harness-offload >/dev/null 2>&1 && { printf 'harness-offload'; return 0; }
    elif [ -f "$js" ] && command -v node >/dev/null 2>&1; then printf 'node %s' "$js"; return 0; fi
  done
  if command -v npx >/dev/null 2>&1; then printf 'npx --yes harness-offload@%s' "$CO_VERSION"; return 0; fi
  return 1
}

# Runs the TypeScript CLI with ARGS (paths with spaces stay intact).
co_ts_run() {
  local cli
  cli=$(co_ts_cli) || return $CO_E_NOOC
  # shellcheck disable=SC2086
  case "$cli" in
    "node "*) node "${cli#node }" "$@" ;;
    *) $cli "$@" ;;
  esac
}

# True for BACKEND:MODEL references (the prefix has no slash); OpenCode ids
# are provider/model and keep going to opencode directly.
co_is_ts_ref() {
  case "$1" in
    @default) return 1 ;;
    */*:*) return 1 ;;
    [A-Za-z0-9_-]*:*) return 0 ;;
  esac
  return 1
}

# Same contract as co_oc_attempt, through `offload worker`.
co_ts_attempt() {
  local agent="$1" model="$2" prompt_file="$3" workdir="$4" variant="$5" answer_file="$6"
  local cli errf rc line start
  CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_ERROR=""
  if ! cli=$(co_ts_cli); then
    CO_OC_ERROR="backend for $model needs the harness-offload CLI (npm i -g harness-offload) or node"
    return $CO_E_NOOC
  fi
  co_tmp errf
  start=$(co_now)
  co_ts_run worker --task "${agent#offload-}" --cwd "$workdir" --model "$model" ${variant:+--variant "$variant"} \
    ${CO_TASK_SYSTEM_FILE:+--system-file "$CO_TASK_SYSTEM_FILE"} \
    --timeout "$(co_attempt_timeout)" < "$prompt_file" > "$answer_file" 2> "$errf"
  rc=$?
  CO_OC_SECONDS=$(co_elapsed "$start")
  if [ "$rc" = 0 ]; then
    line=$(grep '^OFFLOAD_WORKER ' "$errf" | tail -1 | sed 's/^OFFLOAD_WORKER //')
    read -r CO_OC_TOKENS_IN CO_OC_TOKENS_OUT CO_OC_CTX_IN CO_OC_COST <<EOF2
$(printf '%s' "$line" | jq -r '[.tokens_in // 0, .tokens_out // 0, .ctx_in // 0, .cost // 0] | map(tostring) | join(" ")' 2>/dev/null)
EOF2
    [ -s "$answer_file" ] && return 0
    CO_OC_ERROR="worker returned an empty answer"
    return $CO_E_WORKER
  fi
  line=$(grep '^OFFLOAD_WORKER_ERROR ' "$errf" | tail -1 | sed 's/^OFFLOAD_WORKER_ERROR //')
  CO_OC_ERROR=$(printf '%s' "$line" | jq -r '.message // empty' 2>/dev/null)
  [ -z "$CO_OC_ERROR" ] && CO_OC_ERROR=$(tail -c 300 "$errf")
  case "$rc" in 2|10|11|12|13|14|15|16) return "$rc" ;; esac
  return $CO_E_WORKER
}

# One attempt against one model reference; writes the answer to answer_file.
# Routes by reference (see co_route in agents.sh): OpenCode, a CLI agent on
# the user's own plan (claude/codex/gemini/cursor/pi), an HTTP API via curl,
# or the TypeScript engine. Args: agent ref prompt_file workdir variant answer_file
co_oc_attempt() {
  local agent="$1" ref="$2" prompt_file="$3" workdir="$4" variant="$5" answer_file="$6" start rc
  CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_ERROR=""
  co_route "$ref" "${agent#offload-}" || return $?
  start=$(co_now)
  case "$CO_RT_KIND" in
    opencode) co_opencode_attempt "$agent" "${CO_RT_MODEL:-@default}" "$prompt_file" "$workdir" "$variant" "$answer_file" ;;
    agent)    co_agent_attempt "$CO_RT_BACKEND" "${agent#offload-}" "$CO_RT_MODEL" "$prompt_file" "$workdir" "$variant" "$answer_file" ;;
    http)     co_http_attempt "$CO_RT_BACKEND" "${agent#offload-}" "$CO_RT_MODEL" "$prompt_file" "$answer_file" ;;
    *)        co_ts_attempt "$agent" "$CO_RT_REF" "$prompt_file" "$workdir" "$variant" "$answer_file" ;;
  esac
  rc=$?
  CO_OC_SECONDS=$(co_elapsed "$start")
  return $rc
}

# One `opencode run`. Args: agent model(or @default) prompt_file workdir variant answer_file
co_opencode_attempt() {
  local agent="$1" model="$2" prompt_file="$3" workdir="$4" variant="$5" answer_file="$6"
  if ! co_have_opencode; then
    CO_OC_ERROR="opencode CLI not found ($(co_opencode_bin)). Install it from https://opencode.ai, set opencode.bin, or pick another backend (offload setup)."
    return $CO_E_NOOC
  fi
  local bin major timeout max_err out errf pid start rc n sid msg text cfg
  bin=$(co_opencode_bin)
  major=$(co_oc_major)
  timeout=$(co_attempt_timeout)
  max_err=$(co_cfg_int '.opencode.max_stream_errors' 2)
  co_tmp out; co_tmp errf
  CO_OC_TOKENS_IN=0 CO_OC_TOKENS_OUT=0 CO_OC_CTX_IN=0 CO_OC_COST=0 CO_OC_ERROR=""

  local -a args
  args=(run --format json --agent "$agent" --title "offload:${agent#offload-}")
  if [ "$major" -ge 2 ]; then
    args+=(--standalone)
    if [ "$model" != "@default" ]; then
      if [ -n "$variant" ]; then args+=(-m "$model#$variant"); else args+=(-m "$model"); fi
    fi
  else
    args+=(--print-logs --log-level ERROR)
    [ "$model" != "@default" ] && args+=(-m "$model")
    [ -n "$variant" ] && args+=(--variant "$variant")
  fi

  cfg=$(co_oc_config) || { CO_OC_ERROR="could not build the worker config (jq failed)"; return $CO_E_WORKER; }

  start=$(co_now)
  (
    cd "$workdir" 2>/dev/null || exit 1
    PWD="$workdir"; export PWD
    if co_cfg_bool '.opencode.disable_claude_code_compat' true; then export OPENCODE_DISABLE_CLAUDE_CODE=1; fi
    OPENCODE_CONFIG_CONTENT="$cfg" OPENCODE_DISABLE_AUTOUPDATE=1 OFFLOAD_DISABLE=1 \
      exec "$bin" "${args[@]}" < "$prompt_file" > "$out" 2> "$errf"
  ) &
  pid=$!

  # A watchdog enforces the deadline and the retry limit in the background;
  # this shell just waits, so the answer is picked up the moment the worker
  # exits (polling here added up to 0.3 s to every call).
  local why wd
  co_tmp why
  (
    trap 'exit 0' TERM
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$(co_elapsed "$start")" -ge "$timeout" ]; then
        printf 'timeout\n' > "$why"
        kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null
        exit 0
      fi
      n=$(co_oc_retry_count "$out" "$errf")
      if [ "${n:-0}" -ge "$max_err" ]; then
        printf 'retries %s\n' "$n" > "$why"
        kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null
        exit 0
      fi
      # (sleep in the background: a TERM is then handled at once, not after it)
      sleep 0.3 & wait $!
    done
  ) </dev/null >/dev/null 2>&1 &
  # (no inherited stdout: a hook's caller waits until every holder closes it)
  wd=$!
  wait "$pid"; rc=$?
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  case "$(cat "$why" 2>/dev/null)" in
    timeout)
      CO_OC_ERROR="timed out after ${timeout}s"
      rc=$CO_E_TIMEOUT ;;
    "retries "*)
      n=$(cat "$why"); n=${n#retries }
      msg=$(LC_ALL=C grep 'stream error' "$errf" 2>/dev/null | tail -1 | LC_ALL=C sed -n 's/.*error\.error="\([^"]*\).*/\1/p')
      CO_OC_ERROR="provider kept failing and retrying (${n} retries): ${msg:-likely rate limit, quota or overload}"
      co_oc_classify "${msg:-rate limit}"; rc=$? ;;
  esac
  CO_OC_SECONDS=$(co_elapsed "$start")

  sid=$(grep -o '"sessionID":"ses_[A-Za-z0-9_]*"' "$out" 2>/dev/null | head -1 | sed 's/.*"\(ses_[^"]*\)"/\1/')
  [ -z "$sid" ] && sid=$(sed -n 's/.*session\.id=\(ses_[A-Za-z0-9]*\).*/\1/p' "$errf" 2>/dev/null | head -1)
  co_oc_forget_session "$sid"

  case "$rc" in "$CO_E_TIMEOUT"|"$CO_E_QUOTA"|"$CO_E_AUTH"|"$CO_E_MODEL") return "$rc" ;; esac

  msg=$(co_oc_error_message "$out")
  if [ -n "$msg" ] || [ "$rc" != 0 ]; then
    [ -z "$msg" ] && msg=$(LC_ALL=C grep -E 'level=ERROR' "$errf" 2>/dev/null | tail -1 | LC_ALL=C sed -n 's/.*error="\([^"]*\).*/\1/p')
    [ -z "$msg" ] && msg=$(grep -v '^timestamp=' "$errf" 2>/dev/null | tail -c 400)
    case "$msg" in
      *"nknown argument"*|*"nknown option"*|*"nknown flag"*|*"nrecognized"*)
        # Probably an opencode upgrade/downgrade behind a cached version.
        rm -f "$(co_state_dir)/opencode-version" 2>/dev/null; CO_OC_MAJOR=""
        msg="$msg (opencode version changed? cleared the cache — run again)" ;;
    esac
    CO_OC_ERROR="${msg:-opencode exited with status $rc}"
    case "$CO_OC_ERROR" in
      *"Unexpected server error"*)
        CO_OC_ERROR="$CO_OC_ERROR (V1 reports unknown model ids this way — check \`opencode models\`)"
        return $CO_E_MODEL ;;
      *"Agent not found"*)
        CO_OC_ERROR="$CO_OC_ERROR (opencode ignored offload's agent config — run \`offload doctor\`)"
        return $CO_E_WORKER ;;
    esac
    co_oc_classify "$CO_OC_ERROR"
    return $?
  fi

  text=$(co_oc_extract_text "$out")
  if [ -z "$text" ]; then
    CO_OC_ERROR="worker returned an empty answer"
    return $CO_E_WORKER
  fi
  # Totals across steps, plus the last step's prompt size (≈ how much context
  # the worker had to hold — what Claude would otherwise have read).
  read -r CO_OC_TOKENS_IN CO_OC_TOKENS_OUT CO_OC_CTX_IN CO_OC_COST <<EOF
$(jq -rRs 'split("\n") | map(fromjson? // empty) | map(select(.type == "step_finish") | .part) as $s
  | [ ($s | map(.tokens.input // 0) | add // 0),
      ($s | map(.tokens.output // 0) | add // 0),
      (($s | last // {}) | ((.tokens.input // 0) + (.tokens.cache.read // 0))),
      ($s | map(.cost // 0) | add // 0) ] | map(tostring) | join(" ")' "$out" 2>/dev/null)
EOF
  printf '%s\n' "$text" > "$answer_file"
  return 0
}

# co_oc_invoke <task> <prompt_file> <workdir> <answer_file> [model_override]
# Walks the model chain, skipping models in cooldown and cooling down models
# that fail for quota/auth/model reasons. Writes the answer to answer_file and
# sets CO_OC_* (call it directly, not in $(...), or those are lost).
co_oc_invoke() {
  local task="$1" prompt_file="$2" workdir="$3" answer_file="$4" override="${5:-}"
  local agent="offload-$task" variant model rc=$CO_E_WORKER cool tried="" errors=""
  CO_OC_MODEL="" CO_OC_ERROR=""
  variant=$(co_cfg ".variants.$task")

  while IFS= read -r model; do
    [ -z "$model" ] && continue
    # @host → the calling harness's own model, resolved before cooldowns so
    # they are kept per real model
    if ! co_route "$model" "$task"; then
      errors="${errors}  - $model: $CO_OC_ERROR
"
      rc=$CO_E_USAGE
      continue
    fi
    model="$CO_RT_REF"
    if [ -z "$override" ] && cool=$(co_model_cooling "$model"); then
      errors="${errors}  - $model: skipped, cooling down ($cool)
"
      continue
    fi
    if [ -n "${CO_OC_DEADLINE:-}" ] && [ $(( CO_OC_DEADLINE - $(co_now) )) -lt 3 ]; then
      errors="${errors}  - $model: skipped, time budget used up
"
      rc=$CO_E_TIMEOUT
      break
    fi
    tried="$tried $model"
    co_oc_attempt "$agent" "$model" "$prompt_file" "$workdir" "$variant" "$answer_file"
    rc=$?
    if [ "$rc" = 0 ]; then
      # answers can quote what a worker read (an explore agent may have opened
      # .env); generated code is left alone (its fixtures are not secrets)
      if [ "$task" != write ]; then co_redact < "$answer_file" > "$answer_file.r" && mv "$answer_file.r" "$answer_file"; fi
      CO_OC_MODEL="$model"
      [ "$model" = "@default" ] && CO_OC_MODEL="opencode-default-model"
      return 0
    fi
    errors="${errors}  - $model: $CO_OC_ERROR
"
    case "$rc" in
      "$CO_E_QUOTA") co_model_cooldown "$model" 300  "rate-limit/quota" ;;
      "$CO_E_AUTH")  co_model_cooldown "$model" 1800 "auth" ;;
      "$CO_E_MODEL") co_model_cooldown "$model" 3600 "unknown-model" ;;
    esac
  done <<EOF
$(co_model_chain "$task" "$override")
EOF

  if [ -z "$tried" ] && { [ "$rc" = "$CO_E_USAGE" ] || [ "$rc" = "$CO_E_TIMEOUT" ]; }; then
    CO_OC_ERROR="no usable model:
$errors"
    return "$rc"
  fi
  if [ -z "$tried" ]; then
    CO_OC_ERROR="every configured model is cooling down after errors:
${errors}(\`offload doctor --reset\` clears cooldowns)"
    return $CO_E_QUOTA
  fi
  CO_OC_ERROR="no model succeeded:
$errors"
  return "$rc"
}

# shellcheck source=agents.sh
. "$CO_ROOT/lib/agents.sh"
