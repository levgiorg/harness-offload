# shellcheck shell=bash
# offload — digest of long command output.
#
# Deterministic first, model second: the verbatim error lines and the tail
# come from awk, so even a bad or missing model summary cannot hide a
# failure. The cheap model only adds a STATUS line and a grouped overview.

# Lines that usually matter in build/test/install output.
CO_KEY_RE='[a-z0-9_)/-][.][a-z][a-z]*:[0-9][0-9]*|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|cannot |can.t |undefined reference|no such file|permission denied|timed out|timeout|unresolved|not found|denied|refused|abort|killed|out of memory|oom|●|^[[:space:]]*(expected|received):'
# ...unless they are clearly reporting zero problems.
CO_ZERO_RE='(^|[^0-9])0 (errors?|failures?|failed|problems?)|(errors?|failures?|failed)[[:space:]]*[:=][[:space:]]*0([^0-9]|$)|no errors|without errors|0 vulnerabilities'

co_work_dir() {
  local d
  d="$(co_state_dir)/work"
  mkdir -p "$d" 2>/dev/null
  printf '%s' "$d"
}

# Stack frames in libraries, test runners and the runtime: they fill key lines and say
# nothing about the project's code, so they are counted, not shown.
CO_FRAME_RE='^[ \t]*(at |File "|/)'
CO_LIBFRAME_RE='node_modules/|site-packages/|dist-packages/|/lib/python[0-9.]*/|<frozen |node:internal|[(]node:|java[.]base/|jdk[.]internal|at (java|javax|sun|jdk|kotlin|scala)[.]|at org[.](junit|apache|gradle|springframework)[.]|at junit[.]|/go/src/(runtime|testing)/|/rustc/'

# Of the key lines, the ones that mean something broke.
CO_STRONG_RE='●|error|fail|exception|traceback|panic|fatal|segmentation fault|segfault|assert|✗|✘|✖|err!|undefined reference|abort|killed|out of memory'

# co_key_lines <file> <max> [countfile] — "L<n>: text" for matching lines. Lines that
# differ only in numbers are one kind ("(N similar lines)"; exact repeats "(xN)"), so
# 600 warnings can't push a real error out: error-like kinds get the slots first (up to
# 3 lines each), the rest one line each; then they print in log order, and one row says
# how many distinct lines were left out. The number of distinct lines goes to countfile.
# Twin: keyLines() in digest.ts.
co_key_lines() {
  LC_ALL=C awk -v key="$CO_KEY_RE" -v zero="$CO_ZERO_RE" -v strong="$CO_STRONG_RE" -v frame="$CO_FRAME_RE" -v lib="$CO_LIBFRAME_RE" -v max="$2" -v countfile="${3:-/dev/null}" '
    {
      l = tolower($0)
      if (l !~ key || l ~ zero) next
      if ($0 ~ frame && $0 ~ lib) { libf++; next }
      t = $0
      gsub(/\033\[[0-9;]*[A-Za-z]/, "", t)      # strip ANSI colours
      sub(/[ \t\r]+$/, "", t)
      if (t == "") next
      k = t; gsub(/[0-9]+/, "#", k)
      if (!(k in kc)) { nk++; korder[nk] = k; kc[k] = 0; kd[k] = 0; ks[k] = (l ~ strong) }
      kc[k]++
      if (t in seen) next
      seen[t] = NR; nd++; kd[k]++
      if (kd[k] <= 3) { ki[k, kd[k]] = t }
    }
    END {
      left = max + 0
      for (pass = 1; pass <= 2; pass++)
        for (i = 1; i <= nk && left > 0; i++) {
          k = korder[i]
          if ((pass == 1) != (ks[k] == 1)) continue
          want = (pass == 1 ? 3 : 1); if (want > kd[k]) want = kd[k]; if (want > left) want = left
          take[k] = want; left -= want
        }
      ns = 0
      for (i = 1; i <= nk; i++) {
        k = korder[i]
        for (j = 1; j <= take[k]; j++) {
          t = ki[k, j]; s = t
          if (length(s) > 240) s = substr(s, 1, 237) "..."
          if (j == take[k] && kd[k] == 1 && kc[k] > 1) s = s "  (x" kc[k] ")"
          else if (j == take[k] && kc[k] > take[k] && kd[k] > 1) s = s "  (" kc[k] " similar lines)"
          ns++; sl[ns] = seen[t]; st[ns] = s
        }
      }
      for (i = 2; i <= ns; i++) { a = sl[i]; b = st[i]; j = i - 1; while (j >= 1 && sl[j] > a) { sl[j + 1] = sl[j]; st[j + 1] = st[j]; j-- } sl[j + 1] = a; st[j + 1] = b }
      for (i = 1; i <= ns; i++) printf "L%d: %s\n", sl[i], st[i]
      if (nd > ns) printf "... %d more distinct matching lines\n", nd - ns
      if (libf > 0) printf "... %d stack frames in libraries and the runtime left out\n", libf
      printf "%d\n", nd > countfile
    }' "$1" 2>/dev/null
}

# Excerpt for the model when the log is too large to send whole: head, every
# key line with a little context, and the tail.
co_log_excerpt() {
  local f="$1" total
  total=$(co_file_lines "$f")
  LC_ALL=C awk -v key="$CO_KEY_RE" -v zero="$CO_ZERO_RE" -v total="$total" '
    { line[NR] = $0; l = tolower($0); if (l ~ key && l !~ zero) hit[NR] = 1 }
    END {
      for (i = 1; i <= total; i++) {
        keep = (i <= 150 || i > total - 300)
        if (!keep) for (j = i - 2; j <= i + 2; j++) if (j in hit) { keep = 1; break }
        if (keep && kept < 1500) {
          if (gap) { printf "[... %d lines omitted ...]\n", gap; gap = 0 }
          print line[i]; kept++
        } else gap++
      }
      if (gap) printf "[... %d lines omitted ...]\n", gap
    }' "$f"
}

# co_digest <log_file> <label> <exit_code|""> <focus> <source>
# Prints the digest. <source> is recorded in stats (run|hook|summarize).
co_digest() {
  local log="$1" label code="$3" focus="$4" source="$5"
  # a command line can carry credentials (FOO_KEY=… cmd): never send/store them
  label=$(printf '%s' "$2" | co_redact)
  local lines bytes kb key_max tail_n keyf keycount prompt answer status_line
  local use_model model_note="" summary="" max_in t0
  lines=$(co_file_lines "$log")
  bytes=$(co_file_bytes "$log")
  kb=$(( (bytes + 1023) / 1024 ))
  key_max=$(co_cfg_int '.digest.key_lines' 30)
  tail_n=$(co_cfg_int '.digest.tail_lines' 15)
  # Compact mode (when Claude will only see a ~2KB preview): fewer, shorter lines.
  local sum_max=40 width=300
  if [ "${OFFLOAD_DIGEST_COMPACT:-}" = 1 ]; then key_max=10; tail_n=4; sum_max=10; width=150; fi
  max_in=$(co_cfg_int '.digest.max_model_input_bytes' 400000)
  t0=$(co_now)

  co_tmp keyf
  co_key_lines "$log" "$key_max" "$keyf.n" > "$keyf"
  keycount=$(cat "$keyf.n" 2>/dev/null); rm -f "$keyf.n"
  case "$keycount" in ''|*[!0-9]*) keycount=0 ;; esac

  use_model=false
  co_cfg_bool '.digest.use_model' true && use_model=true
  [ "${OFFLOAD_NO_MODEL:-}" = 1 ] && use_model=false

  if $use_model; then
    co_tmp prompt; co_tmp answer
    {
      printf '<command>%s</command>\n' "$label"
      [ -n "$code" ] && printf '<exit_code>%s</exit_code>\n' "$code"
      [ -n "$focus" ] && printf '<focus>%s</focus>\n' "$focus"
      printf '<output lines="%s" bytes="%s">\n' "$lines" "$bytes"
      if [ "$bytes" -le "$max_in" ]; then cat "$log"; else co_log_excerpt "$log"; fi | co_redact
      printf '</output>\n'
    } > "$prompt"
    co_backends
    if co_oc_invoke summarize "$prompt" "$(co_work_dir)" "$answer" "${OFFLOAD_MODEL_OVERRIDE:-}"; then
      summary=$(LC_ALL=C awk -v m="$sum_max" -v w="$width" 'NR <= m { print (length($0) > w ? substr($0, 1, w - 3) "..." : $0) }' "$answer")
      model_note="$CO_OC_MODEL"
    else
      model_note="unavailable: $(printf '%s' "$CO_OC_ERROR" | head -2 | LC_ALL=C tr '\n' ' ' | LC_ALL=C cut -c1-200)"
    fi
  fi

  status_line="[offload] \`$(printf '%s' "$label" | LC_ALL=C cut -c1-120)\`"
  [ -n "$code" ] && status_line="$status_line → exit $code"
  status_line="$status_line · $(co_fmt_int "$lines") lines / ${kb} KB · full log: $log"

  _sc_summary_section() {
    if [ -n "$summary" ]; then
      printf -- '── summary by %s (cheap model; trust the verbatim lines over it) ──\n' "$model_note"
      printf '%s\n' "$summary"
    elif [ -n "$model_note" ]; then
      printf -- '── model summary %s ──\n' "$model_note"
    fi
  }
  _sc_key_section() {
    if [ "$keycount" -gt 0 ]; then
      printf -- '── key lines, verbatim (%s distinct) ──\n' "$keycount"
      LC_ALL=C cut -c1-"$width" "$keyf"
    else
      printf -- '── no error-like lines found ──\n'
    fi
  }
  {
    printf '%s\n' "$status_line"
    # Compact digests are cut to a 2KB preview by Claude Code: the verbatim
    # lines go first there, since they are the part that must survive.
    if [ "${OFFLOAD_DIGEST_COMPACT:-}" = 1 ]; then _sc_key_section; _sc_summary_section
    else _sc_summary_section; _sc_key_section; fi
    [ -z "$summary" ] && [ "${OFFLOAD_DIGEST_COMPACT:-}" != 1 ] && tail_n=$(( tail_n + 10 ))
    printf -- '── last %s lines ──\n' "$tail_n"
    tail -n "$tail_n" "$log" | LC_ALL=C sed -e "s/$(printf '\033')\[[0-9;]*[A-Za-z]//g" | LC_ALL=C cut -c1-"$width"
    printf -- '── more: grep -n -iE "error|fail" %s | head -50   ·   sed -n "START,ENDp" %s\n' "$(co_shquote "$log")" "$(co_shquote "$log")"
  } > "$keyf.out"

  local out_bytes
  out_bytes=$(co_file_bytes "$keyf.out")
  cat "$keyf.out"
  rm -f "$keyf.out"

  co_stats_append "$(jq -nc --arg src "$source" --arg model "${CO_OC_MODEL:-}" --arg lbl "$label" --arg log "$log" \
    --argjson bin "$bytes" --argjson bout "$out_bytes" --argjson secs "$(co_elapsed "$t0")" \
    --argjson ok "$([ -n "$summary" ] && echo true || echo false)" \
    --argjson tried "$use_model" \
    --argjson tin "${CO_OC_TOKENS_IN:-0}" --argjson tout "${CO_OC_TOKENS_OUT:-0}" \
    '{ts: now | floor, kind: "digest", source: $src, label: $lbl, log: $log, model: $model, bytes_in: $bin, bytes_out: $bout,
      saved_tokens: ((($bin - $bout) / 4) | floor | if . < 0 then 0 else . end), seconds: $secs, model_ok: $ok, model_tried: $tried,
      worker_tokens_in: $tin, worker_tokens_out: $tout}')"
  co_prune_logs
}

# New log file path for a label.
# The process id keeps two runs of the same command in the same second (parallel
# agents) from writing over each other's log.
co_new_log() {
  printf '%s/logs/%s-%s-%s.log' "$(co_state_dir)" "$(date +%Y%m%d-%H%M%S)" "$(co_slug "$(printf '%s' "$1" | co_redact)")" "$$"
}

# co_search_view <log> <label> <source> — what the agent sees instead of a huge
# search result (grep/rg/find…): counts per file (or per folder for path lists),
# the first matches of the busiest files, and how to narrow it. Deterministic and
# instant (no model). Twin: searchView() in digest.ts — keep the output identical.
co_search_view() {
  local log="$1" label lines bytes kb out t0
  label=$(printf '%s' "$2" | co_redact)
  lines=$(co_file_lines "$log"); bytes=$(co_file_bytes "$log"); kb=$(( (bytes + 1023) / 1024 ))
  t0=$(co_now)
  co_tmp out
  LC_ALL=C awk -v label="$(printf '%s' "$label" | LC_ALL=C cut -c1-120)" -v nlines="$(co_fmt_int "$lines")" \
    -v kb="$kb" -v logq="$(co_shquote "$log")" -v logp="$log" '
    function cut(s) { return length(s) > 200 ? substr(s, 1, 197) "..." : s }
    function pathy(p) { return p != "" && p !~ /[ \t]/ && (p ~ /\// || p ~ /\.[A-Za-z0-9]+$/) }
    function fmt(n,    s) { s = n ""; while (s ~ /[0-9][0-9][0-9][0-9]/) sub(/[0-9][0-9][0-9]($|,)/, ",&", s); return s }
    function add(kind, key, line) {
      if (!((kind, key) in cnt)) { ng[kind]++; at[kind, ng[kind]] = key }
      cnt[kind, key]++
      if (cnt[kind, key] <= 2) first[kind, key, cnt[kind, key]] = line
    }
    {
      t = $0; gsub(/\033\[[0-9;]*[A-Za-z]/, "", t); sub(/\r$/, "", t)
      if (t == "") next
      n++
      if (n <= 40) head[n] = t
      tail[n % 10] = t
      c = index(t, ":"); p = (c > 1 ? substr(t, 1, c - 1) : "")
      if (pathy(p)) { nm++; add("m", p, t) }
      else if (pathy(t)) { np++; d = t; if (!sub(/\/[^\/]*$/, "", d)) d = "."; add("d", d, t) }
    }
    function list(kind, unit, what,    k, i, j, best, key, shown, rest, restn) {
      for (k = 1; k <= ng[kind]; k++) used[kind, k] = 0
      shown = (ng[kind] < 20 ? ng[kind] : 20)
      printf "── %s per %s (%s %ss) ──\n", what, unit, fmt(ng[kind]), unit
      for (j = 1; j <= shown; j++) {
        best = 0
        for (k = 1; k <= ng[kind]; k++) if (!used[kind, k] && (best == 0 || cnt[kind, at[kind, k]] > cnt[kind, at[kind, best]])) best = k
        used[kind, best] = 1; top[j] = at[kind, best]
        printf "%7d  %s\n", cnt[kind, top[j]], cut(top[j])
      }
      if (ng[kind] > shown) {
        rest = 0; restn = ng[kind] - shown
        for (k = 1; k <= ng[kind]; k++) if (!used[kind, k]) rest += cnt[kind, at[kind, k]]
        printf "      … %s more %ss, %s %s\n", fmt(restn), unit, fmt(rest), what
      }
      printf "── first %s in the top %d %ss ──\n", what, (shown < 10 ? shown : 10), unit
      for (j = 1; j <= shown && j <= 10; j++)
        for (i = 1; i <= 2 && i <= cnt[kind, top[j]]; i++) print cut(first[kind, top[j], i])
    }
    END {
      if (nm * 10 >= n * 6) mode = "m"; else if (np * 10 >= n * 6) mode = "d"; else mode = "l"
      s = "[offload] `" label "` · " nlines " lines / " kb " KB"
      if (mode == "m") s = s " · " fmt(nm) " matches in " fmt(ng["m"]) " files"
      if (mode == "d") s = s " · " fmt(np) " paths in " fmt(ng["d"]) " folders"
      print s " · full log: " logp
      if (mode == "m") list("m", "file", "matches")
      else if (mode == "d") list("d", "folder", "paths")
      else {
        print "── first " (n < 40 ? n : 40) " lines ──"
        for (i = 1; i <= n && i <= 40; i++) print cut(head[i])
        if (n > 40) {
          print "── last " (n - 40 < 10 ? n - 40 : 10) " lines ──"
          for (i = (n - 9 > 41 ? n - 9 : 41); i <= n; i++) print cut(tail[i % 10])
        }
      }
      print "── narrow it: a path or a sharper pattern; counts: grep -c / rg -c; the rest: sed -n \"START,ENDp\" " logq "; or ask: offload read -q \"QUESTION\" FILE ──"
    }' "$log" > "$out"
  cat "$out"
  co_stats_append "$(jq -nc --arg lbl "$label" --arg log "$log" --argjson bin "$bytes" --argjson bout "$(co_file_bytes "$out")" \
    --argjson secs "$(co_elapsed "$t0")" \
    '{ts: now | floor, kind: "digest", source: "search", label: $lbl, log: $log, model: "", bytes_in: $bin, bytes_out: $bout,
      saved_tokens: ((($bin - $bout) / 4) | floor | if . < 0 then 0 else . end), seconds: $secs, model_ok: false, model_tried: false,
      worker_tokens_in: 0, worker_tokens_out: 0}')"
  co_prune_logs
}
