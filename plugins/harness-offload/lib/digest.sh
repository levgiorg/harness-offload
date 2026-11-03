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

# co_key_texts <file> — every distinct key-line text (same filters and truncation as
# co_key_lines), in log order: what a later run is compared with. Twin: keyTexts().
co_key_texts() {
  LC_ALL=C awk -v key="$CO_KEY_RE" -v zero="$CO_ZERO_RE" -v frame="$CO_FRAME_RE" -v lib="$CO_LIBFRAME_RE" '
    {
      l = tolower($0)
      if (l !~ key || l ~ zero) next
      if ($0 ~ frame && $0 ~ lib) next
      t = $0
      gsub(/\033\[[0-9;]*[A-Za-z]/, "", t)
      sub(/[ \t\r]+$/, "", t)
      if (t == "") next
      if (length(t) > 240) t = substr(t, 1, 237) "..."
      if (!(t in seen)) { seen[t] = 1; print t }
    }' "$1" 2>/dev/null
}

# co_key_changes <shown-key-lines> <this-log> <previous-log> <HH:MM:SS> — the key-line
# section of a re-run: only lines that are new since the previous run, with counts of
# unchanged and gone ones (and the first gone ones: what was fixed). Twin: keyChanges().
co_key_changes() {
  local cur prev
  co_tmp cur; co_tmp prev
  co_key_texts "$2" > "$cur"; co_key_texts "$3" > "$prev"
  LC_ALL=C awk -v pf="$prev" -v cf="$cur" -v at="$4" '
    FILENAME == pf { if (!($0 in P)) { P[$0] = 1; np++; po[np] = $0 }; next }
    FILENAME == cf { C[$0] = 1; next }
    /^L[0-9]+: / {
      t = $0; sub(/^L[0-9]+: /, "", t); sub(/  \(x[0-9]+\)$/, "", t); sub(/  \([0-9]+ similar lines\)$/, "", t)
      if (t in P) u++; else { n++; nl[n] = $0 }
      next
    }
    END {
      for (i = 1; i <= np; i++) if (!(po[i] in C)) { g++; if (g <= 5) gl[g] = po[i] }
      printf "── key lines since the run at %s: %d new, %d unchanged, %d gone ──\n", at, n, u, g
      for (i = 1; i <= n; i++) print nl[i]
      if (n == 0) print "(no new error-like lines)"
      if (g > 0) { print "gone since then:"; for (i = 1; i <= g && i <= 5; i++) print "  - " gl[i]; if (g > 5) printf "  … %d more\n", g - 5 }
    }' "$prev" "$cur" "$1"
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
# co_fail_blocks LOG MAX_BLOCKS MAX_LINES WIDTH — each failing test's own block,
# verbatim, for the common runners: jest (● name), vitest (FAIL file > name),
# pytest (____ name ____), go test (--- FAIL:), cargo (---- name stdout ----).
# The first line carries its line number; a long block ends with how to see the
# rest. Prints nothing when there is no such block. Twin: failBlocks in digest.ts.
co_fail_blocks() {
  LC_ALL=C awk -v maxb="$2" -v maxl="$3" -v w="$4" -v logq="$(co_shquote "$1")" '
    function ind(line) { match(line, /^[ \t]*/); return RLENGTH }
    function startkind(s) {
      if (s ~ /^[ \t]*● /) return "j"
      if (s ~ /^[ \t]*FAIL[ \t]+[^ \t].* > /) return "v"
      if (s ~ /^___+ .* ___+[ \t]*$/) return "p"
      if (s ~ /^[ \t]*--- FAIL: /) return "g"
      if (s ~ /^---- .* stdout ----[ \t]*$/) return "c"
      return ""
    }
    function cont(s) {
      if (kind == "j") return s ~ /^[ \t]*$/ || s ~ /^[ \t]/
      if (kind == "v") return s !~ /^[ \t]*$/ && s !~ /^[ \t]*(Test Files|Tests|Duration|Start at|Snapshots) /
      if (kind == "p") return s !~ /^(___+ |===+)/
      if (kind == "g") return s !~ /^[ \t]*$/ && ind(s) > base
      return s !~ /^[ \t]*$/
    }
    function flush(    k) {
      if (kind == "") return
      n = last
      if (!(b[1] in seen)) {
        seen[b[1]] = 1; nb++
        if (nb <= maxb) {
          out = out "L" first ": " substr(b[1], 1, w) "\n"
          for (k = 2; k <= n && k <= maxl; k++) out = out substr(b[k], 1, w) "\n"
          if (n > maxl) out = out "  … " (n - maxl) " more lines: sed -n \"" (first + maxl) "," (first + n - 1) "p\" " logq "\n"
        }
      }
      kind = ""; n = last = 0
    }
    {
      s = $0; gsub(/\033\[[0-9;]*[A-Za-z]/, "", s); sub(/\r$/, "", s)
      k = startkind(s)
      # a go parent whose only content is a failing subtest: the subtest says it all
      if (k == "g" && kind == "g" && last == 1 && ind(s) > base) kind = ""
      if (k != "") { flush(); kind = k; base = ind(s); first = NR; n = last = 1; b[1] = s; next }
      if (kind == "") next
      if (!cont(s)) { flush(); next }
      n++; if (s !~ /^[ \t]*$/) last = n
      if (n <= maxl) b[n] = s
    }
    END {
      flush()
      if (nb == 0) exit
      printf "── failures, verbatim (%d) ──\n%s", nb, out
      if (nb > maxb) printf "… %d more failures in the full log\n", nb - maxb
    }' "$1"
}

# co_intent_windows LOG QUESTION WIDTH — up to 3 windows of the log (2 lines before to
# 4 after the best line) that best match the question, without a model. Lines and the
# question are split into tokens (ASCII, case-insensitive); a word of the question matches
# the tokens it starts ("fail" → "failed"), a number only the same number. A line scores
# the sum of its matched terms' weights, lines ÷ lines-with-the-term (rare terms count
# most); ties go to the earlier line. Integer arithmetic only, so both engines rank the
# same. Prints nothing when no line matches. Twin: intentWindows in digest.ts.
co_intent_windows() {
  CO_Q="$2" LC_ALL=C awk -v w="$3" '
    function has(l, t,    n, k, i) {
      n = split(l, tk, /[^a-z0-9_]+/)
      for (k = 1; k <= nt; k++) {
        hit[k] = 0
        for (i = 1; i <= n; i++) {
          if (isnum[k] ? tk[i] == term[k] : substr(tk[i], 1, length(term[k])) == term[k]) { hit[k] = 1; break }
        }
      }
    }
    BEGIN {
      q = ENVIRON["CO_Q"]
      ns = split("the and for why what does how with from this that are was not did which where when there into its were have has had you your can could should would will just only also than then them they our out about after before over under", sw, " ")
      for (i = 1; i <= ns; i++) stop[sw[i]] = 1
      m = split(tolower(q), raw, /[^a-z0-9_]+/)
      for (i = 1; i <= m; i++) {
        r = raw[i]
        if (r == "" || (r in stop) || (r in seen)) continue
        if (r ~ /^[0-9]+$/) { seen[r] = 1; nt++; term[nt] = r; isnum[nt] = 1 }
        else if (length(r) >= 3) { seen[r] = 1; nt++; term[nt] = r; isnum[nt] = 0 }
      }
    }
    FNR == NR {
      total = NR
      if (!nt) next
      has(tolower($0))
      s = 0
      for (k = 1; k <= nt; k++) if (hit[k]) { df[k]++; m2[NR, k] = 1; s = 1 }
      if (s) cand[++nc] = NR
      next
    }
    FNR == 1 && !picked {
      picked = 1
      for (c = 1; c <= nc; c++) { n = cand[c]; v = 0; for (k = 1; k <= nt; k++) if ((n, k) in m2) v += int(total / df[k]); sc[n] = v }
      for (j = 1; j <= 3; j++) {
        best = 0
        for (c = 1; c <= nc; c++) { n = cand[c]; if (n in used) continue; if (!best || sc[n] > sc[best]) best = n }
        if (!best) break
        lo = best - 2; if (lo < 1) lo = 1; hi = best + 4; if (hi > total) hi = total
        wl[j] = lo; wh[j] = hi; nw = j
        for (n = lo - 2; n <= hi + 2; n++) used[n] = 1
      }
      for (a = 1; a <= nw; a++) for (b = a + 1; b <= nw; b++) if (wl[b] < wl[a]) { t = wl[a]; wl[a] = wl[b]; wl[b] = t; t = wh[a]; wh[a] = wh[b]; wh[b] = t }
      if (nw) printf "── lines about the question (best %d, no model) ──\n", nw
    }
    {
      for (j = 1; j <= nw; j++) if (FNR >= wl[j] && FNR <= wh[j]) {
        s = $0; gsub(/\033\[[0-9;]*[A-Za-z]/, "", s); sub(/\r$/, "", s)
        if (FNR == wl[j]) printf "L%d-%d:\n", wl[j], wh[j]
        print substr(s, 1, w)
      }
    }' "$1" "$1"
}

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
      if [ "$bytes" -le "$max_in" ]; then cat "$log"; else co_log_excerpt "$log"; fi | co_redact | co_fence
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
  _sc_intent_section() {
    # a question asked on the command line (-q/--intent): the log lines that best match it
    [ -n "$focus" ] && [ "$source" != hook ] && co_intent_windows "$log" "$focus" "$width"
    return 0
  }
  _sc_fail_section() {
    if [ "${OFFLOAD_DIGEST_COMPACT:-}" = 1 ]; then co_fail_blocks "$log" 3 6 "$width"
    else co_fail_blocks "$log" 5 12 "$width"; fi
  }
  _sc_key_section() {
    # a re-run of the same command in this session: only what changed (OFFLOAD_DIGEST_PREV)
    if [ -n "${OFFLOAD_DIGEST_PREV:-}" ] && [ -f "$OFFLOAD_DIGEST_PREV" ]; then
      co_key_changes "$keyf" "$log" "$OFFLOAD_DIGEST_PREV" "${OFFLOAD_DIGEST_PREV_AT:-?}" | LC_ALL=C cut -c1-"$width"
      return
    fi
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
    if [ "${OFFLOAD_DIGEST_COMPACT:-}" = 1 ]; then _sc_fail_section; _sc_key_section; _sc_summary_section
    else _sc_summary_section; _sc_intent_section; _sc_fail_section; _sc_key_section; fi
    [ -z "$summary" ] && [ "${OFFLOAD_DIGEST_COMPACT:-}" != 1 ] && tail_n=$(( tail_n + 10 ))
    printf -- '── last %s lines ──\n' "$tail_n"
    tail -n "$tail_n" "$log" | LC_ALL=C sed -e "s/$(printf '\033')\[[0-9;]*[A-Za-z]//g" | LC_ALL=C cut -c1-"$width"
    printf -- '── more: grep -n -iE "error|fail" %s | head -50   ·   sed -n "START,ENDp" %s\n' "$(co_shquote "$log")" "$(co_shquote "$log")"
  } > "$keyf.out"

  local out_bytes ein eout
  out_bytes=$(co_file_bytes "$keyf.out")
  ein=$(co_tokens "$log" "$bytes"); eout=$(co_tokens "$keyf.out" "$out_bytes")
  cat "$keyf.out"
  rm -f "$keyf.out"

  co_stats_append "$(jq -nc --arg src "$source" --arg model "${CO_OC_MODEL:-}" --arg lbl "$label" --arg log "$log" \
    --argjson bin "$bytes" --argjson bout "$out_bytes" --argjson secs "$(co_elapsed "$t0")" \
    --argjson ein "$ein" --argjson eout "$eout" \
    --argjson ok "$([ -n "$summary" ] && echo true || echo false)" \
    --argjson tried "$use_model" \
    --argjson tin "${CO_OC_TOKENS_IN:-0}" --argjson tout "${CO_OC_TOKENS_OUT:-0}" \
    '{ts: now | floor, kind: "digest", source: $src, label: $lbl, log: $log, model: $model, bytes_in: $bin, bytes_out: $bout,
      saved_tokens: (($ein - $eout) | if . < 0 then 0 else . end), seconds: $secs, model_ok: $ok, model_tried: $tried,
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
    function sq(s,    t) { if (s ~ /^[A-Za-z0-9_.\/:=@%+,-]+$/) return s; t = s; gsub(/'"'"'/, "'"'"'\\'"'"''"'"'", t); return "'"'"'" t "'"'"'" }
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
      shown = (ng[kind] < 20 ? ng[kind] : 20); nshown = shown
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
      # the busiest files (or folders) as a ready question; FILE when there are none
      asks = ""
      if (mode != "l") for (j = 1; j <= nshown && j <= 3; j++) asks = asks (asks == "" ? "" : " ") sq(top[j])
      if (asks == "") asks = "FILE"
      print "── narrow it: a path or a sharper pattern; counts: grep -c / rg -c; the rest: sed -n \"START,ENDp\" " logq "; or ask: offload read -q \"QUESTION\" " asks " ──"
    }' "$log" > "$out"
  cat "$out"
  co_stats_append "$(jq -nc --arg lbl "$label" --arg log "$log" --argjson bin "$bytes" --argjson bout "$(co_file_bytes "$out")" \
    --argjson secs "$(co_elapsed "$t0")" --argjson ein "$(co_tokens "$log" "$bytes")" --argjson eout "$(co_tokens "$out" "$(co_file_bytes "$out")")" \
    '{ts: now | floor, kind: "digest", source: "search", label: $lbl, log: $log, model: "", bytes_in: $bin, bytes_out: $bout,
      saved_tokens: (($ein - $eout) | if . < 0 then 0 else . end), seconds: $secs, model_ok: false, model_tried: false,
      worker_tokens_in: 0, worker_tokens_out: 0}')"
  co_prune_logs
}

# co_diff_view <log> <label> — what the agent sees instead of a huge diff (git diff/show):
# files changed with +added −removed (busiest first), the first hunk headers of the busiest
# files, and how to look at one file. Deterministic. Twin: diffView() in digest.ts.
co_diff_view() {
  local log="$1" label lines bytes kb out t0
  label=$(printf '%s' "$2" | co_redact)
  lines=$(co_file_lines "$log"); bytes=$(co_file_bytes "$log"); kb=$(( (bytes + 1023) / 1024 ))
  t0=$(co_now)
  co_tmp out
  LC_ALL=C awk -v label="$(printf '%s' "$label" | LC_ALL=C cut -c1-120)" -v nlines="$(co_fmt_int "$lines")" \
    -v kb="$kb" -v logq="$(co_shquote "$log")" -v logp="$log" '
    function cut(s) { return length(s) > 200 ? substr(s, 1, 197) "..." : s }
    function fmt(n,    s) { s = n ""; while (s ~ /[0-9][0-9][0-9][0-9]/) sub(/[0-9][0-9][0-9]($|,)/, ",&", s); return s }
    /^diff --git / { f = $0; sub(/^diff --git a\/.* b\//, "", f); nf++; order[nf] = f; cur = f; add[f] = 0; del[f] = 0; nh[f] = 0; next }
    cur == "" { next }
    /^(\+\+\+|---) / { next }
    /^@@/ { nh[cur]++; if (nh[cur] <= 2) hunk[cur, nh[cur]] = $0; next }
    /^\+/ { add[cur]++; ta++; next }
    /^-/ { del[cur]++; td++; next }
    END {
      print "[offload] `" label "` · " nlines " lines / " kb " KB · " fmt(nf + 0) " files, +" fmt(ta + 0) " −" fmt(td + 0) " · full log: " logp
      shown = (nf < 20 ? nf : 20)
      print "── files changed (busiest first) ──"
      for (j = 1; j <= shown; j++) {
        best = 0
        for (k = 1; k <= nf; k++) if (!used[k] && (best == 0 || add[order[k]] + del[order[k]] > add[order[best]] + del[order[best]])) best = k
        used[best] = 1; top[j] = order[best]
        printf "%7s %7s  %s\n", "+" add[top[j]], "-" del[top[j]], cut(top[j])
      }
      if (nf > shown) printf "      … %s more files\n", fmt(nf - shown)
      print "── first changes in the busiest files ──"
      for (j = 1; j <= shown && j <= 8; j++) for (i = 1; i <= 2 && i <= nh[top[j]]; i++) print cut(top[j] ": " hunk[top[j], i])
      print "── one file: git diff -- PATH (or sed -n \"START,ENDp\" " logq "); totals: git diff --stat ──"
    }' "$log" > "$out"
  cat "$out"
  co_stats_append "$(jq -nc --arg lbl "$label" --arg log "$log" --argjson bin "$bytes" --argjson bout "$(co_file_bytes "$out")" \
    --argjson secs "$(co_elapsed "$t0")" --argjson ein "$(co_tokens "$log" "$bytes")" --argjson eout "$(co_tokens "$out" "$(co_file_bytes "$out")")" \
    '{ts: now | floor, kind: "digest", source: "diff", label: $lbl, log: $log, model: "", bytes_in: $bin, bytes_out: $bout,
      saved_tokens: (($ein - $eout) | if . < 0 then 0 else . end), seconds: $secs, model_ok: false, model_tried: false,
      worker_tokens_in: 0, worker_tokens_out: 0}')"
  co_prune_logs
}
