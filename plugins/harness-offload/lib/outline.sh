# shellcheck shell=bash
# offload — cheap structural outline of a source file (regex based, no deps).
# Used in hook deny messages so Claude can jump straight to a targeted
# Read(offset/limit) without spending a turn on delegation.

co_outline_regex() {
  local f="$1" ext base
  base=$(basename "$f")
  ext=$(printf '%s' "${base##*.}" | LC_ALL=C tr '[:upper:]' '[:lower:]')
  if [ "$ext" = "$(printf '%s' "$base" | LC_ALL=C tr '[:upper:]' '[:lower:]')" ]; then
    # no extension: fall back to the shebang
    case "$(head -n 1 "$f" 2>/dev/null)" in
      '#!'*python*) ext=py ;;
      '#!'*node*|'#!'*deno*|'#!'*bun*) ext=js ;;
      '#!'*ruby*) ext=rb ;;
      '#!'*sh*) ext=sh ;;
    esac
  fi
  # Regexes live in config/outline.json, shared with the TypeScript engine.
  jq -r --arg e "$ext" '(.languages[] | select(.exts | index($e)) | .regex) // .default' \
    "$CO_ROOT/config/outline.json" 2>/dev/null | head -n 1
}

# co_outline <file> [max_entries] — prints "  L<n>: <trimmed line>" rows.
# When there are too many matches, deeper-indented ones are dropped first so
# the top-level structure survives.
co_outline() {
  local f="$1" max="${2:-50}" re
  re=$(co_outline_regex "$f")
  # grep does the matching (mawk cannot compile these EREs); awk only formats.
  # LC_ALL=C: GNU grep calls files with invalid UTF-8 "binary" otherwise.
  LC_ALL=C grep -nE -- "$re" "$f" 2>/dev/null | LC_ALL=C awk -v max="$max" '
    {
      c = index($0, ":"); num = substr($0, 1, c - 1); line = substr($0, c + 1)
      gsub(/\t/, "    ", line)
      ind = match(line, /[^ ]/) - 1
      if (ind < 0) ind = 0
      sub(/^ +/, "", line)
      # control-flow lines look like method signatures to a regex
      if (line ~ /^(if|for|while|switch|catch|return|else|do|try|with|elif|except|match|when|case|new|await|throw|yield)[^A-Za-z0-9_]/) next
      sub(/[ \t]*\{?[ \t\r]*$/, "", line)
      if (length(line) > 110) line = substr(line, 1, 107) "..."
      n++; ln[n] = num; txt[n] = line; dep[n] = ind
      if (ind > maxind) maxind = ind
    }
    END {
      if (n == 0) exit
      lim = maxind
      # Drop the deepest indentation levels while that still leaves a useful
      # skeleton; then sample the deepest kept level evenly.
      while (lim > 0) {
        nl = -1
        for (i = 1; i <= n; i++) if (dep[i] < lim && dep[i] > nl) nl = dep[i]
        if (nl < 0) break
        cnt = 0; for (i = 1; i <= n; i++) if (dep[i] <= lim) cnt++
        if (cnt <= max) break
        up = 0; for (i = 1; i <= n; i++) if (dep[i] <= nl) up++
        if (up < max / 2) break
        lim = nl
      }
      fixed = 0; deep = 0
      for (i = 1; i <= n; i++) { if (dep[i] < lim) fixed++; else if (dep[i] == lim) deep++ }
      room = max - fixed; if (room < 1) room = 1
      stride = (deep > room ? deep / room : 1)
      shown = 0; k = 0; next_pick = 0
      for (i = 1; i <= n; i++) {
        if (dep[i] > lim) continue
        if (dep[i] == lim) { k++; if (k - 1 < next_pick) continue; next_pick += stride }
        if (shown >= max) break
        printf "  L%d: %s\n", ln[i], txt[i]; shown++
      }
      if (shown < n) printf "  ... %d more symbols not shown (grep -n to find them)\n", n - shown
    }'
}
